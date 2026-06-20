/**
 * Resource doc content for /developers/docs/[slug].
 *
 * Each entry powers a premium doc page: hero crystal, what/why prose,
 * curl example, what the response looks like, and cross-links. The
 * developer index links here instead of dumping users straight onto the
 * raw JSON/.txt endpoints.
 */
import type { StaticImageData } from "next/image";

import openapi from "@/assets/docs/openapi-crystal.png";
import aiplugin from "@/assets/docs/aiplugin-crystal.png";
import acp from "@/assets/docs/acp-crystal.png";
import ucp from "@/assets/docs/ucp-crystal.png";
import catalog from "@/assets/docs/catalog-crystal.png";
import x402 from "@/assets/docs/x402-crystal.png";
import llms from "@/assets/docs/llms-crystal.png";
import llmsFull from "@/assets/docs/llms-full-crystal.png";
import pricing from "@/assets/docs/pricing-crystal.png";

import type { DreyvPose } from "@/components/brand/dreyv-mascot";

export interface ResourceDoc {
    slug: string;
    label: string;
    short: string;            // chip / breadcrumb
    title: string;            // h1
    tagline: string;          // hero subtitle
    endpoint: string;         // public path
    contentType: string;      // for response chip
    crystal: StaticImageData;
    mascot?: DreyvPose;       // optional mascot accent
    what: string[];           // "What it is" paragraphs
    why: string[];            // "Why it matters" paragraphs
    fields?: Array<{ name: string; desc: string }>;
    curl: string;             // example curl command
    relatedSlugs: string[];   // 2–3 cross-links
}

export const RESOURCE_DOCS: ResourceDoc[] = [
    {
        slug: "openapi",
        label: "OpenAPI 3.1 spec",
        short: "OpenAPI",
        title: "OpenAPI 3.1 — the machine-readable Dreyv API",
        tagline:
            "Every public route on dreyv.com, typed and described in OpenAPI 3.1 so agents, SDK generators and IDEs can wire themselves up without a human in the loop.",
        endpoint: "/openapi.json",
        contentType: "application/json",
        crystal: openapi,
        mascot: "think",
        what: [
            "A single JSON document describing the full surface area of the Dreyv REST API — paths, methods, parameters, request and response schemas, authentication, and error shapes — written to the OpenAPI 3.1 specification.",
            "Served as a static, no-auth file at /openapi.json so any agent, scraper or SDK generator can fetch it without provisioning a key first.",
        ],
        why: [
            "OpenAPI is the lingua franca for code generation, IDE autocompletion and LLM tool-use schemas. If your stack supports OpenAPI, it can call Dreyv out of the box.",
            "Pair it with /.well-known/x402 and /.well-known/acp.json for fully autonomous agent payments against any of these endpoints.",
        ],
        curl: `curl https://dreyv.com/openapi.json | jq '.paths | keys | length'`,
        relatedSlugs: ["ai-plugin", "api-catalog", "x402"],
    },
    {
        slug: "ai-plugin",
        label: "ai-plugin manifest",
        short: "ai-plugin",
        title: "ai-plugin manifest — OpenAI plugin discovery",
        tagline:
            "The /.well-known/ai-plugin.json manifest that lets ChatGPT-class models discover Dreyv as a tool and bind directly against the OpenAPI spec.",
        endpoint: "/.well-known/ai-plugin.json",
        contentType: "application/json",
        crystal: aiplugin,
        what: [
            "A small JSON manifest that points an LLM host at the Dreyv OpenAPI spec, sets the plugin's name, description, contact, and authentication shape, and declares the logo and legal links.",
            "Lives at the canonical /.well-known/ai-plugin.json path so ChatGPT, Claude desktop, and any host that follows OpenAI's plugin discovery convention can find it by URL alone.",
        ],
        why: [
            "It is the cheapest possible plugin install: paste dreyv.com into the host, the manifest tells the model the rest. No SDK, no install step.",
            "Together with the OpenAPI spec, it gives every plugin-capable LLM the schema it needs to call Dreyv reliably.",
        ],
        curl: `curl https://dreyv.com/.well-known/ai-plugin.json | jq .`,
        relatedSlugs: ["openapi", "acp", "llms-txt"],
    },
    {
        slug: "acp",
        label: "ACP descriptor",
        short: "ACP",
        title: "ACP — Agentic Commerce Protocol descriptor",
        tagline:
            "Dreyv's Agentic Commerce Protocol descriptor: how an autonomous agent discovers what Dreyv sells, at what price, and how to pay for it without a checkout UI.",
        endpoint: "/.well-known/acp.json",
        contentType: "application/json",
        crystal: acp,
        what: [
            "ACP describes the merchant from an agent's point of view: catalog endpoint, pricing units, accepted payment rails (USDC on Solana, cards via Stripe/Paystack), refund policy, and the discovery URL of the payment-required spec (x402).",
            "Acts as the agent-native equivalent of a Shopify storefront, but the consumer is software, not a browser.",
        ],
        why: [
            "An agent that speaks ACP can land on dreyv.com, parse the descriptor, decide which SKU it needs, and complete payment in one round-trip — no human-in-the-loop, no hardcoded keys.",
            "ACP + x402 is the pair that turns Dreyv into a true machine-payable API surface.",
        ],
        curl: `curl https://dreyv.com/.well-known/acp.json | jq '.catalog, .accepted_payments'`,
        relatedSlugs: ["x402", "ucp", "pricing-md"],
    },
    {
        slug: "ucp",
        label: "UCP profile",
        short: "UCP",
        title: "UCP — Universal Commerce Protocol profile",
        tagline:
            "Dreyv's UCP profile — a vendor-neutral commerce capability advertisement that complements ACP for hosts that prefer the open UCP discovery surface.",
        endpoint: "/.well-known/ucp",
        contentType: "application/json",
        crystal: ucp,
        what: [
            "UCP is the more general cousin of ACP: a descriptor that tells a commerce-aware agent what kinds of transactions a domain supports, what identity it expects, and where to negotiate price and delivery.",
            "Dreyv publishes a minimal UCP profile so agents that prefer UCP over ACP get the same machine-readable answer.",
        ],
        why: [
            "Two specs, one source of truth. Whichever discovery convention your agent host follows, Dreyv shows up.",
            "Keeps Dreyv portable across whichever agent-commerce standard wins long-term.",
        ],
        curl: `curl https://dreyv.com/.well-known/ucp`,
        relatedSlugs: ["acp", "x402", "api-catalog"],
    },
    {
        slug: "api-catalog",
        label: "API catalog (RFC 9727)",
        short: "API catalog",
        title: "API catalog — RFC 9727 link index",
        tagline:
            "A RFC 9727 /.well-known/api-catalog that points to every machine-readable surface Dreyv exposes, so a single fetch reveals every other resource on this page.",
        endpoint: "/.well-known/api-catalog",
        contentType: "application/linkset+json",
        crystal: catalog,
        what: [
            "Conforms to RFC 9727 — the IETF standard for advertising an organisation's machine-readable APIs at a single well-known URL.",
            "Each linkset entry points at one of Dreyv's other manifests (OpenAPI, ai-plugin, ACP, UCP, x402, llms.txt) along with its content type and a human-readable label.",
        ],
        why: [
            "One-shot discovery: an agent that hits /.well-known/api-catalog learns every other interface Dreyv exposes without scraping the marketing site.",
            "Future-proof — when new specs are added (MCP server card, A2A descriptor, AP2), they appear here automatically.",
        ],
        curl: `curl https://dreyv.com/.well-known/api-catalog | jq '.linkset[] | {href, type}'`,
        relatedSlugs: ["openapi", "acp", "x402"],
    },
    {
        slug: "x402",
        label: "x402 capability",
        short: "x402",
        title: "x402 — agent-native payments",
        tagline:
            "The x402 capability advertisement: which Dreyv endpoints accept HTTP 402 Payment Required, which rails settle them, and where the receipts come back.",
        endpoint: "/.well-known/x402",
        contentType: "application/json",
        crystal: x402,
        what: [
            "x402 turns the long-dormant HTTP 402 status into a real payment handshake: the server returns a 402 with payment instructions, the agent pays, and the same request retried with a receipt token returns the paid output.",
            "Dreyv's descriptor lists the protected routes, accepted assets (USDC on Solana, cards via Stripe + Paystack), the facilitator, and the receipt format.",
        ],
        why: [
            "Agents can pay for a Dreyv API call the same way a browser pays a paywall — but with no UI, no account, no key onboarding. Just the HTTP cycle.",
            "Pair it with the hosted agent wallet (POST /api/x402/pay) for fully end-to-end autonomous spend, no human required.",
        ],
        curl: `curl https://dreyv.com/.well-known/x402 | jq '.accepted_assets, .protected_routes'`,
        relatedSlugs: ["acp", "openapi", "pricing-md"],
    },
    {
        slug: "llms-txt",
        label: "llms.txt",
        short: "llms.txt",
        title: "llms.txt — short canonical LLM context",
        tagline:
            "A concise, hand-written markdown index of the Dreyv product surface — the file you tell an LLM to read first when grounding a conversation about Dreyv.",
        endpoint: "/llms.txt",
        contentType: "text/markdown",
        crystal: llms,
        mascot: "greet",
        what: [
            "Follows the llms.txt convention (https://llmstxt.org): a short markdown file at the root of the site that names the product, the key pages, and the documents an LLM should pull next for deeper context.",
            "Hand-curated, not auto-generated. Every link in it is intentional.",
        ],
        why: [
            "Drop https://dreyv.com/llms.txt into a system prompt and the model has a clean map of the product without scraping the marketing site.",
            "It's what we ship to every partner integration as the canonical 'read this first' link.",
        ],
        curl: `curl https://dreyv.com/llms.txt`,
        relatedSlugs: ["llms-full", "api-catalog", "openapi"],
    },
    {
        slug: "llms-full",
        label: "llms-full.txt",
        short: "llms-full.txt",
        title: "llms-full.txt — full single-request context",
        tagline:
            "Everything an LLM needs about Dreyv in one fetch: product, pricing, API conventions, agent rails, and example flows — concatenated as a single markdown bundle.",
        endpoint: "/llms-full.txt",
        contentType: "text/markdown",
        crystal: llmsFull,
        what: [
            "The expanded sibling of llms.txt. Same convention, but instead of an index it ships the full long-form context inline — product, pricing, API conventions, agent rails, and worked examples.",
            "Sized to fit comfortably inside a modern frontier-model context window.",
        ],
        why: [
            "Useful when you'd rather hand the model one URL than orchestrate multiple fetches. The trade-off is freshness — re-pull it when you ship product changes.",
            "Ideal for offline agent fine-tunes and evals that need a stable, single-document snapshot of Dreyv.",
        ],
        curl: `curl https://dreyv.com/llms-full.txt | wc -c`,
        relatedSlugs: ["llms-txt", "openapi", "pricing-md"],
    },
    {
        slug: "pricing-md",
        label: "pricing.md",
        short: "pricing.md",
        title: "pricing.md — machine-readable pricing",
        tagline:
            "The same pricing the marketing page shows, but as a clean markdown document an agent can parse before committing to a tier or per-call SKU.",
        endpoint: "/pricing.md",
        contentType: "text/markdown",
        crystal: pricing,
        mascot: "celebrate",
        what: [
            "Lists every Dreyv plan (Free, Mini $49/mo, Max $199/mo) and every per-call x402 SKU (e.g. dreyv.treasury.snapshot at $0.10, dreyv.treasury.report at $1.00) with currency and billing cadence.",
            "Kept in lockstep with the human pricing page — same source of truth, two presentations.",
        ],
        why: [
            "An autonomous agent can read pricing.md, decide whether the per-call SKU or the monthly tier is cheaper for its workload, and route accordingly through x402 or the dashboard.",
            "Avoids the brittle 'scrape the marketing site' pattern for agents that need to budget.",
        ],
        curl: `curl https://dreyv.com/pricing.md`,
        relatedSlugs: ["x402", "acp", "openapi"],
    },
];

export function getResourceDoc(slug: string): ResourceDoc | undefined {
    return RESOURCE_DOCS.find((d) => d.slug === slug);
}
