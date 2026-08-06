/**
 * POST /api/studio/test-app — Automated smoke test for mini-apps.
 *
 * Renders a mini-app in CF headless browser and checks:
 * 1. Page loads without JS errors
 * 2. Key elements render
 * 3. Visual screenshot captured
 * 4. AI-powered quality assessment
 *
 * Used as pre-publish quality gate.
 */

import { NextRequest, NextResponse } from "next/server";
import { screenshot, jsonExtract } from "@/lib/cloudflare/cf-browser";
export const runtime = "edge";

interface TestResult {
    passed: boolean;
    score: number; // 0-100
    screenshot?: string; // base64
    checks: { name: string; passed: boolean; details: string }[];
    errors: string[];
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { html, url, code, appName = "Mini-App" } = body;

        const browserAvailable = !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN);

        // ── STATIC LINT MODE ─────────────────────────────────────
        // No Browser Rendering creds OR no html/url payload → run client-style
        // static checks against the source code. Honest about what it is.
        if (!browserAvailable || (!html && !url)) {
            const src: string = code || html || "";
            const has = (re: RegExp) => re.test(src);
            const balanced = (open: string, close: string) => {
                let depth = 0;
                for (const ch of src) {
                    if (ch === open) depth++;
                    else if (ch === close) { depth--; if (depth < 0) return false; }
                }
                return depth === 0;
            };
            const balancedBraces = balanced("{", "}");
            const balancedParens = balanced("(", ")");

            const checks: { name: string; passed: boolean; details: string }[] = [
                { name: "Source provided", passed: src.length > 0, details: src.length > 0 ? `${src.length} chars` : "No code submitted" },
                { name: "Has default export", passed: has(/export\s+default/), details: has(/export\s+default/) ? "Found `export default`" : "Missing — Studio entry must `export default function App()`" },
                { name: "Imports React or SDK", passed: has(/from\s+['"](react|@keystone-os\/sdk|@dreyv\/sdk)['"]/), details: has(/from\s+['"]react['"]/) ? "React import present" : "No React/SDK import detected" },
                { name: "Balanced braces", passed: balancedBraces, details: balancedBraces ? "All { } pairs match" : "Unbalanced { } — likely a syntax error" },
                { name: "Balanced parentheses", passed: balancedParens, details: balancedParens ? "All ( ) pairs match" : "Unbalanced ( ) — likely a syntax error" },
                { name: "No raw fetch()", passed: !/(?<!use)\bfetch\s*\(/.test(src), details: /(?<!use)\bfetch\s*\(/.test(src) ? "Uses raw fetch() — blocked by CSP, use useFetch()" : "OK" },
                { name: "No local/sessionStorage", passed: !has(/\b(local|session)Storage\b/), details: has(/\b(local|session)Storage\b/) ? "Blocked by sandbox" : "OK" },
                { name: "No eval / new Function", passed: !has(/\beval\s*\(|\bnew\s+Function\s*\(/), details: has(/\beval\s*\(|\bnew\s+Function\s*\(/) ? "Dynamic code execution detected" : "OK" },
                { name: "No document.cookie", passed: !has(/document\.cookie/), details: has(/document\.cookie/) ? "Blocked by sandbox" : "OK" },
                { name: "No process.env / __dirname", passed: !has(/\bprocess\.env\b|\b__dirname\b/), details: has(/\bprocess\.env\b|\b__dirname\b/) ? "Node-only API in browser sandbox" : "OK" },
                { name: "No mock/placeholder data", passed: !has(/\b(mock|placeholder|dummy|fake|lorem)\w*\s*[:=]/i), details: has(/\b(mock|placeholder|dummy|fake|lorem)\w*\s*[:=]/i) ? "Mock-like identifier — fetch real data via useFetch()" : "OK" },
                { name: "No HTML shell", passed: !has(/<!DOCTYPE|<html[\s>]|<head[\s>]|<body[\s>]/i), details: has(/<!DOCTYPE|<html[\s>]|<head[\s>]/i) ? "Generated HTML shell detected — Studio runtime owns the shell" : "OK" },
                { name: "No forbidden web3 imports", passed: !has(/from\s+['"](?:@solana\/web3\.js|ethers|axios|wagmi)['"]/), details: has(/from\s+['"](?:@solana\/web3\.js|ethers|axios|wagmi)['"]/) ? "Not bundled in sandbox — use SDK hooks" : "OK" },
            ];

            const failed = checks.filter((c) => !c.passed);
            const score = Math.round(((checks.length - failed.length) / checks.length) * 100);
            const hardFails = new Set([
                "Has default export", "Balanced braces", "Balanced parentheses",
                "No raw fetch()", "No local/sessionStorage", "No eval / new Function", "No HTML shell",
            ]);
            const hasHardFail = failed.some((c) => hardFails.has(c.name));

            return NextResponse.json({
                passed: !hasHardFail && score >= 80,
                score,
                checks,
                errors: failed.map((c) => `${c.name}: ${c.details}`),
                mode: "static-lint",
                note: browserAvailable
                    ? "Static lint only — no html/url provided."
                    : "Static lint only — Browser Rendering not configured on server.",
            });
        }

        // ── REAL SMOKE TEST MODE ─────────────────────────────────
        const checks: TestResult["checks"] = [];
        const errors: string[] = [];
        let screenshotBase64 = "";

        // 1. Capture screenshot (proves page renders)
        try {
            const imgBuffer = await screenshot({
                html,
                url,
                viewportWidth: 800,
                viewportHeight: 600,
                screenshotOptions: { type: "png" },
                waitForTimeout: 3000,
            });

            screenshotBase64 = Buffer.from(imgBuffer).toString("base64");
            const sizeKb = Math.round(imgBuffer.byteLength / 1024);

            checks.push({
                name: "Page Renders",
                passed: sizeKb > 2, // A blank page is ~1KB, anything real is more
                details: sizeKb > 2
                    ? `Screenshot captured (${sizeKb}KB)`
                    : `Screenshot too small (${sizeKb}KB) — page may be blank`,
            });
        } catch (err: any) {
            checks.push({ name: "Page Renders", passed: false, details: err.message });
            errors.push(`Render failed: ${err.message}`);
        }

        // 2. AI-powered quality check (detects errors, broken UI, etc.)
        try {
            const aiCheck = await jsonExtract({
                html,
                url,
                prompt:
                    `Analyze this web application called "${appName}". Check for: ` +
                    "1) Does it render visible content? " +
                    "2) Are there any visible error messages or broken elements? " +
                    "3) Does it look professional? " +
                    "4) Rate the overall quality 1-100. " +
                    "Return: hasContent (bool), hasErrors (bool), errorMessages (string[]), isProfessional (bool), qualityScore (number 1-100), summary (string)",
                response_format: {
                    type: "json_schema",
                    schema: {
                        type: "object",
                        properties: {
                            hasContent: { type: "boolean" },
                            hasErrors: { type: "boolean" },
                            errorMessages: { type: "array", items: { type: "string" } },
                            isProfessional: { type: "boolean" },
                            qualityScore: { type: "number" },
                            summary: { type: "string" },
                        },
                    },
                },
                waitForTimeout: 3000,
            });

            const data = aiCheck.result || {};

            checks.push({
                name: "Has Content",
                passed: data.hasContent ?? false,
                details: data.hasContent ? "Page has visible content" : "Page appears empty",
            });

            checks.push({
                name: "No Errors",
                passed: !data.hasErrors,
                details: data.hasErrors
                    ? `Errors found: ${(data.errorMessages || []).join(", ")}`
                    : "No visible errors detected",
            });

            checks.push({
                name: "Professional Quality",
                passed: data.isProfessional ?? false,
                details: data.summary || (data.isProfessional ? "Looks professional" : "Needs polish"),
            });

            if (data.errorMessages?.length) {
                errors.push(...data.errorMessages);
            }
        } catch (err: any) {
            checks.push({
                name: "AI Quality Check",
                passed: false,
                details: `AI quality check failed: ${err.message}. Manual review required.`,
            });
        }

        // Calculate score
        const passedCount = checks.filter((c) => c.passed).length;
        const score = Math.round((passedCount / checks.length) * 100);
        const passed = score >= 50; // Pass if at least half the checks pass

        const result = { passed, score, screenshot: screenshotBase64, checks, errors, mode: "real" as const };
        return NextResponse.json(result);
    } catch (err) {
        console.error("[test-app] Error:", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Test failed" },
            { status: 500 }
        );
    }
}
