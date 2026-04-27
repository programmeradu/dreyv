/**
 * Phase 7A.2 — Artifact storage (Cloudflare R2 + Neon metadata).
 *
 * Bytes live in R2; Neon stores metadata only (`agent_artifacts.r2_key`).
 * Returns a JWT-signed URL pointing at /api/agent/artifacts/[id], which
 * 302-redirects to a fresh R2 presigned GET URL.
 *
 * Failure mode = degrade gracefully:
 *   1. R2 upload fails or R2 not configured → log to `artifact_failures`,
 *      fall back to inline base64 data URL ref so user can still download.
 *   2. DB insert fails → same fallback. Caller still gets an artifact ref.
 *   3. Caller may pass `commandId` and we wire a retry endpoint at
 *      /api/agent/artifacts/retry/[failureId].
 */

import { SignJWT } from "jose";
import { db } from "@/db";
import { agentArtifacts, artifactFailures } from "@/db/schema";
import { isR2Configured, putR2Object } from "./r2-storage";

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export interface UploadedArtifact {
    id: string;
    kind: "pdf" | "csv" | "zip" | "json";
    ref: string;            // signed download URL (or data: URL fallback)
    path: string;           // logical path: ownerKey/folder/filename
    filename: string;
    mime: string;
    bytes: number;
    expiresAt: string;      // ISO
    /** True when ref is a data: URL because R2/DB upload failed. */
    inlineFallback?: boolean;
    /** Failure log id (when inlineFallback === true and DB available). */
    failureId?: string;
}

export interface UploadInput {
    body: Buffer | Uint8Array;
    filename: string;
    mime: string;
    kind: UploadedArtifact["kind"];
    ownerKey: string;
    folder?: string;
    capabilityId: string;
    commandId?: string | null;
    meta?: Record<string, unknown>;
    ttlSeconds?: number;
}

function getSigningSecret(): Uint8Array {
    const s = process.env.ARTIFACT_SIGNING_SECRET || process.env.JWT_SECRET;
    if (!s) {
        throw new Error(
            "ARTIFACT_SIGNING_SECRET (or JWT_SECRET) must be configured to sign artifact URLs",
        );
    }
    return new TextEncoder().encode(s);
}

function getBaseUrl(): string {
    return (
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
        ""
    ).replace(/\/$/, "");
}

export async function signArtifactToken(artifactId: string, ttlSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return await new SignJWT({ aid: artifactId })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("dreyv-artifacts")
        .setAudience("dreyv-artifact-download")
        .setExpirationTime(exp)
        .sign(getSigningSecret());
}

function buildR2Key(ownerKey: string, folder: string, id: string, filename: string): string {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `${ownerKey}/${folder}/${id}-${safeName}`;
}

async function logFailure(input: UploadInput, body: Buffer, stage: string, error: unknown): Promise<string | undefined> {
    if (!db) return undefined;
    const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    try {
        const [row] = await db
            .insert(artifactFailures)
            .values({
                ownerKey: input.ownerKey,
                walletAddress: input.ownerKey.startsWith("neon_") ? null : input.ownerKey,
                capabilityId: input.capabilityId,
                commandId: input.commandId ?? null,
                kind: input.kind,
                filename: input.filename,
                mime: input.mime,
                bytes: body.byteLength,
                stage,
                error: msg.slice(0, 2000),
                meta: (input.meta ?? {}) as Record<string, unknown>,
            })
            .returning({ id: artifactFailures.id });
        return row?.id;
    } catch (logErr) {
        console.error("[artifacts] failure-log insert failed:", logErr);
        return undefined;
    }
}

function inlineFallbackResult(
    input: UploadInput,
    body: Buffer,
    failureId: string | undefined,
    ttl: number,
): UploadedArtifact {
    const safeOwner = input.ownerKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    const safeFolder = (input.folder ?? "reports").replace(/[^a-zA-Z0-9_/-]/g, "_");
    const dataUrl = `data:${input.mime};base64,${body.toString("base64")}`;
    return {
        id: failureId ?? `inline-${Date.now()}`,
        kind: input.kind,
        ref: dataUrl,
        path: `${safeOwner}/${safeFolder}/${input.filename}`,
        filename: input.filename,
        mime: input.mime,
        bytes: body.byteLength,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        inlineFallback: true,
        failureId,
    };
}

/**
 * Upload an artifact to R2, persist metadata to Neon, return signed URL.
 * Degrades to inline data: URL on any failure (logged to artifact_failures).
 */
export async function uploadArtifact(input: UploadInput): Promise<UploadedArtifact> {
    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
    if (body.byteLength > MAX_BYTES) {
        throw new Error(
            `uploadArtifact: artifact exceeds ${MAX_BYTES} bytes (got ${body.byteLength})`,
        );
    }

    const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const safeOwner = input.ownerKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    const safeFolder = (input.folder ?? "reports").replace(/[^a-zA-Z0-9_/-]/g, "_");
    const logicalPath = `${safeOwner}/${safeFolder}/${input.filename}`;

    // Pre-check: if neither DB nor R2 is configured, go straight to inline.
    if (!db && !isR2Configured()) {
        return inlineFallbackResult(input, body, undefined, ttl);
    }

    // Insert metadata row first to get an id (needed to compose r2 key).
    let artifactId: string | undefined;
    if (db) {
        try {
            const [row] = await db
                .insert(agentArtifacts)
                .values({
                    ownerKey: safeOwner,
                    walletAddress: input.ownerKey.startsWith("neon_") ? null : input.ownerKey,
                    capabilityId: input.capabilityId,
                    commandId: input.commandId ?? null,
                    kind: input.kind,
                    filename: input.filename,
                    mime: input.mime,
                    bytes: body.byteLength,
                    r2Key: null,
                    body: null,
                    meta: (input.meta ?? {}) as Record<string, unknown>,
                    expiresAt,
                })
                .returning({ id: agentArtifacts.id });
            artifactId = row?.id;
        } catch (err) {
            const failureId = await logFailure(input, body, "insert", err);
            console.error("[artifacts] metadata insert failed:", err);
            return inlineFallbackResult(input, body, failureId, ttl);
        }
    }

    // Upload bytes to R2.
    if (!isR2Configured()) {
        const failureId = await logFailure(input, body, "upload", new Error("R2 not configured"));
        return inlineFallbackResult(input, body, failureId, ttl);
    }

    const r2Key = buildR2Key(safeOwner, safeFolder, artifactId ?? `tmp-${Date.now()}`, input.filename);
    try {
        await putR2Object({ key: r2Key, body, mime: input.mime, filename: input.filename });
    } catch (err) {
        const failureId = await logFailure(input, body, "upload", err);
        console.error("[artifacts] R2 upload failed:", err);
        return inlineFallbackResult(input, body, failureId, ttl);
    }

    // Update metadata row with r2Key.
    if (db && artifactId) {
        try {
            const { eq } = await import("drizzle-orm");
            await db
                .update(agentArtifacts)
                .set({ r2Key })
                .where(eq(agentArtifacts.id, artifactId));
        } catch (err) {
            console.error("[artifacts] failed to backfill r2_key:", err);
            // Non-fatal — object exists in R2; we can still construct ref below.
        }
    }

    // No DB? We still uploaded to R2 — return a synthetic id and inline note.
    if (!artifactId) {
        const failureId = await logFailure(input, body, "insert", new Error("DB unavailable"));
        return inlineFallbackResult(input, body, failureId, ttl);
    }

    const token = await signArtifactToken(artifactId, ttl);
    const base = getBaseUrl();
    const ref = `${base}/api/agent/artifacts/${artifactId}?t=${token}`;

    return {
        id: artifactId,
        kind: input.kind,
        ref,
        path: logicalPath,
        filename: input.filename,
        mime: input.mime,
        bytes: body.byteLength,
        expiresAt: expiresAt.toISOString(),
    };
}
