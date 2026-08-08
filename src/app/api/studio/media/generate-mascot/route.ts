export const runtime = "edge";
/**
 * POST /api/studio/media/generate-mascot
 *
 * Generates a Dreyv-mascot social visual. The chosen mascot pose PNG is sent
 * to the image model as a reference so the character stays consistent
 * (deep violet owl-fox with cap + Dreyv diamond) instead of being re-imagined
 * every call. The user supplies a scene prompt; we compose around the mascot.
 *
 * Body: { pose: 'greet'|'think'|'celebrate'|'alert', prompt: string,
 *         channel?: Channel, aspect?: '1:1'|'16:9'|'9:16'|'4:5', title?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import type { Channel } from "@/lib/media-studio/brand";

export const maxDuration = 60;

type Pose = "greet" | "think" | "celebrate" | "alert";
const VALID_POSES: ReadonlyArray<Pose> = ["greet", "think", "celebrate", "alert"];

const POSE_DESCRIPTIONS: Record<Pose, string> = {
  greet: "warm waving / pointing-forward greeting pose",
  think: "thoughtful, hand-on-chin curious pose",
  celebrate: "arms-up celebratory pose",
  alert: "concerned, palms-raised alert / stop pose",
};

function aspectToSize(a: string | undefined): { w: number; h: number } {
  switch (a) {
    case "16:9": return { w: 1792, h: 1024 };
    case "9:16": return { w: 1024, h: 1792 };
    case "4:5":  return { w: 1024, h: 1280 };
    default:     return { w: 1024, h: 1024 };
  }
}

function fallbackPreviewUrl(title: string | undefined, aspect: string | undefined) {
  const label = (title || "Dreyv mascot visual").slice(0, 64).replace(/[<>&]/g, "");
  const { w, h } = aspectToSize(aspect);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#ffffff"/><circle cx="${Math.round(w * 0.5)}" cy="${Math.round(h * 0.5)}" r="${Math.round(Math.min(w, h) * 0.32)}" fill="#7c3aed" opacity="0.18"/><text x="${Math.round(w * 0.5)}" y="${Math.round(h * 0.5)}" text-anchor="middle" fill="#171026" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(w, h) * 0.05)}" font-weight="700">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function loadMascotReference(pose: Pose, req: NextRequest): Promise<{ buffer: Buffer; mime: string }> {
  const filename = `dreyv-${pose}.png`;
  try {
    const origin = new URL(req.url).origin;
    const res = await fetch(`${origin}/mascot/${filename}`);
    if (res.ok) {
      const arrayBuf = await res.arrayBuffer();
      return { buffer: Buffer.from(arrayBuf), mime: "image/png" };
    }
  } catch {
    // Fall back to production CDN domain if relative fetch fails
  }
  try {
    const res = await fetch(`https://dreyv.com/mascot/${filename}`);
    if (res.ok) {
      const arrayBuf = await res.arrayBuffer();
      return { buffer: Buffer.from(arrayBuf), mime: "image/png" };
    }
  } catch {
    // Fall through to error
  }
  throw new Error(`Mascot reference not found for pose "${pose}"`);
}

function mascotPrompt(pose: Pose, scene: string, aspect: string | undefined): string {
  return [
    `You are composing a premium social-media visual for Dreyv (an agentic treasury OS for Solana-first founders).`,
    ``,
    `MASCOT (provided as reference image): "Dreyv" — a deep violet owl-fox character with a cream face/chest, dark eyes, a violet cap with the Dreyv diamond mark, a small Dreyv diamond on its chest, and a fluffy fox tail.`,
    `Current pose: ${POSE_DESCRIPTIONS[pose]}.`,
    ``,
    `RULES — these are non-negotiable:`,
    `- Use the EXACT mascot from the reference image. Do not redesign, recolor, restyle, or modernize the character. Same proportions, same cap with diamond, same chest mark, same tail.`,
    `- Keep the mascot recognizable and prominent in the frame.`,
    `- Background: clean white with subtle violet (#7c3aed) ambient glow. No gradient mush. No glassmorphism. No 3D photoreal renders.`,
    `- No additional text, captions, UI chrome, browser frames, or fake screenshots unless explicitly requested in the scene.`,
    `- No other characters or people.`,
    `- Aspect ratio: ${aspect ?? "1:1"}. Compose for this frame.`,
    ``,
    `SCENE: ${scene}`,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  let body: { pose?: Pose; prompt?: string; channel?: Channel; aspect?: string; title?: string } = {};
  try {
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const [
      { requireTeamMember, STUDIO_PASS_USER_ID },
      { generateImage },
      { putR2Object, presignR2Get, isR2Configured },
      dbModule,
      schemaModule,
      cryptoModule,
    ] = await Promise.all([
      import("@/lib/media-studio/access"),
      import("@/lib/media-studio/ai"),
      import("@/lib/agents/artifacts/r2-storage"),
      import("@/db"),
      import("@/db/schema"),
      import("crypto"),
    ]);

    const gate = await requireTeamMember(req);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const pose: Pose = VALID_POSES.includes(body.pose as Pose) ? (body.pose as Pose) : "greet";
    const scene = (body.prompt ?? "").trim();
    if (!scene) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const { w, h } = aspectToSize(body.aspect);

    if (!isR2Configured()) {
      return NextResponse.json({
        asset: null,
        previewUrl: fallbackPreviewUrl(body.title, body.aspect),
        fallback: true,
        error: "Image storage is not configured on production yet, so Dreyv returned a lightweight preview instead of a raw server error.",
      });
    }

    const reference = await loadMascotReference(pose, req);
    const fullPrompt = mascotPrompt(pose, scene, body.aspect);
    const { buffer, mime } = await generateImage({
      prompt: fullPrompt,
      referenceImages: [reference],
    });

    const storageKey = `media-studio/${gate.user.id}/${cryptoModule.randomUUID()}.png`;
    await putR2Object({ key: storageKey, body: buffer, mime, filename: `dreyv-mascot-${pose}.png` });

    const db = dbModule.db;
    const persistedUserId = gate.user.id === STUDIO_PASS_USER_ID ? null : gate.user.id;
    const [row] = db
      ? await db.insert(schemaModule.mediaStudioAssets).values({
          userId: persistedUserId,
          kind: "post",
          channel: body.channel ?? null,
          title: body.title ?? `Dreyv (${pose})`,
          prompt: scene,
          spec: { aspect: body.aspect ?? "1:1", model: "gemini-3.1-flash-image-preview", mascotPose: pose },
          storageKey,
          mimeType: mime,
          width: w,
          height: h,
          status: "ready",
        }).returning()
      : [null];

    const previewUrl = await presignR2Get({ key: storageKey, filename: `dreyv-mascot-${pose}.png`, mime, inline: true });

    return NextResponse.json({ asset: row, previewUrl, pose });
  } catch (err) {
    console.error("[generate-mascot] failed", err);
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : "Mascot generation failed";
    return NextResponse.json(
      {
        asset: null,
        previewUrl: fallbackPreviewUrl(body.title, body.aspect),
        fallback: true,
        error: msg,
      },
      { status: 200 },
    );
  }
}
