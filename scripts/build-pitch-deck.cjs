/**
 * Dreyv Pitch Deck — premium editorial rebuild.
 * - Sandwich structure (dark violet title + closing, light content between)
 * - Dedicated visual panels (mascot/hero NEVER overlaps text)
 * - Big stat callouts, numbered chips, asymmetric layouts
 * - Solid violet only (no gradients), Manrope, Stitch-light DNA
 * Output: public/pitch/dreyv-pitch-deck.pptx
 */
const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");

const REPO = "/dev-server";
const PUB = path.join(REPO, "public");
const OUT_PPTX = path.join(PUB, "pitch", "dreyv-pitch-deck.pptx");

// ---------- palette ----------
const VIOLET = "7C3AED";
const VIOLET_DEEP = "4C1D95";
const VIOLET_DARK = "5B21B6";
const VIOLET_300 = "C4B5FD";
const VIOLET_200 = "DDD6FE";
const VIOLET_100 = "EDE9FE";
const VIOLET_50 = "F5F3FF";
const INK = "0F172A";
const SLATE = "475569";
const MUTED = "94A3B8";
const LINE = "E2E8F0";
const WHITE = "FFFFFF";
const CREAM = "FAF7FF";
const AMBER = "F59E0B";

// ---------- assets ----------
function b64(p) {
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
const MASCOT = {
  greet: b64(path.join(PUB, "mascot/dreyv-greet.png")),
  think: b64(path.join(PUB, "mascot/dreyv-think.png")),
  celebrate: b64(path.join(PUB, "mascot/dreyv-celebrate.png")),
  alert: b64(path.join(PUB, "mascot/dreyv-alert.png")),
};
const LOGO = {
  dune:       b64(path.join(PUB, "pitch/logos/dune.png")),
  nansen:     b64(path.join(PUB, "pitch/logos/nansen.png")),
  streamflow: b64(path.join(PUB, "pitch/logos/streamflow.png")),
  magna:      b64(path.join(PUB, "pitch/logos/magna.png")),
  fireblocks: b64(path.join(PUB, "pitch/logos/fireblocks.png")),
  safe:       b64(path.join(PUB, "pitch/logos/safe.png")),
};

// ---------- pptx setup ----------
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pptx.title = "Dreyv — AI Operating System for On-Chain Treasury";
pptx.author = "Dreyv";
pptx.company = "Dreyv (StaUniverse)";
const W = 13.333;
const H = 7.5;
const FONT = "Manrope";

// ---------- shared primitives ----------
function rect(slide, x, y, w, h, color) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color }, line: { color } });
}
function rrect(slide, x, y, w, h, color, radius = 0.16, lineColor) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color },
    line: { color: lineColor || color, width: lineColor ? 1 : 0 },
    rectRadius: radius,
  });
}
function ellipse(slide, x, y, w, h, color) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y, w, h, fill: { color }, line: { color } });
}
function text(slide, str, opts) {
  slide.addText(str, { fontFace: FONT, ...opts });
}
function star(slide, x, y, size = 0.18, color = VIOLET) {
  slide.addShape(pptx.ShapeType.star4, { x, y, w: size, h: size, fill: { color }, line: { color } });
}

// ---------- chrome (header / footer) ----------
function brandMark(slide, x, y, color = VIOLET, size = 0.34) {
  // Mini Dreyv "star4" mark in a rounded square
  rrect(slide, x, y, size, size, color, 0.06);
  star(slide, x + size * 0.22, y + size * 0.22, size * 0.56, WHITE);
}
const TOTAL = 16;
let pageNum = 0;

function chrome(slide, { dark = false } = {}) {
  const fg = dark ? WHITE : INK;
  const sub = dark ? VIOLET_200 : MUTED;
  brandMark(slide, 0.55, 0.4, dark ? WHITE : VIOLET, 0.32);
  text(slide, "DREYV", {
    x: 0.97, y: 0.4, w: 2, h: 0.32,
    fontSize: 13, bold: true, color: dark ? WHITE : INK, charSpacing: 6, valign: "middle",
  });
  text(slide, `${String(pageNum).padStart(2, "0")} / ${String(TOTAL).padStart(2, "0")}`, {
    x: W - 1.5, y: 0.4, w: 1, h: 0.32, fontSize: 10, color: sub, align: "right", valign: "middle",
  });
  // Footer: thin rule + label
  rect(slide, 0.55, H - 0.55, W - 1.1, 0.012, dark ? VIOLET_DARK : LINE);
  text(slide, "DREYV  ·  AI OPERATING SYSTEM FOR ON-CHAIN TREASURY", {
    x: 0.55, y: H - 0.42, w: W / 2, h: 0.28, fontSize: 8.5, color: sub, charSpacing: 2,
  });
  text(slide, "PITCH · 2026", {
    x: W - 2.2, y: H - 0.42, w: 1.65, h: 0.28, fontSize: 8.5, color: sub, charSpacing: 2, align: "right",
  });
}

function newSlide({ dark = false } = {}) {
  pageNum += 1;
  const s = pptx.addSlide();
  s.background = { color: dark ? VIOLET_DEEP : WHITE };
  return { s, dark };
}

// Editorial split: left content area + right visual panel.
const LEFT = { x: 0.7, y: 1.2, w: 7.4 };
const PANEL = { x: 8.4, y: 1.0, w: 4.4, h: 5.5 };

function eyebrow(slide, str, x = LEFT.x, y = 1.25, color = VIOLET) {
  // Tiny accent bar + label
  rect(slide, x, y + 0.12, 0.22, 0.04, color);
  text(slide, str, {
    x: x + 0.32, y, w: 6, h: 0.28, fontSize: 10, bold: true, color, charSpacing: 4, valign: "middle",
  });
}
function title(slide, str, opts = {}) {
  text(slide, str, {
    x: LEFT.x, y: 1.7, w: LEFT.w, h: 1.6, fontSize: 38, bold: true, color: INK,
    valign: "top", lineSpacingMultiple: 1.05, ...opts,
  });
}
function lede(slide, str, opts = {}) {
  text(slide, str, {
    x: LEFT.x, y: 3.4, w: LEFT.w, h: 0.7, fontSize: 15, color: SLATE, valign: "top", ...opts,
  });
}

// Right-side visual panel with mascot perched on a violet block + decorative grid
function visualPanel(slide, mascotKey, { tone = "light", caption } = {}) {
  const x = PANEL.x, y = PANEL.y, w = PANEL.w, h = PANEL.h;
  // Outer violet block (solid, no gradient)
  rrect(slide, x, y, w, h, tone === "dark" ? VIOLET_DEEP : VIOLET_50, 0.24);
  // Inner violet block (deeper)
  rrect(slide, x + 0.35, y + 0.35, w - 0.7, h - 1.6, tone === "dark" ? VIOLET_DARK : VIOLET, 0.18);
  // Decorative star pattern
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      star(
        slide,
        x + 0.55 + c * 0.55,
        y + 0.55 + r * 0.45,
        0.08,
        tone === "dark" ? VIOLET_DARK : "8B5CF6",
      );
    }
  }
  // Mascot — centered, large, NO text overlap
  if (mascotKey && MASCOT[mascotKey]) {
    const mw = w - 1.2;
    slide.addImage({
      data: MASCOT[mascotKey],
      x: x + (w - mw) / 2,
      y: y + 0.4,
      w: mw,
      h: mw,
    });
  }
  // Caption strip at bottom of panel
  if (caption) {
    text(slide, caption, {
      x: x + 0.4, y: y + h - 1.0, w: w - 0.8, h: 0.7,
      fontSize: 11, color: tone === "dark" ? WHITE : INK, italic: true, valign: "middle", align: "center",
    });
  }
}

function bigPunch(slide, str, { dark = false } = {}) {
  // Bold punchline strip at the bottom-left, not full width
  const y = H - 1.25, h = 0.7, w = 9.2;
  rrect(slide, 0.7, y, w, h, dark ? WHITE : VIOLET, 0.14);
  text(slide, str, {
    x: 0.7, y, w, h, fontSize: 15, bold: true,
    color: dark ? VIOLET_DEEP : WHITE, align: "center", valign: "middle",
  });
}

// Numbered card (for steps / persona / cards)
function card(slide, { x, y, w, h, n, label, title: t, body, accent = VIOLET }) {
  rrect(slide, x, y, w, h, WHITE, 0.18, VIOLET_200);
  // Number chip
  if (n) {
    rrect(slide, x + 0.3, y + 0.3, 0.55, 0.55, accent, 0.1);
    text(slide, n, {
      x: x + 0.3, y: y + 0.3, w: 0.55, h: 0.55,
      fontSize: 13, bold: true, color: WHITE, align: "center", valign: "middle",
    });
  }
  if (label) {
    text(slide, label, {
      x: x + (n ? 1.0 : 0.3), y: y + 0.32, w: w - (n ? 1.3 : 0.6), h: 0.3,
      fontSize: 9, bold: true, color: accent, charSpacing: 3, valign: "middle",
    });
  }
  if (t) {
    text(slide, t, {
      x: x + 0.3, y: y + (n ? 1.0 : 0.7), w: w - 0.6, h: 0.4,
      fontSize: 16, bold: true, color: INK, valign: "top",
    });
  }
  if (body) {
    text(slide, body, {
      x: x + 0.3, y: y + (n ? 1.45 : 1.15), w: w - 0.6, h: h - (n ? 1.55 : 1.25),
      fontSize: 11.5, color: SLATE, valign: "top", lineSpacingMultiple: 1.3,
    });
  }
}

// Big-stat callout
function statBlock(slide, { x, y, w, h, value, unit, label, body }) {
  rrect(slide, x, y, w, h, WHITE, 0.2, VIOLET_200);
  // Left violet bar accent
  rect(slide, x, y, 0.08, h, VIOLET);
  text(slide, value, {
    x: x + 0.35, y: y + 0.25, w: w - 0.7, h: 1.5,
    fontSize: 64, bold: true, color: VIOLET, valign: "top",
  });
  if (unit) {
    text(slide, unit, {
      x: x + 0.35, y: y + 0.45, w: w - 0.7, h: 0.4,
      fontSize: 14, color: VIOLET, italic: true, align: "right",
    });
  }
  text(slide, label, {
    x: x + 0.35, y: y + 1.6, w: w - 0.7, h: 0.4,
    fontSize: 12, bold: true, color: INK, valign: "top",
  });
  if (body) {
    text(slide, body, {
      x: x + 0.35, y: y + 2.0, w: w - 0.7, h: h - 2.1,
      fontSize: 10.5, color: SLATE, valign: "top", lineSpacingMultiple: 1.3,
    });
  }
}

// =====================================================================
// SLIDE 1 — Title (DARK editorial cover)
// =====================================================================
{
  const { s } = newSlide({ dark: true });
  // Background base = VIOLET_DEEP. Add solid violet diagonal block.
  rect(s, W * 0.55, 0, W * 0.45, H, VIOLET);
  // Decorative perfect circles (solid)
  ellipse(s, -3, H - 4, 7, 7, VIOLET_DARK);
  ellipse(s, W - 2, -2, 5, 5, "6D28D9");
  // Pattern of stars on right block
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 6; c++) {
      star(s, W * 0.58 + c * 0.55, 0.4 + r * 0.55, 0.08, "8B5CF6");
    }
  }

  // pageNum already incremented by newSlide() above
  brandMark(s, 0.7, 0.7, WHITE, 0.4);
  text(s, "DREYV", {
    x: 1.2, y: 0.72, w: 3, h: 0.4, fontSize: 16, bold: true, color: WHITE, charSpacing: 8, valign: "middle",
  });
  text(s, `${String(pageNum).padStart(2, "0")} / ${String(TOTAL).padStart(2, "0")}`, {
    x: W - 1.5, y: 0.72, w: 1, h: 0.4, fontSize: 10, color: VIOLET_200, align: "right", valign: "middle",
  });

  // Big editorial wordmark
  text(s, "AI OPERATING SYSTEM", {
    x: 0.7, y: 2.0, w: 9, h: 0.45, fontSize: 13, bold: true, color: VIOLET_300, charSpacing: 8,
  });
  text(s, "Treasury,\nautomated.", {
    x: 0.7, y: 2.55, w: 8, h: 3.0,
    fontSize: 88, bold: true, color: WHITE, valign: "top", lineSpacingMultiple: 0.95,
  });
  // Underline accent
  rect(s, 0.7, 5.6, 1.2, 0.08, WHITE);
  text(s, "Automate.   Simulate.   Execute — safely.", {
    x: 0.7, y: 5.85, w: 9, h: 0.5, fontSize: 18, color: WHITE, italic: true, valign: "middle",
  });

  // Bottom strip
  rect(s, 0, H - 0.7, W, 0.012, VIOLET_DARK);
  text(s, "PITCH DECK · 2026", {
    x: 0.7, y: H - 0.55, w: 4, h: 0.4, fontSize: 10, color: VIOLET_200, charSpacing: 4, valign: "middle",
  });
  text(s, "DREYV.COM", {
    x: W - 3, y: H - 0.55, w: 2.3, h: 0.4, fontSize: 10, color: VIOLET_200, charSpacing: 4, align: "right", valign: "middle",
  });
}

// =====================================================================
// SLIDE 2 — Problem
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "PROBLEM · 02");
  title(s, "Managing on-chain\ntreasury is broken.");
  lede(s, "Every operation is a juggling act of dashboards, signers, and chats — with no way to see the outcome before it's irreversible.");

  // Right panel: alert mascot in a deep-violet block w/ caption
  visualPanel(s, "alert", { tone: "dark", caption: "“One mistake = irreversible.”" });

  // Left: 5 pain rows, each as a slim card (number + line)
  const pains = [
    ["47", "clicks across 5+ tools for a single operation"],
    ["0", "way to simulate outcomes before execution"],
    ["100%", "of errors are manual, costly, irreversible"],
    ["Hrs", "lost coordinating signers, ops, finance"],
    ["1", "wrong tx wipes weeks of strategy"],
  ];
  const py = 4.25, ph = 0.46, pgap = 0.08, pw = 7.4;
  pains.forEach(([n, body], i) => {
    const yy = py + i * (ph + pgap);
    rrect(s, LEFT.x, yy, pw, ph, CREAM, 0.08);
    text(s, n, {
      x: LEFT.x + 0.18, y: yy, w: 0.9, h: ph,
      fontSize: 16, bold: true, color: VIOLET, align: "center", valign: "middle",
    });
    rect(s, LEFT.x + 1.05, yy + 0.1, 0.012, ph - 0.2, VIOLET_200);
    text(s, body, {
      x: LEFT.x + 1.2, y: yy, w: pw - 1.4, h: ph,
      fontSize: 12.5, color: INK, valign: "middle",
    });
  });
}

// =====================================================================
// SLIDE 3 — Why It Matters (4 stat cards)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "WHY IT MATTERS · 03");
  title(s, "The hidden cost\nof doing nothing.", { w: 10 });
  lede(s, "Every day without a treasury OS bleeds yield, time, and confidence.", { w: 12 });

  const stats = [
    { value: "—%", label: "YIELD LEFT ON TABLE", body: "Idle capital while teams wait for the next signer." },
    { value: "0", label: "WINDOWS CAUGHT IN TIME", body: "DeFi opportunities open and close in minutes." },
    { value: "5×", label: "COORDINATION OVERHEAD", body: "Hours moving between dashboards, signers, chats." },
    { value: "1", label: "WRONG SIGN, IRREVERSIBLE", body: "Every transaction is a high-stakes guess." },
  ];
  const cw = 2.95, ch = 2.0, gx = 0.7, gy = 4.2, gap = 0.18;
  stats.forEach((st, i) => {
    statBlock(s, { x: gx + i * (cw + gap), y: gy, w: cw, h: ch, ...st });
  });

  bigPunch(s, "Capital is active. Operations are not.");
}

// =====================================================================
// SLIDE 4 — Category Gap (table with hero column)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "CATEGORY GAP · 04");
  title(s, "What exists vs.\nwhat's missing.", { w: 10 });

  const rows = [
    { cat: "ANALYTICS", logos: ["dune", "nansen"],     names: ["Dune", "Nansen"],          gap: "Insights — no execution." },
    { cat: "EXECUTION", logos: ["streamflow", "magna"], names: ["Streamflow", "Magna"],     gap: "Execution — no intelligence." },
    { cat: "CUSTODY",   logos: ["fireblocks", "safe"],  names: ["Fireblocks", "Safe"],      gap: "Security — no orchestration." },
    { cat: "DREYV",     logos: [],                      names: ["The treasury operating system"], gap: "Plan + simulate + execute." },
  ];
  const ry0 = 4.05, rh = 0.78, rgap = 0.1, rx = 0.7, rw = W - 1.4;
  rows.forEach((r, i) => {
    const last = i === rows.length - 1;
    const y = ry0 + i * (rh + rgap);
    rrect(s, rx, y, rw, rh, last ? VIOLET : WHITE, 0.12, last ? VIOLET : VIOLET_200);
    text(s, r.cat, {
      x: rx + 0.3, y, w: 1.6, h: rh,
      fontSize: 11, bold: true, color: last ? WHITE : VIOLET, charSpacing: 4, valign: "middle",
    });
    // Logos + names cluster
    const baseX = rx + 2.0;
    const logoSize = 0.4;
    r.logos.forEach((key, j) => {
      // White rounded chip behind logo for contrast
      const cx = baseX + j * 2.4;
      rrect(s, cx, y + (rh - 0.56) / 2, 0.56, 0.56, WHITE, 0.1, VIOLET_200);
      s.addImage({
        data: LOGO[key],
        x: cx + 0.08, y: y + (rh - logoSize) / 2,
        w: logoSize, h: logoSize,
      });
      text(s, r.names[j] || "", {
        x: cx + 0.7, y, w: 1.65, h: rh,
        fontSize: 13, bold: true, color: last ? WHITE : INK, valign: "middle",
      });
    });
    if (last) {
      text(s, r.names[0], {
        x: baseX, y, w: 5.0, h: rh,
        fontSize: 14, bold: true, color: WHITE, italic: true, valign: "middle",
      });
    }
    rect(s, rx + 7.3, y + 0.2, 0.012, rh - 0.4, last ? VIOLET_DARK : VIOLET_200);
    text(s, r.gap, {
      x: rx + 7.5, y, w: rw - 7.7, h: rh,
      fontSize: 13, bold: last, color: last ? WHITE : INK, valign: "middle",
    });
  });

  // bigPunch removed — the 4-row table fills the slide
}

// =====================================================================
// SLIDE 5 — Solution
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "SOLUTION · 05");
  title(s, "Dreyv: the AI-powered\ntreasury operating system.");
  lede(s, "Type intent in plain English. Agents plan, simulate, and execute — non-custodially.");

  visualPanel(s, "greet", { tone: "dark", caption: "“Your keys. Your assets. Your intent.”" });

  // Left: 4 pillar chips
  const pillars = [
    ["INTENT", "Type what you want — in plain English."],
    ["PLAN", "AI agents draft the safest path."],
    ["SIMULATE", "Every tx validated before signing."],
    ["EXECUTE", "Non-custodial. Always. By design."],
  ];
  const py = 4.3, ph = 0.5, pgap = 0.1, pw = 7.4;
  pillars.forEach(([k, v], i) => {
    const yy = py + i * (ph + pgap);
    rrect(s, LEFT.x, yy, pw, ph, CREAM, 0.1);
    rect(s, LEFT.x, yy, 0.06, ph, VIOLET);
    text(s, k, {
      x: LEFT.x + 0.25, y: yy, w: 1.6, h: ph,
      fontSize: 11, bold: true, color: VIOLET, charSpacing: 3, valign: "middle",
    });
    text(s, v, {
      x: LEFT.x + 1.95, y: yy, w: pw - 2.1, h: ph,
      fontSize: 13, color: INK, valign: "middle",
    });
  });
}

// =====================================================================
// SLIDE 6 — How It Works (6-step flow with arrows)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "HOW IT WORKS · 06");
  title(s, "Simple. Safe. Intelligent.", { w: 11 });
  lede(s, "Six steps, one continuous loop — from human intent to on-chain outcome.", { w: 12 });

  const steps = [
    ["01", "Intent", "Plain English"],
    ["02", "Plan", "AI tx plan"],
    ["03", "Simulate", "Validate risks"],
    ["04", "Review", "War Room sign-off"],
    ["05", "Execute", "Signed on-chain"],
    ["06", "Monitor", "AI oversight"],
  ];
  const cw = 1.85, ch = 2.4, gy = 4.2, gap = 0.12;
  const totalW = steps.length * cw + (steps.length - 1) * gap;
  const startX = (W - totalW) / 2;
  steps.forEach((st, i) => {
    const x = startX + i * (cw + gap);
    // Alternating tone for rhythm
    const dark = i % 2 === 1;
    rrect(s, x, gy, cw, ch, dark ? VIOLET : WHITE, 0.18, dark ? VIOLET : VIOLET_200);
    text(s, st[0], {
      x: x + 0.25, y: gy + 0.25, w: cw - 0.5, h: 0.4,
      fontSize: 10, bold: true, color: dark ? VIOLET_200 : VIOLET, charSpacing: 3,
    });
    text(s, st[1], {
      x: x + 0.25, y: gy + 0.7, w: cw - 0.5, h: 0.6,
      fontSize: 20, bold: true, color: dark ? WHITE : INK,
    });
    rect(s, x + 0.25, gy + 1.45, 0.5, 0.04, dark ? WHITE : VIOLET);
    text(s, st[2], {
      x: x + 0.25, y: gy + 1.6, w: cw - 0.5, h: 0.7,
      fontSize: 11, color: dark ? VIOLET_200 : SLATE, valign: "top",
    });
    // Connector arrow between cards
    if (i < steps.length - 1) {
      const ax = x + cw + 0.005;
      slide_addArrow(s, ax, gy + ch / 2 - 0.05, gap - 0.01, 0.1, VIOLET);
    }
  });

  bigPunch(s, "Simulate  →  Validate  →  Execute.");
}
function slide_addArrow(slide, x, y, w, h, color) {
  slide.addShape(pptx.ShapeType.rightArrow, {
    x, y: y - h / 2 + 0.05, w, h,
    fill: { color }, line: { color },
  });
}

// =====================================================================
// SLIDE 7 — Differentiation (USP) 4 cards
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "DIFFERENTIATION · 07");
  title(s, "Why Dreyv wins.", { w: 8 });
  lede(s, "Four design choices that no one else in the market combines today.", { w: 12 });

  const cards = [
    { n: "01", label: "SIMULATION-FIRST", title: "No blind transactions.", body: "Every action validated before signing — outcome, slippage, risk." },
    { n: "02", label: "AGENTS, NOT DASHBOARDS", title: "AI does the work.", body: "You set the intent. Agents draft, plan, and propose." },
    { n: "03", label: "PLAIN ENGLISH → ACTION", title: "Natural language signing.", body: "Compiled into safe, deterministic on-chain operations." },
    { n: "04", label: "NON-CUSTODIAL", title: "Keys stay with you.", body: "Always. Architecture, not policy. No middlemen, no surprise." },
  ];
  const cw = 5.95, ch = 1.45, gx = 0.7, gy = 4.2, gap = 0.18;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    card(s, { x: gx + col * (cw + gap), y: gy + row * (ch + gap), w: cw, h: ch, ...c });
  });

  bigPunch(s, "Confidence before execution.");
}

// =====================================================================
// SLIDE 8 — Competitive table (kept, restyled darker hero column)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "COMPETITIVE LANDSCAPE · 08");
  title(s, "We are the missing\nexecution intelligence layer.");

  const headers = ["Capability", "Dune", "Fireblocks", "Streamflow", "DREYV"];
  const rows = [
    ["Analytics",      "✓", "—", "—", "✓"],
    ["Execution",      "—", "✓", "✓", "✓"],
    ["AI Automation",  "—", "—", "—", "✓"],
    ["Simulation",     "—", "—", "—", "✓"],
    ["Unified System", "—", "—", "—", "✓"],
  ];
  const tableData = [
    headers.map((h, i) => ({
      text: h,
      options: {
        bold: true, color: i === 4 ? WHITE : INK,
        fill: { color: i === 4 ? VIOLET : VIOLET_50 },
        align: i === 0 ? "left" : "center", fontFace: FONT, fontSize: 13,
        charSpacing: i === 4 ? 4 : 0,
      },
    })),
    ...rows.map((r) => r.map((cell, i) => ({
      text: cell,
      options: {
        color: i === 4 ? WHITE : (cell === "✓" ? INK : MUTED),
        bold: i === 4 || (i > 0 && cell === "✓"),
        align: i === 0 ? "left" : "center",
        fontFace: FONT, fontSize: 14,
        fill: { color: i === 4 ? VIOLET : WHITE },
      },
    }))),
  ];
  s.addTable(tableData, {
    x: 0.7, y: 4.05, w: W - 1.4,
    colW: [3.6, 2.0, 2.2, 2.2, 1.93],
    rowH: 0.5,
    border: { type: "solid", pt: 0.5, color: VIOLET_200 },
    fontFace: FONT,
  });

  bigPunch(s, "The only column with a check in every row.");
}

// =====================================================================
// SLIDE 9 — Market (giant stat hero)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "MARKET · 09");
  title(s, "On-chain capital is\ncompounding fast.", { w: 9 });

  // Giant left stat
  const sx = 0.7, sy = 4.05, sw = 5.4, sh = 2.6;
  rrect(s, sx, sy, sw, sh, VIOLET, 0.22);
  text(s, "$100B+", {
    x: sx + 0.4, y: sy + 0.25, w: sw - 0.8, h: 1.6,
    fontSize: 96, bold: true, color: WHITE, valign: "top",
  });
  text(s, "in DeFi treasury capital actively deployed across DAOs, funds, and founder treasuries.", {
    x: sx + 0.4, y: sy + 1.7, w: sw - 0.8, h: sh - 1.8,
    fontSize: 12.5, color: VIOLET_100, valign: "top", lineSpacingMultiple: 1.3,
  });

  // Right side facts (stacked)
  const facts = [
    ["DAOS, FUNDS, FOUNDERS", "Multi-protocol treasuries managed daily."],
    ["RISING COMPLEXITY", "More chains, more protocols, more decisions."],
    ["NO CATEGORY LEADER", "The treasury OS seat is wide open."],
  ];
  const fx = 6.4, fy = 4.05, fw = W - 0.7 - fx;
  facts.forEach(([k, v], i) => {
    const yy = fy + i * 0.92;
    rect(s, fx, yy, 0.06, 0.78, VIOLET);
    text(s, k, {
      x: fx + 0.22, y: yy, w: fw - 0.3, h: 0.32,
      fontSize: 11, bold: true, color: VIOLET, charSpacing: 3, valign: "middle",
    });
    text(s, v, {
      x: fx + 0.22, y: yy + 0.32, w: fw - 0.3, h: 0.46,
      fontSize: 13, color: INK, valign: "top",
    });
  });
}

// =====================================================================
// SLIDE 10 — Persona (3 cards + traits strip)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "WHO WE SERVE · 10");
  title(s, "Built for operators with\ncapital in motion.", { w: 11 });
  lede(s, "Three audiences. One painful job: moving treasury safely, daily.", { w: 12 });

  const cards = [
    { n: "01", label: "WEB3 FOUNDERS", title: "Treasuries $1M – $50M.", body: "Moving fast, can't afford a six-figure mis-click." },
    { n: "02", label: "DAO MANAGERS", title: "Multi-sig coordinators.", body: "Executing across protocols and signers in parallel." },
    { n: "03", label: "ASSET MANAGERS", title: "Active deployers.", body: "Daily strategies that demand speed AND safety." },
  ];
  const cw = 4.04, ch = 2.3, gx = 0.7, gy = 4.2, gap = 0.18;
  cards.forEach((c, i) => {
    card(s, { x: gx + i * (cw + gap), y: gy, w: cw, h: ch, ...c });
  });

  // Traits strip
  rrect(s, 0.7, 6.65, W - 1.4, 0.5, VIOLET_50, 0.1);
  text(s, "Common traits   ·   capital in motion   ·   high execution frequency   ·   safety + speed", {
    x: 0.7, y: 6.65, w: W - 1.4, h: 0.5,
    fontSize: 11, color: VIOLET_DEEP, italic: true, align: "center", valign: "middle", charSpacing: 1,
  });
}

// =====================================================================
// SLIDE 11 — GTM (4 cards)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "GO-TO-MARKET · 11");
  title(s, "How we acquire users.", { w: 9 });
  lede(s, "Trust first. Execution next. Built founder-to-founder.", { w: 12 });

  const cards = [
    { n: "01", label: "OUTREACH",  title: "Founder-led conversations.", body: "Direct outreach to Web3 teams who feel the pain." },
    { n: "02", label: "CONTENT",   title: "X (Twitter) presence.",      body: "Treasury pain, sim wins, founder-to-founder voice." },
    { n: "03", label: "DEMOS",     title: "Simulation-led demos.",      body: "Show what they missed — simulate it live." },
    { n: "04", label: "NETWORK",   title: "Crypto referrals.",          body: "Trusted intros inside Solana and DeFi circles." },
  ];
  const cw = 5.95, ch = 1.45, gx = 0.7, gy = 4.2, gap = 0.18;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    card(s, { x: gx + col * (cw + gap), y: gy + row * (ch + gap), w: cw, h: ch, ...c });
  });

  bigPunch(s, "Trust first.   Execution next.");
}

// =====================================================================
// SLIDE 12 — Traction (4 giant numbers)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "TRACTION PLAN · 12");
  title(s, "Pre-raise validation goals.", { w: 11 });
  lede(s, "Real users. Real ops. Before scaling — prove the loop.", { w: 12 });

  const ms = [
    { value: "10",   label: "ACTIVE TREASURY USERS",    body: "Real teams running real ops on Dreyv." },
    { value: "500+", label: "TARGETED X FOLLOWERS",     body: "An audience inside our exact ICP." },
    { value: "1",    label: "PILOT COHORT",             body: "Curated group for product validation." },
    { value: "5",    label: "EARLY DESIGN PARTNERS",    body: "Embedded feedback for the v1 launch." },
  ];
  const cw = 2.95, ch = 2.6, gx = 0.7, gy = 4.2, gap = 0.18;
  ms.forEach((m, i) => {
    statBlock(s, { x: gx + i * (cw + gap), y: gy, w: cw, h: ch, ...m });
  });

  bigPunch(s, "Prove usage. Then scale.");
}

// =====================================================================
// SLIDE 13 — Vision
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "VISION · 13");
  title(s, "The operating system\nfor on-chain capital.");
  lede(s, "Every dollar deployed on-chain runs through a system that thinks before it signs.");

  visualPanel(s, "celebrate", { tone: "dark", caption: "“Autonomous. Auditable. Aligned.”" });

  const items = [
    ["AUTONOMOUS",   "Self-driving treasury management."],
    ["EXTENSIBLE",   "Developer ecosystem for custom strategies."],
    ["CONTINUOUS",   "AI-driven optimization, 24/7."],
  ];
  const py = 4.3, ph = 0.7, pgap = 0.12, pw = 7.4;
  items.forEach(([k, v], i) => {
    const yy = py + i * (ph + pgap);
    rrect(s, LEFT.x, yy, pw, ph, CREAM, 0.12);
    rect(s, LEFT.x, yy, 0.06, ph, VIOLET);
    text(s, k, {
      x: LEFT.x + 0.25, y: yy, w: 2.0, h: ph,
      fontSize: 11, bold: true, color: VIOLET, charSpacing: 4, valign: "middle",
    });
    text(s, v, {
      x: LEFT.x + 2.4, y: yy, w: pw - 2.55, h: ph,
      fontSize: 14, color: INK, valign: "middle",
    });
  });
}

// =====================================================================
// SLIDE 14 — Why Now (4 cards)
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "WHY NOW · 14");
  title(s, "A perfect convergence moment.", { w: 12 });
  lede(s, "Capital, complexity, and AI maturity arrive at the same intersection.", { w: 12 });

  const cards = [
    { n: "01", label: "CAPITAL",    title: "On-chain explosion.",  body: "Treasury volume on-chain at all-time highs." },
    { n: "02", label: "COMPLEXITY", title: "DeFi sprawl.",         body: "More protocols, more chains, more daily decisions." },
    { n: "03", label: "AI",         title: "Agents are viable.",   body: "LLMs + tool-use are now reliable for real money." },
    { n: "04", label: "MARKET",     title: "No category leader.",  body: "Treasury OS is an open seat — land grab moment." },
  ];
  const cw = 2.95, ch = 2.7, gx = 0.7, gy = 4.2, gap = 0.18;
  cards.forEach((c, i) => {
    card(s, { x: gx + i * (cw + gap), y: gy, w: cw, h: ch, ...c });
  });
}

// =====================================================================
// SLIDE 15 — The Ask
// =====================================================================
{
  const { s } = newSlide();
  chrome(s);
  eyebrow(s, "THE ASK · 15");
  title(s, "We're raising incubation\nsupport to:");
  lede(s, "Three concrete priorities for the next twelve weeks.");

  visualPanel(s, "think", { tone: "dark", caption: "“Build the foundation for the category.”" });

  const items = [
    ["01", "Acquire our first 10 high-quality treasury users."],
    ["02", "Build distribution via X and the crypto community."],
    ["03", "Scale our AI + simulation infrastructure."],
  ];
  const py = 4.3, ph = 0.78, pgap = 0.14, pw = 7.4;
  items.forEach(([n, v], i) => {
    const yy = py + i * (ph + pgap);
    rrect(s, LEFT.x, yy, pw, ph, VIOLET, 0.12);
    text(s, n, {
      x: LEFT.x + 0.25, y: yy, w: 0.8, h: ph,
      fontSize: 22, bold: true, color: WHITE, valign: "middle",
    });
    rect(s, LEFT.x + 1.05, yy + 0.12, 0.012, ph - 0.24, VIOLET_200);
    text(s, v, {
      x: LEFT.x + 1.25, y: yy, w: pw - 1.45, h: ph,
      fontSize: 14.5, color: WHITE, valign: "middle",
    });
  });
}

// =====================================================================
// SLIDE 16 — One Line / Closing (DARK)
// =====================================================================
{
  const { s } = newSlide({ dark: true });
  rect(s, 0, 0, W, H, VIOLET_DEEP);
  ellipse(s, -3, -3, 7, 7, VIOLET_DARK);
  ellipse(s, W - 4, H - 4, 7, 7, VIOLET);
  // Star pattern faint
  for (let r = 0; r < 14; r++) {
    for (let c = 0; c < 24; c++) {
      star(s, 0.3 + c * 0.55, 0.3 + r * 0.55, 0.06, "6D28D9");
    }
  }
  // Soft inner panel for legibility (solid)
  rrect(s, 0.9, 1.3, W - 1.8, H - 2.2, VIOLET_DEEP, 0.3, VIOLET_DARK);

  // pageNum already incremented by newSlide() above
  brandMark(s, 0.7, 0.5, WHITE, 0.36);
  text(s, "DREYV", {
    x: 1.15, y: 0.5, w: 3, h: 0.36, fontSize: 14, bold: true, color: WHITE, charSpacing: 6, valign: "middle",
  });
  text(s, `${String(pageNum).padStart(2, "0")} / ${String(TOTAL).padStart(2, "0")}`, {
    x: W - 1.5, y: 0.5, w: 1, h: 0.36, fontSize: 10, color: VIOLET_200, align: "right", valign: "middle",
  });

  text(s, "ONE LINE", {
    x: 1.4, y: 1.85, w: 4, h: 0.36, fontSize: 11, bold: true, color: VIOLET_300, charSpacing: 6,
  });
  text(s, "“We're building the\nfirst system where you\ncan simulate and validate\ntreasury decisions before\nexecuting them on-chain.”", {
    x: 1.4, y: 2.4, w: W - 2.8, h: 4.0,
    fontSize: 38, bold: true, color: WHITE, italic: false, valign: "top", lineSpacingMultiple: 1.05,
  });

  // Mascot (small, bottom-right)
  slide_celebrate_mascot(s);
  // Footer
  rect(s, 0.9, H - 0.9, W - 1.8, 0.012, VIOLET_DARK);
  text(s, "DREYV  ·  DREYV.COM", {
    x: 0.9, y: H - 0.78, w: 5, h: 0.36, fontSize: 11, color: WHITE, charSpacing: 4, valign: "middle",
  });
  text(s, "PITCH · 2026", {
    x: W - 3, y: H - 0.78, w: 2.1, h: 0.36, fontSize: 11, color: VIOLET_200, charSpacing: 4, align: "right", valign: "middle",
  });
}
function slide_celebrate_mascot(s) {
  const mw = 1.6;
  s.addImage({ data: MASCOT.celebrate, x: W - 0.9 - mw, y: H - 0.9 - mw, w: mw, h: mw });
}

pptx.writeFile({ fileName: OUT_PPTX }).then((p) => {
  console.log("Wrote:", p);
});
