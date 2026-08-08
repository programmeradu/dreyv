/**
 * Quick health-check for the Gemini Veo 3 path.
 *   GET /api/debug/veo-ping            -> verifies key + Veo model is listed
 *   GET /api/debug/veo-ping?render=1   -> submits a 5s test clip end-to-end
 */
import { NextResponse } from "next/server";
import { vertexHealthCheck } from "@/lib/media-studio/google-vertex-veo";

export const dynamic = "force-dynamic";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Vertex AI path: GET /api/debug/veo-ping?vertex=1
  if (url.searchParams.get("vertex") === "1") {
    try {
      const r = await vertexHealthCheck();
      return NextResponse.json({ ...r, hint: "Vertex AI Veo reachable. Use provider=veo3-vertex in /api/studio/video/render." });
    } catch (e) {
      return NextResponse.json(
        { ok: false, stage: "vertex", error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ ok: false, stage: "env", error: "GEMINI_API_KEY missing" }, { status: 500 });
  }
  const shape = {
    prefix: key.slice(0, 4),
    length: key.length,
    looks_like_gemini: key.startsWith("AIza"),
  };
  if (!shape.looks_like_gemini) {
    return NextResponse.json(
      { ok: false, stage: "shape", shape, error: "Key does not look like a Gemini API key (expected AIza…). OAuth tokens are not accepted here." },
      { status: 500 },
    );
  }

  // 1) Cheap auth check: list models reachable with this key.
  const listRes = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`);
  const listText = await listRes.text();
  if (!listRes.ok) {
    return NextResponse.json(
      { ok: false, stage: "list_models", status: listRes.status, body: listText.slice(0, 400), shape },
      { status: 500 },
    );
  }
  type ModelEntry = { name?: string; supportedGenerationMethods?: string[] };
  const list = JSON.parse(listText) as { models?: ModelEntry[] };
  const veo = (list.models ?? []).filter((m) => (m.name ?? "").includes("veo"));

  if (url.searchParams.get("render") !== "1") {
    return NextResponse.json({
      ok: true,
      stage: "list_models",
      shape,
      total_models: list.models?.length ?? 0,
      veo_models: veo.map((m) => ({ name: m.name, methods: m.supportedGenerationMethods })),
      hint: "Append ?render=1 to actually submit a 5s test clip (costs Gemini credits).",
    });
  }

  // 2) Optional: submit a tiny real generation to confirm the Veo entitlement.
  const submitRes = await fetch(
    `${BASE}/models/veo-3.0-generate-001:predictLongRunning?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: "A single violet crystal slowly rotating on a white studio backdrop. Soft rim light." }],
        parameters: { aspectRatio: "9:16", durationSeconds: 5, personGeneration: "allow_adult" },
      }),
    },
  );
  const submitText = await submitRes.text();
  if (!submitRes.ok) {
    return NextResponse.json(
      { ok: false, stage: "submit", status: submitRes.status, body: submitText.slice(0, 600), shape, veo_models: veo.map((m) => m.name) },
      { status: 500 },
    );
  }
  const op = JSON.parse(submitText) as { name?: string };
  return NextResponse.json({
    ok: true,
    stage: "submit",
    operation: op.name,
    note: "Veo accepted the job. Full render takes 2–4 min; poll via the studio UI or the existing render route.",
    shape,
  });
}
