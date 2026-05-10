/**
 * Dreyv Pitch Deck generator — premium light, Manrope, solid violet (#7c3aed).
 * Outputs: public/pitch/dreyv-pitch-deck.pptx
 */
const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");

const ROOT = path.resolve(__dirname, "..");
const REPO = "/dev-server";
const PUB = path.join(REPO, "public");
const OUT_PPTX = path.join(PUB, "pitch", "dreyv-pitch-deck.pptx");

const VIOLET = "7C3AED";
const VIOLET_DARK = "5B21B6";
const VIOLET_100 = "EDE9FE";
const VIOLET_200 = "DDD6FE";
const VIOLET_50 = "F5F3FF";
const INK = "0F172A";
const SLATE = "475569";
const MUTED = "94A3B8";
const WHITE = "FFFFFF";

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
const HERO = {
  title: b64(path.join(PUB, "pitch/hero-title.jpg")),
  simulation: b64(path.join(PUB, "pitch/hero-simulation.jpg")),
  vision: b64(path.join(PUB, "pitch/hero-vision.jpg")),
};
const MARK = b64(path.join(PUB, "dreyv-mark-violet.png"));

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
pptx.title = "Dreyv — AI Operating System for On-Chain Treasury";
pptx.author = "Dreyv";
pptx.company = "Dreyv (StaUniverse)";

const W = 13.333;
const H = 7.5;
const FONT = "Manrope";
const FONT_FALLBACK = "Calibri"; // pptx fallback
// pptxgenjs uses single fontFace string; Manrope -> falls back gracefully

// ---------- helpers ----------
function addBackground(slide) {
  slide.background = { color: WHITE };
}
function addAmbientGlows(slide) {
  // Soft violet ambient circles (no gradients)
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -2, y: -2, w: 5, h: 5, fill: { color: VIOLET_100 }, line: { color: VIOLET_100 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: W - 3, y: H - 3, w: 5.5, h: 5.5, fill: { color: VIOLET_50 }, line: { color: VIOLET_50 },
  });
}
function addBrandHeader(slide, pageNum, totalPages) {
  // Top-left mark + wordmark
  slide.addImage({ data: MARK, x: 0.5, y: 0.4, w: 0.32, h: 0.32 });
  slide.addText("DREYV", {
    x: 0.9, y: 0.38, w: 1.5, h: 0.36, fontFace: FONT, fontSize: 14, bold: true, color: INK, charSpacing: 4,
  });
  // Top-right page indicator (dot replaced with star glyph rendered as text)
  slide.addText(`${String(pageNum).padStart(2, "0")} / ${String(totalPages).padStart(2, "0")}`, {
    x: W - 1.4, y: 0.4, w: 0.9, h: 0.32, fontFace: FONT, fontSize: 10, color: MUTED, align: "right",
  });
}
function addFooter(slide) {
  slide.addText("dreyv.com  ·  AI Operating System for On-Chain Treasury", {
    x: 0.5, y: H - 0.45, w: W - 1, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED,
  });
}
function addEyebrow(slide, text, x = 0.7, y = 1.1) {
  slide.addText(text, {
    x, y, w: 5, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: VIOLET, charSpacing: 3,
  });
}
function addTitle(slide, text, x = 0.7, y = 1.5, w = 11.5, fontSize = 44) {
  slide.addText(text, {
    x, y, w, h: 1.2, fontFace: FONT, fontSize, bold: true, color: INK, valign: "top",
  });
}
function addSubtitle(slide, text, x = 0.7, y = 2.6, w = 11.5, fontSize = 18) {
  slide.addText(text, {
    x, y, w, h: 0.6, fontFace: FONT, fontSize, color: SLATE, valign: "top",
  });
}
function addBulletCard(slide, opts) {
  const { x, y, w, h, eyebrow, title, body } = opts;
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, fill: { color: WHITE }, line: { color: VIOLET_200, width: 1 }, rectRadius: 0.18,
  });
  if (eyebrow) {
    slide.addText(eyebrow, { x: x + 0.3, y: y + 0.25, w: w - 0.6, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: VIOLET, charSpacing: 3 });
  }
  slide.addText(title, { x: x + 0.3, y: y + 0.55, w: w - 0.6, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: INK });
  slide.addText(body, { x: x + 0.3, y: y + 1.1, w: w - 0.6, h: h - 1.3, fontFace: FONT, fontSize: 13, color: SLATE, valign: "top" });
}
function addStarGlyph(slide, x, y) {
  // 4-point star (Dreyv mark substitute) — solid violet
  slide.addShape(pptx.ShapeType.star4, { x, y, w: 0.18, h: 0.18, fill: { color: VIOLET }, line: { color: VIOLET } });
}
function addBullets(slide, items, opts) {
  const { x, y, w, h, fontSize = 16, gap = 0.5 } = opts;
  let cy = y;
  items.forEach((item) => {
    addStarGlyph(slide, x, cy + 0.08);
    slide.addText(item, {
      x: x + 0.35, y: cy, w: w - 0.4, h: gap, fontFace: FONT, fontSize, color: INK, valign: "top",
    });
    cy += gap;
  });
}
function addPunchline(slide, text, y = H - 1.35) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.7, y, w: W - 1.4, h: 0.7, fill: { color: VIOLET }, line: { color: VIOLET }, rectRadius: 0.12,
  });
  slide.addText(text, {
    x: 0.7, y, w: W - 1.4, h: 0.7, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle",
  });
}

const TOTAL = 16;
let pageNum = 0;
function newSlide({ ambient = true } = {}) {
  pageNum += 1;
  const s = pptx.addSlide();
  addBackground(s);
  if (ambient) addAmbientGlows(s);
  addBrandHeader(s, pageNum, TOTAL);
  addFooter(s);
  return s;
}

// ============================================================
// Slide 1 — Title
// ============================================================
{
  const s = newSlide({ ambient: false });
  // Hero image right side
  s.addImage({ data: HERO.title, x: 6.5, y: 0, w: 6.83, h: 7.5 });
  // Soft violet column overlay at left for text contrast (solid, not gradient)
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 6.7, h: H, fill: { color: WHITE }, line: { color: WHITE } });
  s.addShape(pptx.ShapeType.ellipse, { x: -2.5, y: 4, w: 5, h: 5, fill: { color: VIOLET_100 }, line: { color: VIOLET_100 } });

  s.addImage({ data: MARK, x: 0.7, y: 1.1, w: 0.6, h: 0.6 });
  s.addText("DREYV", {
    x: 1.4, y: 1.15, w: 4, h: 0.55, fontFace: FONT, fontSize: 26, bold: true, color: INK, charSpacing: 6,
  });
  s.addText("AI Operating System\nfor On-Chain Treasury", {
    x: 0.7, y: 2.2, w: 6.2, h: 2.4, fontFace: FONT, fontSize: 48, bold: true, color: INK,
  });
  s.addText("Automate.  Simulate.  Execute — safely.", {
    x: 0.7, y: 4.7, w: 6, h: 0.5, fontFace: FONT, fontSize: 18, color: SLATE,
  });
  // Pitch meta strip
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.7, y: 5.6, w: 5.4, h: 0.7, fill: { color: VIOLET }, line: { color: VIOLET }, rectRadius: 0.12,
  });
  s.addText("Pitch Deck  ·  2026", {
    x: 0.7, y: 5.6, w: 5.4, h: 0.7, fontFace: FONT, fontSize: 14, bold: true, color: WHITE, align: "center", valign: "middle",
  });
}

// ============================================================
// Slide 2 — Problem
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "PROBLEM");
  addTitle(s, "Managing on-chain treasury is broken.");
  s.addImage({ data: MASCOT.alert, x: 10.3, y: 1.0, w: 2.5, h: 2.5 });

  const items = [
    "47 clicks across 5+ tools for a single operation",
    "No way to simulate outcomes before execution",
    "High risk of costly manual errors",
    "Slow decision-making across teams",
    "One mistake = irreversible financial loss",
  ];
  addBullets(s, items, { x: 0.9, y: 3.5, w: 9, h: 3, fontSize: 18, gap: 0.55 });
  addPunchline(s, "Capital is active. Operations are not.");
}

// ============================================================
// Slide 3 — Why This Matters
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "WHY IT MATTERS");
  addTitle(s, "The cost of doing nothing.");
  s.addImage({ data: MASCOT.think, x: 10.3, y: 1.0, w: 2.5, h: 2.5 });

  const cards = [
    { eyebrow: "YIELD", title: "Lost yield", body: "Slow execution across protocols leaves capital sitting idle." },
    { eyebrow: "OPPORTUNITY", title: "Missed windows", body: "DeFi opportunities open and close before teams can act." },
    { eyebrow: "TIME", title: "Coordination drag", body: "Hours wasted moving between dashboards, signers, and chats." },
    { eyebrow: "RISK", title: "Signing stress", body: "Every transaction is a high-stakes guess without simulation." },
  ];
  const cw = 5.6, ch = 1.8, gx = 0.7, gy = 3.5, gap = 0.25;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    addBulletCard(s, {
      x: gx + col * (cw + gap), y: gy + row * (ch + gap), w: cw, h: ch,
      eyebrow: c.eyebrow, title: c.title, body: c.body,
    });
  });
  addPunchline(s, "Capital is active, but systems are not.");
}

// ============================================================
// Slide 4 — Category Gap
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "CATEGORY GAP");
  addTitle(s, "What exists today vs. what's missing.");

  const rows = [
    { cat: "Analytics", names: "Dune, Nansen", gap: "Insights — no execution." },
    { cat: "Execution", names: "Streamflow, Magna", gap: "Execution — no intelligence." },
    { cat: "Custody", names: "Fireblocks, Gnosis Safe", gap: "Security — no orchestration." },
  ];
  const rh = 1.0, ry = 3.3, rx = 0.7, rw = W - 1.4;
  rows.forEach((r, i) => {
    const y = ry + i * (rh + 0.15);
    s.addShape(pptx.ShapeType.roundRect, {
      x: rx, y, w: rw, h: rh, fill: { color: WHITE }, line: { color: VIOLET_200, width: 1 }, rectRadius: 0.14,
    });
    s.addText(r.cat, { x: rx + 0.3, y: y + 0.2, w: 2.4, h: 0.6, fontFace: FONT, fontSize: 18, bold: true, color: INK });
    s.addText(r.names, { x: rx + 0.3, y: y + 0.6, w: 2.4, h: 0.4, fontFace: FONT, fontSize: 11, color: MUTED });
    s.addShape(pptx.ShapeType.rect, { x: rx + 3.0, y: y + 0.25, w: 0.04, h: 0.5, fill: { color: VIOLET_200 }, line: { color: VIOLET_200 } });
    s.addText(r.gap, { x: rx + 3.2, y: y + 0.25, w: rw - 3.5, h: 0.6, fontFace: FONT, fontSize: 16, color: SLATE, valign: "middle" });
  });
  addPunchline(s, "No unified system to plan, simulate, and execute.");
}

// ============================================================
// Slide 5 — Solution
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "SOLUTION");
  addTitle(s, "Dreyv: the AI-powered\ntreasury operating system.", 0.7, 1.5, 8, 40);
  s.addImage({ data: MASCOT.greet, x: 9.8, y: 1.3, w: 3.2, h: 3.2 });

  const items = [
    "Type what you want in plain English",
    "AI agents plan and execute strategies",
    "Every transaction is simulated before execution",
    "Fully non-custodial — your keys, your assets",
  ];
  addBullets(s, items, { x: 0.9, y: 4.4, w: 12, h: 3, fontSize: 18, gap: 0.5 });
  addPunchline(s, "From manual execution to intelligent automation.");
}

// ============================================================
// Slide 6 — How It Works
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "HOW IT WORKS");
  addTitle(s, "Simple, safe, intelligent.");

  const steps = [
    { n: "01", t: "Intent", d: "Plain English input" },
    { n: "02", t: "Plan", d: "AI generates transaction plan" },
    { n: "03", t: "Simulate", d: "Validate outcomes & risks" },
    { n: "04", t: "Review", d: "Team approves in War Room" },
    { n: "05", t: "Execute", d: "Signed on-chain" },
    { n: "06", t: "Monitor", d: "Continuous AI oversight" },
  ];
  const cw = 1.95, ch = 2.1, gy = 3.5, gap = 0.15;
  const totalW = steps.length * cw + (steps.length - 1) * gap;
  const startX = (W - totalW) / 2;
  steps.forEach((st, i) => {
    const x = startX + i * (cw + gap);
    s.addShape(pptx.ShapeType.roundRect, {
      x, y: gy, w: cw, h: ch, fill: { color: WHITE }, line: { color: VIOLET_200, width: 1 }, rectRadius: 0.16,
    });
    s.addText(st.n, { x: x + 0.2, y: gy + 0.2, w: cw - 0.4, h: 0.4, fontFace: FONT, fontSize: 11, bold: true, color: VIOLET, charSpacing: 3 });
    s.addText(st.t, { x: x + 0.2, y: gy + 0.6, w: cw - 0.4, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: INK });
    s.addText(st.d, { x: x + 0.2, y: gy + 1.15, w: cw - 0.4, h: 0.85, fontFace: FONT, fontSize: 11, color: SLATE });
  });
  addPunchline(s, "Simulate  →  Validate  →  Execute.");
}

// ============================================================
// Slide 7 — USP
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "DIFFERENTIATION");
  addTitle(s, "Why Dreyv wins.");
  s.addImage({ data: MASCOT.celebrate, x: 10.3, y: 1.0, w: 2.5, h: 2.5 });

  const cards = [
    { eyebrow: "01", title: "Simulation-first", body: "No blind transactions — every action validated before signing." },
    { eyebrow: "02", title: "Agents, not dashboards", body: "AI does the work; you set the intent." },
    { eyebrow: "03", title: "Plain English → action", body: "Natural language compiled to safe on-chain operations." },
    { eyebrow: "04", title: "Non-custodial", body: "Keys stay with you. Always. Architecture, not policy." },
  ];
  const cw = 5.6, ch = 1.7, gx = 0.7, gy = 3.5, gap = 0.25;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    addBulletCard(s, {
      x: gx + col * (cw + gap), y: gy + row * (ch + gap), w: cw, h: ch,
      eyebrow: c.eyebrow, title: c.title, body: c.body,
    });
  });
  addPunchline(s, "Confidence before execution.");
}

// ============================================================
// Slide 8 — Competition Benchmark
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "COMPETITIVE LANDSCAPE");
  addTitle(s, "We are the missing\nexecution intelligence layer.", 0.7, 1.5, 12, 38);

  const headers = ["Capability", "Dune", "Fireblocks", "Streamflow", "Dreyv"];
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
        bold: true, color: i === 4 ? WHITE : INK, fill: { color: i === 4 ? VIOLET : VIOLET_50 },
        align: i === 0 ? "left" : "center", fontFace: FONT, fontSize: 13,
      },
    })),
    ...rows.map((r) => r.map((cell, i) => ({
      text: cell,
      options: {
        color: i === 4 ? VIOLET : (cell === "✓" ? INK : MUTED),
        bold: i === 4 || (i > 0 && cell === "✓"),
        align: i === 0 ? "left" : "center",
        fontFace: FONT, fontSize: 13,
        fill: { color: i === 4 ? VIOLET_50 : WHITE },
      },
    }))),
  ];
  s.addTable(tableData, {
    x: 0.7, y: 3.4, w: W - 1.4,
    colW: [3.6, 2.0, 2.2, 2.2, 1.93],
    rowH: 0.45,
    border: { type: "solid", pt: 0.5, color: VIOLET_200 },
    fontFace: FONT,
  });
}

// ============================================================
// Slide 9 — Market Opportunity
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "MARKET");
  addTitle(s, "On-chain capital is\ngrowing rapidly.", 0.7, 1.5, 7, 40);
  s.addImage({ data: HERO.vision, x: 7.5, y: 1.6, w: 5.5, h: 3.5 });

  const items = [
    "Billions in DeFi treasury capital actively deployed",
    "DAOs, funds, and founders managing capital on-chain",
    "Increasing complexity across protocols and chains",
    "No dominant treasury operating system exists",
  ];
  addBullets(s, items, { x: 0.9, y: 5.2, w: 12, h: 1.8, fontSize: 15, gap: 0.4 });
}

// ============================================================
// Slide 10 — Persona
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "WHO WE SERVE");
  addTitle(s, "Built for operators with\ncapital in motion.", 0.7, 1.5, 9, 38);
  s.addImage({ data: MASCOT.greet, x: 10.3, y: 1.4, w: 2.7, h: 2.7 });

  const cards = [
    { eyebrow: "PERSONA 01", title: "Web3 founders", body: "Treasuries between $1M and $50M, moving fast." },
    { eyebrow: "PERSONA 02", title: "DAO treasury managers", body: "Multi-sig coordinators executing across protocols." },
    { eyebrow: "PERSONA 03", title: "On-chain asset managers", body: "Active deployers running daily strategies." },
  ];
  const cw = 4.0, ch = 1.9, gx = 0.7, gy = 4.4, gap = 0.3;
  cards.forEach((c, i) => {
    addBulletCard(s, { x: gx + i * (cw + gap), y: gy, w: cw, h: ch, eyebrow: c.eyebrow, title: c.title, body: c.body });
  });
  // Common traits strip
  s.addText("Common traits:  capital in motion  ·  high execution frequency  ·  need for safety + speed", {
    x: 0.7, y: 6.55, w: W - 1.4, h: 0.4, fontFace: FONT, fontSize: 12, color: SLATE, italic: true,
  });
}

// ============================================================
// Slide 11 — GTM
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "GO-TO-MARKET");
  addTitle(s, "How we acquire users.");

  const cards = [
    { eyebrow: "CHANNEL", title: "Founder-led outreach", body: "Direct conversations with Web3 teams who feel the pain." },
    { eyebrow: "CONTENT", title: "X (Twitter) presence", body: "Treasury pain, simulation wins, founder-to-founder voice." },
    { eyebrow: "DEMO", title: "Simulation-led demos", body: "Show what they missed — simulate it live." },
    { eyebrow: "NETWORK", title: "Crypto referrals", body: "Trusted introductions inside Solana and DeFi circles." },
  ];
  const cw = 5.6, ch = 1.7, gx = 0.7, gy = 3.4, gap = 0.25;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    addBulletCard(s, { x: gx + col * (cw + gap), y: gy + row * (ch + gap), w: cw, h: ch, eyebrow: c.eyebrow, title: c.title, body: c.body });
  });
  addPunchline(s, "Trust first.  Execution next.");
}

// ============================================================
// Slide 12 — Traction Plan
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "TRACTION PLAN");
  addTitle(s, "Pre-raise validation goals.");
  s.addImage({ data: MASCOT.think, x: 10.3, y: 1.0, w: 2.5, h: 2.5 });

  const milestones = [
    { n: "10", t: "active treasury users", d: "Real teams running real ops on Dreyv." },
    { n: "500+", t: "targeted X followers", d: "Audience in our exact ICP." },
    { n: "1", t: "pilot cohort", d: "Curated group for product validation." },
    { n: "5", t: "early design partners", d: "Embedded feedback for v1." },
  ];
  const cw = 2.85, ch = 2.4, gx = 0.7, gy = 3.6, gap = 0.2;
  milestones.forEach((m, i) => {
    const x = gx + i * (cw + gap);
    s.addShape(pptx.ShapeType.roundRect, { x, y: gy, w: cw, h: ch, fill: { color: WHITE }, line: { color: VIOLET_200, width: 1 }, rectRadius: 0.16 });
    s.addText(m.n, { x: x + 0.2, y: gy + 0.25, w: cw - 0.4, h: 0.85, fontFace: FONT, fontSize: 44, bold: true, color: VIOLET });
    s.addText(m.t, { x: x + 0.2, y: gy + 1.15, w: cw - 0.4, h: 0.4, fontFace: FONT, fontSize: 12, bold: true, color: INK });
    s.addText(m.d, { x: x + 0.2, y: gy + 1.55, w: cw - 0.4, h: 0.85, fontFace: FONT, fontSize: 11, color: SLATE });
  });
  addPunchline(s, "Prove usage before scaling.");
}

// ============================================================
// Slide 13 — Vision
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "VISION");
  addTitle(s, "The operating system\nfor on-chain capital.", 0.7, 1.5, 7, 40);
  s.addImage({ data: HERO.vision, x: 7.3, y: 1.5, w: 5.7, h: 3.6 });

  const items = [
    "Autonomous treasury management",
    "Developer ecosystem for custom strategies",
    "Continuous AI-driven optimization",
  ];
  addBullets(s, items, { x: 0.9, y: 5.2, w: 12, h: 1.6, fontSize: 16, gap: 0.45 });
  addPunchline(s, "Every dollar on-chain runs through Dreyv.");
}

// ============================================================
// Slide 14 — Why Now
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "WHY NOW");
  addTitle(s, "A perfect convergence moment.");
  s.addImage({ data: MASCOT.celebrate, x: 10.3, y: 1.0, w: 2.5, h: 2.5 });

  const cards = [
    { eyebrow: "CAPITAL", title: "On-chain explosion", body: "Treasury volume on-chain at all-time highs." },
    { eyebrow: "COMPLEXITY", title: "DeFi sprawl", body: "More protocols, more chains, more decisions per day." },
    { eyebrow: "AI", title: "Agents are viable", body: "LLMs + tool-use now reliable enough for real money." },
    { eyebrow: "MARKET", title: "No category leader", body: "Treasury OS is an open seat. Land grab moment." },
  ];
  const cw = 5.6, ch = 1.7, gx = 0.7, gy = 3.5, gap = 0.25;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    addBulletCard(s, { x: gx + col * (cw + gap), y: gy + row * (ch + gap), w: cw, h: ch, eyebrow: c.eyebrow, title: c.title, body: c.body });
  });
}

// ============================================================
// Slide 15 — Ask
// ============================================================
{
  const s = newSlide();
  addEyebrow(s, "THE ASK");
  addTitle(s, "We're raising incubation\nsupport to:", 0.7, 1.5, 9, 40);
  s.addImage({ data: MASCOT.greet, x: 10.3, y: 1.3, w: 2.7, h: 2.7 });

  const items = [
    "Acquire our first 10 high-quality users",
    "Build distribution via X and community",
    "Scale our AI + simulation infrastructure",
  ];
  addBullets(s, items, { x: 0.9, y: 4.4, w: 11, h: 2, fontSize: 18, gap: 0.55 });
  addPunchline(s, "Build the foundation for the treasury OS category.");
}

// ============================================================
// Slide 16 — One Line / Closing
// ============================================================
{
  const s = newSlide({ ambient: false });
  // Full violet hero panel
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: VIOLET }, line: { color: VIOLET } });
  s.addShape(pptx.ShapeType.ellipse, { x: -3, y: -3, w: 7, h: 7, fill: { color: VIOLET_DARK }, line: { color: VIOLET_DARK } });
  s.addShape(pptx.ShapeType.ellipse, { x: W - 4, y: H - 4, w: 7, h: 7, fill: { color: VIOLET_DARK }, line: { color: VIOLET_DARK } });

  s.addImage({ data: MASCOT.celebrate, x: 0.7, y: 5.4, w: 1.6, h: 1.6 });

  s.addText("\u201CWe're building the first system where you can\nsimulate and validate treasury decisions\nbefore executing them on-chain.\u201D", {
    x: 0.7, y: 1.9, w: W - 1.4, h: 3.4, fontFace: FONT, fontSize: 36, bold: true, color: WHITE, valign: "top",
  });
  s.addText("DREYV  ·  dreyv.com", {
    x: 0.7, y: H - 0.9, w: W - 1.4, h: 0.4, fontFace: FONT, fontSize: 14, color: WHITE, align: "right", charSpacing: 4,
  });
}

pptx.writeFile({ fileName: OUT_PPTX }).then((p) => {
  console.log("Wrote:", p);
});
