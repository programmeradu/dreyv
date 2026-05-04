import { NextResponse } from "next/server";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-static";

/**
 * RFC 9116 — security.txt
 *
 * Served at both `/.well-known/security.txt` (canonical) and `/security.txt`
 * (legacy). Signals to Phantom Trust & Safety, security researchers, and
 * automated scanners that Dreyv has a real security contact + disclosure
 * policy. Required for fast-tracking domain-warning removal.
 */
export function GET() {
  const origin = getSiteOrigin();
  // Set expiry one year from build time (RFC 9116 requires future date).
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const body = `# Dreyv — security.txt (RFC 9116)
# https://www.rfc-editor.org/rfc/rfc9116

Contact: mailto:security@dreyv.com
Contact: mailto:founders@dreyv.com
Expires: ${expires}
Preferred-Languages: en
Canonical: ${origin}/.well-known/security.txt
Policy: ${origin}/legal/privacy
Acknowledgments: ${origin}/legal/terms

# Scope: dreyv.com, dreyv.app, dreyv.finance and all subdomains.
# Please report:
#   - Wallet / signing flow vulnerabilities
#   - Transaction-firewall bypasses
#   - RLS / data-exposure issues in the Cloud backend
#   - Smart-contract issues in the Keystone Marketplace program
#
# We commit to:
#   - Acknowledging reports within 48 hours
#   - Coordinated disclosure (no public posting before fix is shipped)
#   - Crediting researchers (opt-in) on the acknowledgments page
`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
