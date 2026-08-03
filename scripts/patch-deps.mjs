/**
 * Post-install patch for packages with broken or incomplete export maps.
 *
 * uncrypto@0.1.3 declares a "workerd" export condition pointing to
 * ./dist/crypto.web.mjs — the file IS in the npm tarball but may be
 * excluded by selective file tracing. This script ensures it exists.
 *
 * isows — similar issue where _esm/native.js may not be copied.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// --- uncrypto ---
const uncryptoDir = path.join(root, "node_modules", "uncrypto", "dist");
const uncryptoMjs = path.join(uncryptoDir, "crypto.web.mjs");
const uncryptoCjs = path.join(uncryptoDir, "crypto.web.cjs");

if (
  fs.existsSync(path.join(root, "node_modules", "uncrypto")) &&
  !fs.existsSync(uncryptoMjs)
) {
  fs.mkdirSync(uncryptoDir, { recursive: true });
  fs.writeFileSync(
    uncryptoMjs,
    [
      'const c = globalThis.crypto;',
      'export const subtle = c.subtle;',
      'export const randomUUID = () => c.randomUUID();',
      'export const getRandomValues = (a) => c.getRandomValues(a);',
      'export default { subtle, randomUUID, getRandomValues };',
      '',
    ].join('\n'),
  );
  console.log("[patch-deps] Created uncrypto/dist/crypto.web.mjs");
}

if (
  fs.existsSync(path.join(root, "node_modules", "uncrypto")) &&
  !fs.existsSync(uncryptoCjs)
) {
  fs.mkdirSync(uncryptoDir, { recursive: true });
  fs.writeFileSync(
    uncryptoCjs,
    [
      '"use strict";',
      'const c = globalThis.crypto;',
      'exports.subtle = c.subtle;',
      'exports.randomUUID = () => c.randomUUID();',
      'exports.getRandomValues = (a) => c.getRandomValues(a);',
      'module.exports = { subtle: exports.subtle, randomUUID: exports.randomUUID, getRandomValues: exports.getRandomValues };',
      'module.exports.default = module.exports;',
      '',
    ].join('\n'),
  );
  console.log("[patch-deps] Created uncrypto/dist/crypto.web.cjs");
}

// --- isows ---
const isowsDir = path.join(root, "node_modules", "isows", "_esm");
const isowsNative = path.join(isowsDir, "native.js");

if (
  fs.existsSync(path.join(root, "node_modules", "isows")) &&
  !fs.existsSync(isowsNative)
) {
  fs.mkdirSync(isowsDir, { recursive: true });
  fs.writeFileSync(
    isowsNative,
    [
      'export const WebSocket = globalThis.WebSocket;',
      '',
    ].join('\n'),
  );
  console.log("[patch-deps] Created isows/_esm/native.js");
}

console.log("[patch-deps] Done.");
