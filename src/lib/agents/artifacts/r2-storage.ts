/**
 * Phase 7A.2 — Cloudflare R2 adapter for agent artifacts.
 *
 * R2 is S3-compatible. We sign requests directly with AWS SigV4 instead of
 * importing the AWS SDK because the SDK's transitive XML parser can crash in
 * Vercel's Node runtime with ESM/CJS interop errors.
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET. Optional: R2_PUBLIC_BASE (CDN base) — unused; we always
 * use short-lived presigned GETs.
 *
 * Throws loudly if env is missing — callers catch and degrade gracefully.
 */

import { createHash, createHmac } from "crypto";

const PRESIGN_TTL = 60 * 10; // 10 min — refreshed on each download

type R2Config = {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
};

let _config: R2Config | null = null;

function getConfig(): R2Config {
    if (_config) return _config;
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error(
            "R2 not configured (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)",
        );
    }
    _config = { accountId, accessKeyId, secretAccessKey, bucket };
    return _config;
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
