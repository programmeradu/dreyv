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

type HeaderMap = Record<string, string>;

let _config: R2Config | null = null;

const SERVICE = "s3";
const REGION = "auto";
const ALGORITHM = "AWS4-HMAC-SHA256";

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

function hmac(key: Buffer | string, value: string) {
    return createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value: Buffer | string) {
    return createHash("sha256").update(value).digest("hex");
}

function encodeRfc3986(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodePath(path: string) {
    return path.split("/").map(encodeRfc3986).join("/");
}

function amzDates(date = new Date()) {
    const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secret: string, dateStamp: string) {
    const kDate = hmac(`AWS4${secret}`, dateStamp);
    const kRegion = hmac(kDate, REGION);
    const kService = hmac(kRegion, SERVICE);
    return hmac(kService, "aws4_request");
}

function canonicalQuery(params: URLSearchParams) {
    return Array.from(params.entries())
        .sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey))
        .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
        .join("&");
}

function canonicalHeaders(headers: HeaderMap) {
    const entries = Object.entries(headers)
        .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    return {
        block: entries.map(([key, value]) => `${key}:${value}\n`).join(""),
        signedHeaders: entries.map(([key]) => key).join(";"),
    };
}

function objectUrl(config: R2Config, key: string) {
    return `https://${config.accountId}.r2.cloudflarestorage.com/${encodePath(config.bucket)}/${encodePath(key)}`;
}

function authorizationHeader(opts: {
    config: R2Config;
    method: "PUT" | "DELETE";
    key: string;
    headers: HeaderMap;
    payloadHash: string;
    amzDate: string;
    dateStamp: string;
}) {
    const { block, signedHeaders } = canonicalHeaders(opts.headers);
    const credentialScope = `${opts.dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const canonicalRequest = [
        opts.method,
        `/${encodePath(opts.config.bucket)}/${encodePath(opts.key)}`,
        "",
        block,
        signedHeaders,
        opts.payloadHash,
    ].join("\n");
    const stringToSign = [ALGORITHM, opts.amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(opts.config.secretAccessKey, opts.dateStamp))
        .update(stringToSign)
        .digest("hex");
    return `${ALGORITHM} Credential=${opts.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function signedFetch(opts: {
    method: "PUT" | "DELETE";
    key: string;
    headers?: HeaderMap;
    body?: Buffer;
}) {
    const config = getConfig();
    const { amzDate, dateStamp } = amzDates();
    const host = `${config.accountId}.r2.cloudflarestorage.com`;
    const payloadHash = sha256Hex(opts.body ?? "");
    const headers: HeaderMap = {
        host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        ...(opts.headers ?? {}),
    };
    headers.authorization = authorizationHeader({
        config,
        method: opts.method,
        key: opts.key,
        headers,
        payloadHash,
        amzDate,
        dateStamp,
    });
    const body = opts.body ? (new Uint8Array(opts.body) as BodyInit) : undefined;
    return fetch(objectUrl(config, opts.key), {
        method: opts.method,
        headers,
        body,
    });
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
    const disposition = `attachment; filename="${opts.filename.replace(/"/g, "")}"`;
    try {
        const res = await signedFetch({
            method: "PUT",
            key: opts.key,
            body: opts.body,
            headers: {
                "content-type": opts.mime,
                "content-disposition": disposition,
            },
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`);
    } catch (err) {
        const e = err as { name?: string; message?: string };
        throw new Error(
            `R2 upload failed (${e?.name ?? "Error"}): ${e?.message ?? String(err)}`,
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
    const { amzDate, dateStamp } = amzDates();
    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const credential = `${config.accessKeyId}/${credentialScope}`;
    const expires = String(Math.min(Math.max(opts.ttlSeconds ?? PRESIGN_TTL, 1), 604800));
    const disposition = opts.inline
        ? `inline; filename="${opts.filename.replace(/"/g, "")}"`
        : `attachment; filename="${opts.filename.replace(/"/g, "")}"`;
    const params = new URLSearchParams({
        "X-Amz-Algorithm": ALGORITHM,
        "X-Amz-Credential": credential,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": expires,
        "X-Amz-SignedHeaders": "host",
        "response-content-disposition": disposition,
        "response-content-type": opts.mime,
    });
    const canonicalRequest = [
        "GET",
        `/${encodePath(config.bucket)}/${encodePath(opts.key)}`,
        canonicalQuery(params),
        `host:${config.accountId}.r2.cloudflarestorage.com\n`,
        "host",
        "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
    const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp))
        .update(stringToSign)
        .digest("hex");
    params.set("X-Amz-Signature", signature);
    return `${objectUrl(config, opts.key)}?${canonicalQuery(params)}`;
}

export async function deleteR2Object(key: string): Promise<void> {
    try {
        const res = await signedFetch({ method: "DELETE", key });
        if (res.status === 404) return;
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`);
    } catch (err) {
        const e = err as { name?: string; message?: string };
        throw new Error(
            `R2 delete failed (${e?.name ?? "Error"}): ${e?.message ?? String(err)}`,
        );
    }
}
