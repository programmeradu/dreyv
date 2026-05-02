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

function awsEncode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key: string): string {
    return key.split("/").map(awsEncode).join("/");
}

function sha256Hex(input: Buffer | string): string {
    return createHash("sha256").update(input).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
    return createHmac("sha256", key).update(value).digest();
}

function amzNow(date = new Date()): { amzDate: string; dateStamp: string } {
    const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secretAccessKey: string, dateStamp: string): Buffer {
    const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, "auto");
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
}

function canonicalQuery(params: Record<string, string>): string {
    return Object.entries(params)
        .sort(([aKey, aVal], [bKey, bVal]) => (aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey)))
        .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
        .join("&");
}

function r2Host(config: R2Config): string {
    return `${config.bucket}.${config.accountId}.r2.cloudflarestorage.com`;
}

function r2Url(config: R2Config, key: string, query = ""): string {
    return `https://${r2Host(config)}/${encodeKey(key)}${query ? `?${query}` : ""}`;
}

function signedHeaders(opts: {
    method: "PUT" | "DELETE";
    key: string;
    payloadHash: string;
    contentType?: string;
    contentDisposition?: string;
}): { url: string; headers: Record<string, string> } {
    const config = getConfig();
    const { amzDate, dateStamp } = amzNow();
    const host = r2Host(config);
    const headers: Record<string, string> = {
        host,
        "x-amz-content-sha256": opts.payloadHash,
        "x-amz-date": amzDate,
    };
    if (opts.contentType) headers["content-type"] = opts.contentType;
    if (opts.contentDisposition) headers["content-disposition"] = opts.contentDisposition;

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const canonicalRequest = [
        opts.method,
        `/${encodeKey(opts.key)}`,
        "",
        canonicalHeaders,
        signedHeaderNames.join(";"),
        opts.payloadHash,
    ].join("\n");
    const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp)).update(stringToSign).digest("hex");

    delete headers.host;
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
    return { url: r2Url(config, opts.key), headers };
}

export async function putR2Object(opts: {
    key: string;
    body: Buffer;
    mime: string;
    filename: string;
}): Promise<void> {
    const disposition = `attachment; filename="${opts.filename.replace(/"/g, "")}"`;
    const signed = signedHeaders({
        method: "PUT",
        key: opts.key,
        payloadHash: sha256Hex(opts.body),
        contentType: opts.mime,
        contentDisposition: disposition,
    });
    const res = await fetch(signed.url, {
        method: "PUT",
        headers: signed.headers,
        body: new Uint8Array(opts.body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`R2 upload failed (${res.status}): ${text.slice(0, 300)}`);
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
    const { amzDate, dateStamp } = amzNow();
    const disposition = opts.inline
        ? `inline; filename="${opts.filename.replace(/"/g, "")}"`
        : `attachment; filename="${opts.filename.replace(/"/g, "")}"`;
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const host = `${config.accountId}.r2.cloudflarestorage.com`;
    const query = canonicalQuery({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": String(opts.ttlSeconds ?? PRESIGN_TTL),
        "X-Amz-SignedHeaders": "host",
        "response-content-disposition": disposition,
        "response-content-type": opts.mime,
    });
    const canonicalRequest = [
        "GET",
        `/${awsEncode(config.bucket)}/${encodeKey(opts.key)}`,
        query,
        `host:${host}\n`,
        "host",
        "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp)).update(stringToSign).digest("hex");
    return r2Url(config, opts.key, `${query}&X-Amz-Signature=${signature}`);
}

export async function deleteR2Object(key: string): Promise<void> {
    const signed = signedHeaders({ method: "DELETE", key, payloadHash: sha256Hex("") });
    const res = await fetch(signed.url, { method: "DELETE", headers: signed.headers });
    if (!res.ok && res.status !== 404) {
        const text = await res.text().catch(() => "");
        throw new Error(`R2 delete failed (${res.status}): ${text.slice(0, 300)}`);
    }
}
