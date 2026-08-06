/**
 * Legacy `/security.txt` location — RFC 9116 mandates the canonical path
 * is `/.well-known/security.txt` but many scanners (including Phantom's)
 * still probe the root, so we mirror the same body here.
 */
export const runtime = "edge";
export const dynamic = "force-static";
export { GET } from "../.well-known/security.txt/route";
