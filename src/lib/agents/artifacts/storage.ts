/**
 * Phase 7A — Artifact storage (Neon-backed).
 *
 * Stores agent-generated deliverables (PDFs, CSVs, ZIPs) inline in the
 * `agent_artifacts` table on Neon Postgres and returns a JWT-signed
 * download URL with TTL. No external blob store required.
 *
 * Download endpoint: GET /api/agent/artifacts/[id]?t=<signed-jwt>
 *
 * No fakes — fails loud if DATABASE_URL or ARTIFACT_SIGNING_SECRET is
 * missing. 50MB application-level cap.
 */

import { SignJWT } from "jose";
import { db } from "@/db";
import { agentArtifacts } from "@/db/schema";

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export interface UploadedArtifact {
    id: string;
    kind: "pdf" | "csv" | "zip" | "json";
    ref: string;            // signed download URL (relative + token)
    path: string;           // logical path: ownerKey/folder/filename
    filename: string;
    mime: string;
    bytes: number;
    expiresAt: string;      // ISO
}

export interface UploadInput {
    body: Buffer | Uint8Array;
    filename: string;
    mime: string;
    kind: UploadedArtifact["kind"];
    /** Logical owner — wallet address or vault PDA. */
    ownerKey: string;
    /** Optional folder under owner, e.g. "reports/2026-04". */
    folder?: string;
    /** Capability id that produced the artifact (for audit). */
    capabilityId: string;
    /** Optional command id this artifact belongs to. */
    commandId?: string | null;
    /** Optional structured metadata (month, params, etc). */
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

/**
 * Sign a short-lived download token for an artifact id.
 */
export async function signArtifactToken(artifactId: string, ttlSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return await new SignJWT({ aid: artifactId })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("dreyv-artifacts")
        .setAudience("dreyv-artifact-download")
        .setExpirationTime(exp)
        .sign(getSigningSecret());
}

/**
 * Upload an artifact (insert into Neon) and return a signed URL.
 */
export async function uploadArtifact(input: UploadInput): Promise<UploadedArtifact> {
    if (!db) {
        throw new Error("uploadArtifact: database not configured (DATABASE_URL missing)");
    }
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
            body,
            meta: (input.meta ?? {}) as Record<string, unknown>,
            expiresAt,
        })
        .returning({ id: agentArtifacts.id });

    if (!row?.id) {
        throw new Error("uploadArtifact: insert failed (no id returned)");
    }

    const token = await signArtifactToken(row.id, ttl);
    const base = getBaseUrl();
    const ref = `${base}/api/agent/artifacts/${row.id}?t=${token}`;

    return {
        id: row.id,
        kind: input.kind,
        ref,
        path: logicalPath,
        filename: input.filename,
        mime: input.mime,
        bytes: body.byteLength,
        expiresAt: expiresAt.toISOString(),
    };
}
