import { NextRequest, NextResponse } from "next/server";
import { load } from "cheerio";
import { getSiteOrigin } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

/**
 * Markdown for Agents: content negotiation endpoint.
 *
 * Spec: https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
 *
 * Fetches the rendered HTML for an allow-listed path and returns a
 * markdown projection with:
 *   Content-Type: text/markdown; charset=utf-8
 *   x-markdown-tokens: <approximate token count>
 *
 * Middleware rewrites `Accept: text/markdown` requests for marketing /
 * docs pages here so HTML stays the default for browsers while agents
 * get a clean markdown view.
 */

const ALLOWED_PATHS = new Set<string>([
  "/",
  "/pricing",
  "/developers",
  "/developers/mcp",
  "/api-docs",
  "/mcp",
  "/case",
  "/atlas",
  "/compare",
  "/legal/privacy",
  "/legal/terms",
  "/legal/refunds",
  "/legal/cookies",
]);

function isAllowed(path: string) {
  if (ALLOWED_PATHS.has(path)) return true;
  if (path.startsWith("/legal/")) return true;
  if (path.startsWith("/case/")) return true;
  return false;
}

function approxTokens(text: string) {
  // Cheap heuristic: 1 token ≈ 4 chars of English.
  return Math.ceil(text.length / 4);
}

function htmlToMarkdown(html: string): { md: string; title: string } {
  const $ = load(html);
  $("script, style, noscript, svg, iframe, link, meta").remove();

  const title = ($("title").first().text() || "").trim();
  const root = $("main").first().length ? $("main").first() : $("body");

  const out: string[] = [];

  const walk = (node: any) => {
    const $node = $(node);
    if (node.type === "text") {
      const t = (node.data ?? "").replace(/\s+/g, " ");
      if (t.trim()) out.push(t);
      return;
    }
    if (node.type !== "tag") return;
    const tag = node.tagName?.toLowerCase();
    switch (tag) {
      case "h1": out.push(`\n\n# ${$node.text().trim()}\n\n`); return;
      case "h2": out.push(`\n\n## ${$node.text().trim()}\n\n`); return;
      case "h3": out.push(`\n\n### ${$node.text().trim()}\n\n`); return;
      case "h4": out.push(`\n\n#### ${$node.text().trim()}\n\n`); return;
      case "h5":
      case "h6": out.push(`\n\n##### ${$node.text().trim()}\n\n`); return;
      case "p": {
        const t = $node.text().replace(/\s+/g, " ").trim();
        if (t) out.push(`\n\n${t}\n\n`);
        return;
      }
      case "br": out.push("\n"); return;
      case "hr": out.push("\n\n---\n\n"); return;
      case "a": {
        const href = $node.attr("href") || "";
        const t = $node.text().replace(/\s+/g, " ").trim();
        if (t) out.push(href ? `[${t}](${href})` : t);
        return;
      }
      case "strong":
      case "b": out.push(`**${$node.text().trim()}**`); return;
      case "em":
      case "i": out.push(`_${$node.text().trim()}_`); return;
      case "code": {
        if ($node.parent()?.[0]?.tagName?.toLowerCase() === "pre") {
          out.push($node.text());
        } else {
          out.push(`\`${$node.text()}\``);
        }
        return;
      }
      case "pre": {
        out.push(`\n\n\`\`\`\n${$node.text().replace(/\n+$/, "")}\n\`\`\`\n\n`);
        return;
      }
      case "ul":
      case "ol": {
        out.push("\n");
        const ordered = tag === "ol";
        $node.children("li").each((i, li) => {
          const prefix = ordered ? `${i + 1}. ` : "- ";
          const t = $(li).text().replace(/\s+/g, " ").trim();
          if (t) out.push(`${prefix}${t}\n`);
        });
        out.push("\n");
        return;
      }
      case "img": {
        const alt = $node.attr("alt") || "";
        const src = $node.attr("src") || "";
        if (src) out.push(`![${alt}](${src})`);
        return;
      }
      default:
        $node.contents().each((_, child) => walk(child as any));
    }
  };

  root.contents().each((_, child) => walk(child as any));

  const md = out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { md, title };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path") || "/";
  let path = rawPath;
  try {
    path = new URL(rawPath, "http://x").pathname;
  } catch {
    path = "/";
  }

  if (!isAllowed(path)) {
    return new NextResponse(
      `# Not available as markdown\n\nThis path is not exposed via the markdown content-negotiation surface.\n`,
      {
        status: 404,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      },
    );
  }

  const origin = getSiteOrigin();
  const target = `${origin}${path}`;

  let html = "";
  try {
    const r = await fetch(target, {
      headers: {
        accept: "text/html",
        "user-agent": "dreyv-markdown-for-agents/1.0",
        // Bypass any markdown rewrite to avoid recursion.
        "x-md-bypass": "1",
      },
      cache: "no-store",
    });
    if (!r.ok) {
      return new NextResponse(
        `# Upstream error\n\nUpstream ${target} returned ${r.status}.\n`,
        {
          status: 502,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        },
      );
    }
    html = await r.text();
  } catch (e) {
    return new NextResponse(
      `# Upstream fetch failed\n\n${(e as Error).message}\n`,
      {
        status: 502,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      },
    );
  }

  const { md, title } = htmlToMarkdown(html);
  const final =
    `<!-- source: ${target} | format: markdown-for-agents v1 -->\n` +
    (title ? `# ${title}\n\n` : "") +
    md +
    "\n";

  return new NextResponse(final, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "x-markdown-tokens": String(approxTokens(final)),
      "x-markdown-source": target,
      Vary: "Accept",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
