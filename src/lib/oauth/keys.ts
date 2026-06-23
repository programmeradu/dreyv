/**
 * ES256 signing-key management for the OAuth/OIDC server.
 *
 * - Keys live in `oauth_signing_keys`.
 * - Private JWKs encrypted at rest with AES-256-GCM, key derived from
 *   KEYPAIR_MASTER_KEY (existing project secret).
 * - One `active` key signs new tokens; `rotating` keys verify older tokens
 *   until they're retired (default 30d).
 * - First-run bootstrap is automatic: if no active key exists, one is
 *   generated and persisted on first signer load.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, type JWK } from "jose";

type SigningKey = CryptoKey;
import { eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { oauthSigningKeys } from "@/db/schema";

const ALG = "ES256";

function deriveAesKey(): Buffer {
  const raw = process.env.KEYPAIR_MASTER_KEY;
  if (!raw) throw new Error("KEYPAIR_MASTER_KEY must be configured");
  return createHash("sha256").update(raw, "utf8").digest();
}

function encryptPrivateJwk(jwk: JWK): Buffer {
  const key = deriveAesKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = Buffer.from(JSON.stringify(jwk), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

function decryptPrivateJwk(blob: Buffer): JWK {
  const key = deriveAesKey();
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as JWK;
}

function newKid(): string {
  return `dk-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

async function generateAndStoreActive(): Promise<{ kid: string; privateJwk: JWK; publicJwk: JWK }> {
  if (!db) throw new Error("Database unavailable");
  const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });
  const privateJwk = (await exportJWK(privateKey)) as JWK;
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const kid = newKid();
  privateJwk.kid = kid;
  privateJwk.alg = ALG;
  privateJwk.use = "sig";
  publicJwk.kid = kid;
  publicJwk.alg = ALG;
  publicJwk.use = "sig";

  await db.insert(oauthSigningKeys).values({
    kid,
    algorithm: ALG,
    publicJwk: publicJwk as unknown as object,
    privateJwkEncrypted: encryptPrivateJwk(privateJwk),
    status: "active",
  });

  return { kid, privateJwk, publicJwk };
}

export interface ActiveSigner {
  kid: string;
  alg: string;
  privateKey: KeyLike;
}

export async function getActiveSigner(): Promise<ActiveSigner> {
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(oauthSigningKeys)
    .where(eq(oauthSigningKeys.status, "active"))
    .limit(1);

  if (row) {
    const privateJwk = decryptPrivateJwk(Buffer.from(row.privateJwkEncrypted as unknown as Buffer));
    const privateKey = (await importJWK(privateJwk, ALG)) as KeyLike;
    return { kid: row.kid, alg: ALG, privateKey };
  }

  const bootstrap = await generateAndStoreActive();
  const privateKey = (await importJWK(bootstrap.privateJwk, ALG)) as KeyLike;
  return { kid: bootstrap.kid, alg: ALG, privateKey };
}

export interface VerifierKey {
  kid: string;
  alg: string;
  publicJwk: JWK;
}

export async function getVerifierKeys(): Promise<VerifierKey[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(oauthSigningKeys)
    .where(ne(oauthSigningKeys.status, "retired"));

  return rows.map((r) => ({
    kid: r.kid,
    alg: ALG,
    publicJwk: r.publicJwk as unknown as JWK,
  }));
}

export async function resolvePublicJwks(): Promise<{ keys: JWK[] }> {
  const keys = await getVerifierKeys();
  return { keys: keys.map((k) => k.publicJwk) };
}
