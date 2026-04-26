/**
 * Phase 7A — Artifact storage
 *
 * Uploads agent-generated deliverables (PDFs, CSVs, ZIPs) to Supabase Storage
 * (Lovable Cloud) and returns a signed URL with TTL. No fakes — fails loud
 * if storage isn't configured.
 */

import { createAdminClient } from "@/lib/supabase";

export const ARTIFACT_BUCKET = "treasury-artifacts" as const;
export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface UploadedArtifact {
    kind: "pdf" | "csv" | "zip" | "json";
    ref: string;            // signed URL
    path: string;           // storage path
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
    /** Logical owner — wallet address or vault PDA. Used for path namespacing. */
    ownerKey: string;
    /** Optional folder under owner, e.g. "reports/2026-04". */
    folder?: string;
    ttlSeconds?: number;
}

/**
 * Ensure the artifact bucket exists. Idempotent. Called automatically by
 * `uploadArtifact` on first use per process. Throws if Supabase not configured.
 */
async function ensureBucket(): Promise<void> {
    const admin = createAdminClient();
    const { data: buckets, error: listErr } = await admin.storage.listBuckets();
    if (listErr) throw new Error(`storage.listBuckets failed: ${listErr.message}`);
    if (buckets?.some((b) => b.name === ARTIFACT_BUCKET)) return;

    const { error: createErr } = await admin.storage.createBucket(ARTIFACT_BUCKET, {
        public: false,
        fileSizeLimit: 50 * 1024 * 1024, // 50 MB
    });
    if (createErr && !/already exists/i.test(createErr.message)) {
        throw new Error(`storage.createBucket failed: ${createErr.message}`);
    }
}

let bucketEnsured = false;

/**
 * Upload an artifact and return a signed URL.
 */
export async function uploadArtifact(input: UploadInput): Promise<UploadedArtifact> {
    if (!bucketEnsured) {
        await ensureBucket();
        bucketEnsured = true;
    }

    const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const safeOwner = input.ownerKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    const safeFolder = (input.folder ?? "reports").replace(/[^a-zA-Z0-9_/-]/g, "_");
    const path = `${safeOwner}/${safeFolder}/${Date.now()}-${input.filename}`;

    const admin = createAdminClient();

    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
    const { error: uploadErr } = await admin.storage
        .from(ARTIFACT_BUCKET)
        .upload(path, body, { contentType: input.mime, upsert: false });
    if (uploadErr) throw new Error(`storage.upload failed: ${uploadErr.message}`);

    const { data: signed, error: signErr } = await admin.storage
        .from(ARTIFACT_BUCKET)
        .createSignedUrl(path, ttl, { download: input.filename });
    if (signErr || !signed?.signedUrl) {
        throw new Error(`storage.createSignedUrl failed: ${signErr?.message ?? "no url"}`);
    }

    return {
        kind: input.kind,
        ref: signed.signedUrl,
        path,
        filename: input.filename,
        mime: input.mime,
        bytes: body.byteLength,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
}
