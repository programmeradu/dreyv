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
            const checks = [
                { name: "Source provided", passed: !!src, details: src ? `${src.length} chars` : "No code submitted" },
                { name: "Has default export", passed: /export\s+default/.test(src), details: /export\s+default/.test(src) ? "Found" : "Missing default export" },
                { name: "No eval()", passed: !/\beval\s*\(/.test(src), details: "No dynamic eval calls" },
                { name: "No document.cookie", passed: !/document\.cookie/.test(src), details: "No cookie access" },
                { name: "Uses dreyv SDK", passed: /@keystone-os\/sdk|@dreyv\/sdk/.test(src), details: /@keystone-os\/sdk|@dreyv\/sdk/.test(src) ? "SDK import found" : "Consider using SDK hooks" },
            ];
            const passedCount = checks.filter((c) => c.passed).length;
            const score = Math.round((passedCount / checks.length) * 100);
            return NextResponse.json({
                passed: score >= 60,
                score,
                checks,
                errors: [],
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

        const result: TestResult = { passed, score, screenshot: screenshotBase64, checks, errors };
        return NextResponse.json(result);
    } catch (err) {
        console.error("[test-app] Error:", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Test failed" },
            { status: 500 }
        );
    }
}
