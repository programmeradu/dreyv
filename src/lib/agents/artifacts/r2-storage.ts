/**
 * Phase 7A.2 — Cloudflare R2 adapter for agent artifacts.
 *
 * R2 is S3-compatible — we use @aws-sdk/client-s3 with R2's endpoint.
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET. Optional: R2_PUBLIC_BASE (CDN base) — unused; we always
 * use short-lived presigned GETs.
 *
 * Throws loudly if env is missing — callers catch and degrade gracefully.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_TTL = 60 * 10; // 10 min — refreshed on each download

let _client: S3Client | null = null;
let _bucket: string | null = null;

function getClient(): { client: S3Client; bucket: string } {
    if (_client && _bucket) return { client: _client, bucket: _bucket };
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error(
            "R2 not configured (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)",
        );
    }
    _client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    });
    _bucket = bucket;
    return { client: _client, bucket: _bucket };
}

export function isR2Configured(): boolean {
    return Boolean(
        process.env.R2_ACCOUNT_ID &&
            process.env.R2_ACCESS_KEY_ID &&
            process.env.R2_SECRET_ACCESS_KEY &&
            process.env.R2_BUCKET,
    );
}

export async function putR2Object(opts: {
    key: string;
    body: Buffer;
    mime: string;
    filename: string;
}): Promise<void> {
    const { client, bucket } = getClient();
    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: opts.key,
            Body: opts.body,
            ContentType: opts.mime,
            ContentDisposition: `attachment; filename="${opts.filename.replace(/"/g, "")}"`,
        }),
    );
}

export async function presignR2Get(opts: {
    key: string;
    filename: string;
    mime: string;
    inline?: boolean;
    ttlSeconds?: number;
}): Promise<string> {
    const { client, bucket } = getClient();
    const disposition = opts.inline
        ? `inline; filename="${opts.filename.replace(/"/g, "")}"`
        : `attachment; filename="${opts.filename.replace(/"/g, "")}"`;
    const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: opts.key,
        ResponseContentType: opts.mime,
        ResponseContentDisposition: disposition,
    });
    return await getSignedUrl(client, cmd, {
        expiresIn: opts.ttlSeconds ?? PRESIGN_TTL,
    });
}

export async function deleteR2Object(key: string): Promise<void> {
    const { client, bucket } = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
