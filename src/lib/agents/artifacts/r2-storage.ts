/**
 * Phase 7A.2 — Cloudflare R2 adapter for agent artifacts.
 *
 * R2 is S3-compatible. This adapter intentionally avoids the AWS SDK because
 * Vercel's production runtime can trip over the SDK's CJS/ESM XML dependency
 * chain (`@aws-sdk/xml-builder` -> `@nodable/entities`). A tiny SigV4 signer is
 * enough for the three operations we need here: PUT, presigned GET, DELETE.
 *
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 * Optional: R2_PUBLIC_BASE (CDN base) — currently unused; we always serve via
 * short-lived presigned GETs.
 *
 * Throws loudly if env is missing — callers catch and degrade gracefully.
 */

import { createHash, createHmac } from "node:crypto";

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
    const config = getConfig();
    const client = getClient();
    const disposition = `attachment; filename="${opts.filename.replace(/"/g, "")}"`;
    try {
        await client.send(
            new PutObjectCommand({
                Bucket: config.bucket,
                Key: opts.key,
                Body: opts.body,
                ContentType: opts.mime,
                ContentDisposition: disposition,
            }),
        );
    } catch (err) {
        const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
        throw new Error(
            `R2 upload failed (${e?.$metadata?.httpStatusCode ?? "?"} ${e?.name ?? "Error"}): ${e?.message ?? String(err)}`,
        );
    }
}

export async function presignR2Get(opts: {
    key: string;
    filename: string;
    mime: string;
    inline?: boolean;
    ttlSeconds?: number;
}): Promise<string> {
    const config = getConfig();
    const client = getClient();
    const disposition = opts.inline
        ? `inline; filename="${opts.filename.replace(/"/g, "")}"`
        : `attachment; filename="${opts.filename.replace(/"/g, "")}"`;
    return getSignedUrl(
        client,
        new GetObjectCommand({
            Bucket: config.bucket,
            Key: opts.key,
            ResponseContentDisposition: disposition,
            ResponseContentType: opts.mime,
        }),
        { expiresIn: opts.ttlSeconds ?? PRESIGN_TTL },
    );
}

export async function deleteR2Object(key: string): Promise<void> {
    const config = getConfig();
    const client = getClient();
    try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    } catch (err) {
        const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
        if (e?.$metadata?.httpStatusCode === 404) return;
        throw new Error(
            `R2 delete failed (${e?.$metadata?.httpStatusCode ?? "?"} ${e?.name ?? "Error"}): ${e?.message ?? String(err)}`,
        );
    }
}
