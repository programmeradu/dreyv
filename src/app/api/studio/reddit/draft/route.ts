/**
 * POST /api/studio/reddit/draft
 *
 * Generates a Reddit post draft tuned to a specific subreddit + angle.
 * Body: {
 *   subreddit: string,        // e.g. "ClaudeAI" (no r/ prefix)
 *   angle: string,            // one of HERO_HOOKS ids OR "custom"
 *   customAngle?: string,     // when angle === "custom"
 *   tone?: "founder" | "technical" | "contrarian",
 *   length?: "short" | "medium" | "long",
 *   audience?: string,
 * }
 *
 * Returns: {
 *   titles: string[];          // 1 primary + 3 backups
 *   body: string;              // self-post body, markdown OK
 *   firstComment: string;      // OP's first comment (where the link goes)
 *   postingWindow: string;     // recommended posting time / day
 *   complianceChecks: string[];
 * }
 *
 * No persistence — drafts are copied out of the UI by the team.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/media-studio/access";
import { brandSystemPrompt } from "@/lib/media-studio/brand";
import { DREYV_DEV_SURFACE } from "@/lib/media-studio/developers-context";
import { chatJson } from "@/lib/media-studio/ai";

export const maxDuration = 60;

const SCHEMA = {
  name: "dreyv_reddit_draft",
  description: "A subreddit-specific Reddit post draft for Dreyv's MCP/API.",
  parameters: {
    type: "object",
    properties: {
      titles: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 4,
        description: "1 primary + 3 backup titles. No emoji. No clickbait punctuation.",
      },
      body: {
        type: "string",
        description: "Self-post body. Plain text or light markdown. Ends with a question to invite replies.",
      },
      firstComment: {
        type: "string",
        description: "OP's first comment — this is where links live to avoid spam filters.",
      },
      postingWindow: {
        type: "string",
        description: "Recommended day + time window in UTC, with a one-line reason.",
      },
      complianceChecks: {
        type: "array",
        items: { type: "string" },
        description: "Subreddit-specific rule checks the team should re-verify (karma, flair, AI-content stance, self-promo ratio, etc.)",
      },
    },
    required: ["titles", "body", "firstComment", "postingWindow", "complianceChecks"],
  },
} as const;

const HERO_HOOKS = DREYV_DEV_SURFACE.heroHooks;

export async function POST(req: NextRequest) {
  const gate = await requireTeamMember(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: {
    subreddit?: string;
    angle?: string;
    customAngle?: string;
    tone?: "founder" | "technical" | "contrarian";
    length?: "short" | "medium" | "long";
    perspective?: "founder" | "discoverer" | "recommender" | "auto";
    audience?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subreddit = (body.subreddit ?? "").trim().replace(/^r\//, "");
  if (!subreddit) return NextResponse.json({ error: "subreddit is required" }, { status: 400 });

  const angleId = body.angle ?? "wallet-brain";
  const hook = HERO_HOOKS.find((h) => h.id === angleId);
  const angleText =
    angleId === "custom" && body.customAngle
      ? body.customAngle.trim()
      : hook
      ? `${hook.title}\nCapabilities: ${hook.caps}\nSafety: ${hook.safety}`
      : HERO_HOOKS[0].title;

  const tone = body.tone ?? "founder";
  const length = body.length ?? "medium";
  const lengthGuide =
    length === "short"
      ? "Keep it short — a few short paragraphs, the kind of thing you'd dash off between meetings."
      : length === "long"
      ? "Let it breathe — tell the actual story, in the order it happened to you. Ramble a little if it earns it."
      : "Medium length — long enough to tell the story, short enough that it still reads like a person, not a blog post.";

  const toneGuide =
    tone === "technical"
      ? "You're the dev who actually built it. Talk to other devs the way you would in a DM: show the thing, drop the prompt or snippet, skip the throat-clearing."
      : tone === "contrarian"
      ? "You disagree with the consensus in this sub and you're going to say why. Lead with the spicy take. Back it with what you actually shipped, not vibes."
      : "You're the founder writing this yourself, late at night, in the Reddit textbox. Sound like a human thinking out loud — half-formed asides, real opinions, mild self-deprecation. NOT a marketing post wearing a hoodie.";

  const perspective = body.perspective ?? "auto";
  const perspectiveGuide =
    perspective === "discoverer"
      ? `POV: You are a regular r/${subreddit} member who recently stumbled on Dreyv (you do NOT work there). You're sharing what you found because the sub will care. Write in 1st person about YOUR experience using it ("I tried…", "I came across…", "been messing with this thing called Dreyv"). Talk about Dreyv in 3rd person ("they built…", "their MCP…", "the team behind it"). Be honest — mention what's rough or what you're still figuring out. Don't sound like the founder; sound like a user who happens to be enthusiastic.`
      : perspective === "recommender"
      ? `POV: You're a r/${subreddit} regular answering, basically, "what's everyone using for X?" — except you're posting it as a top-level recommendation because you've been quietly using Dreyv and think more people should know. 1st person about you, 3rd person about Dreyv ("they have…", "what won me over was…"). Compare it casually to alternatives you've tried. Caveats and what's missing are fine — they make it credible.`
      : perspective === "founder"
      ? `POV: You ARE the founder/builder behind Dreyv, posting under your own account. 1st person, transparent about that ("I'm building…", "we just shipped…"). No hiding it — Reddit smells stealth marketing instantly. Founder honesty (what's broken, what you're unsure about, what feedback you want) is the whole appeal.`
      : `POV: Pick whichever framing actually lands best in r/${subreddit} for this angle — founder sharing what they built (1st person, transparent), a user who discovered Dreyv and is telling the sub (1st person about themselves, 3rd person about Dreyv), or a recommender answering an implicit "what do you use for X". Whichever you pick, commit to it fully and never break the frame mid-post. Be honest about which one you chose — the title and body should make the POV obvious from the first line.`;

  const userPrompt = [
    `You're writing a Reddit self-post to r/${subreddit}.`,
    ``,
    perspectiveGuide,
    ``,
    `Raw material to work from (not a script — riff, reorder, drop what doesn't fit the POV):`,
    angleText,
    ``,
    `How it should sound: ${toneGuide}`,
    `How long: ${lengthGuide}`,
    body.audience ? `Who in r/${subreddit} you're actually thinking about as you write: ${body.audience}` : null,
    ``,
    `WRITE LIKE A REAL REDDIT POSTER:`,
    `- Open with something that sounds like a thought, not a headline. "Spent the weekend trying to…", "Hot take but…", "Anyone else noticed…", "Ok so I gave Claude…", "Been looking for X forever and finally found…". Whatever fits the POV. Just don't open like a press release.`,
    `- Vary sentence length. Use fragments. Start sentences with "And" or "But" if it sounds right.`,
    `- Be specific. One real example beats three abstract claims. If you can describe the exact prompt you typed and what came back, do that.`,
    `- It's fine to be unsure, to admit something didn't work the first time, to say "not sponsored, just genuinely impressed" if you're in discoverer/recommender mode. That's what makes it real.`,
    `- Light formatting only. Maybe one short code block or one short list if it genuinely helps. No bold headers carving the post into "sections". This is Reddit, not a Notion doc.`,
    `- End however a person would end — a question, an aside, an ask for war stories, "curious what others have tried". Not "Let me know your thoughts! 👇".`,
    ``,
    `HARD DON'TS:`,
    `- No emoji. No hashtags. No "Hey Reddit!". No "TL;DR" at the top. No "In conclusion".`,
    `- No marketing voice. If a sentence could appear on a landing page, rewrite it or cut it.`,
    `- No Title Case titles. Titles read like a sentence or a thought, lowercase or sentence case, under ~100 chars.`,
    `- No links inside the post body — links go in the first comment only. Use plain ${DREYV_DEV_SURFACE.homepage} / ${DREYV_DEV_SURFACE.mcp} there, no UTMs, no shorteners.`,
    `- Don't name-drop Dreyv every paragraph. In discoverer/recommender POV especially, name it once or twice max — the post is about the problem and the experience, not the brand.`,
    `- Never break the POV. If you chose discoverer, never accidentally write "we built" or "our MCP". If you chose founder, don't pretend to be a random user.`,
    `- If r/${subreddit} is crypto-skeptical, lean into the dev-tool / agent angle and let the on-chain part be incidental. If it's crypto-native, the opposite.`,
    ``,
    `Give me:`,
    `- 4 title options (1 you'd actually post + 3 alternates with different angles/voice). All sentence case, under 100 chars, no clickbait punctuation.`,
    `- The post body, written as the person would actually type it.`,
    `- The first comment from OP — short, human, in the same POV as the body. Drops the link(s). Discoverer/recommender POV: phrase it like "link in case anyone wants to poke at it" — never like a CTA.`,
    `- A posting window in UTC with a one-line "why this time" (when this sub is actually awake and reading).`,
    `- A short compliance checklist specific to r/${subreddit} (karma/age/flair/self-promo ratio/AI-content stance — whatever actually applies there) so the team can double-check before hitting post.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await chatJson<{
      titles: string[];
      body: string;
      firstComment: string;
      postingWindow: string;
      complianceChecks: string[];
    }>({
      messages: [
        {
          role: "system",
          content:
            "You are ghost-writing Reddit self-posts for a founder. Your job is to sound like a real person typing on Reddit — not a brand, not a marketer, not an AI. Voice over polish. Specificity over hype. It's OK (good, actually) to be a little messy, opinionated, self-deprecating, or unsure. Never use emoji, hashtags, Title Case headlines, or marketing phrases. Never start with 'Hey Reddit'. Never end with 'Let me know your thoughts'. The reader should not be able to tell this was AI-written.",
        },
        { role: "user", content: userPrompt },
      ],
      schema: SCHEMA,
      temperature: 1.0,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("[reddit/draft] AI call failed:", message, err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
