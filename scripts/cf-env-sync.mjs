/**
 * Split a Vercel-exported dotenv file into the two things Cloudflare needs.
 *
 * Cloudflare treats build-time and runtime config differently from Vercel:
 *
 *   NEXT_PUBLIC_*  are inlined into the JS bundle by `next build`. They MUST
 *                  exist in the shell that runs the build. Setting them as
 *                  Worker secrets afterwards does nothing — the strings are
 *                  already baked (or baked as `undefined`).
 *
 *   everything else is read at request time and belongs in Worker secrets,
 *                  uploaded with `wrangler secret bulk`.
 *
 * Usage:
 *   vercel env pull .env.production.local --environment=production
 *   node scripts/cf-env-sync.mjs .env.production.local
 *   npx wrangler secret bulk .cf-secrets.json
 *
 * Outputs (both gitignored):
 *   .cf-secrets.json  → runtime secrets, for `wrangler secret bulk`
 *   .env.production   → NEXT_PUBLIC_* only, read by `next build`
 */
import { readFileSync, writeFileSync } from "node:fs";

// Cloudflare caps how many vars+secrets a single Worker can bind.
// Free plan is lower; check your plan before assuming headroom.
const BINDING_LIMIT_PAID = 128;

// Vercel injects these itself; they mean nothing on Cloudflare and just
// burn binding slots.
const VERCEL_ONLY = /^(VERCEL|NX_|TURBO_)/;

// Already declared in wrangler.json `vars` — don't duplicate as a secret.
const DECLARED_IN_WRANGLER = new Set(["NEXT_PUBLIC_APP_URL"]);

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/cf-env-sync.mjs <dotenv-file>");
  process.exit(1);
}

/** Minimal dotenv parse: KEY=value, honouring quotes and `export` prefixes. */
function parseDotenv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Vercel escapes newlines in multi-line values (private keys, JSON blobs).
    out[key] = value.replace(/\\n/g, "\n");
  }
  return out;
}

const all = parseDotenv(readFileSync(source, "utf8"));

const buildTime = {};
const runtime = {};
const skipped = [];

for (const [key, value] of Object.entries(all)) {
  if (VERCEL_ONLY.test(key)) {
    skipped.push(key);
    continue;
  }
  if (key.startsWith("NEXT_PUBLIC_")) {
    buildTime[key] = value;
    // A public var is not a secret, but the server may still read it at
    // runtime (e.g. via getSiteUrl()), so it needs to exist in both places —
    // except the ones wrangler.json already declares.
    if (!DECLARED_IN_WRANGLER.has(key)) runtime[key] = value;
    continue;
  }
  runtime[key] = value;
}

writeFileSync(".cf-secrets.json", JSON.stringify(runtime, null, 2) + "\n");
writeFileSync(
  ".env.production",
  Object.entries(buildTime)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("\n") + "\n",
);

const runtimeCount = Object.keys(runtime).length;

console.log(`source            ${source}`);
console.log(`build-time vars   ${Object.keys(buildTime).length}  → .env.production`);
console.log(`runtime secrets   ${runtimeCount}  → .cf-secrets.json`);
if (skipped.length) {
  console.log(`skipped (Vercel)  ${skipped.length}  ${skipped.join(", ")}`);
}

if (runtimeCount > BINDING_LIMIT_PAID) {
  console.log("");
  console.log(
    `WARNING: ${runtimeCount} secrets exceeds the ${BINDING_LIMIT_PAID} binding limit ` +
      `on the Workers paid plan. The bulk upload will be rejected.`,
  );
  console.log(
    "Drop keys for services you no longer use, or collapse a group of " +
      "rarely-read keys into one JSON secret and parse it at runtime.",
  );
  process.exitCode = 1;
}
