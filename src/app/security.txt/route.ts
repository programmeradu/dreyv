/**
 * Legacy `/security.txt` location — RFC 9116 mandates the canonical path
 * is `/.well-known/security.txt` but many scanners (including Phantom's)
 * still probe the root, so we mirror the same body here.
 */
export { GET, dynamic } from "../.well-known/security.txt/route";
