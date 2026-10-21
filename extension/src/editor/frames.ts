// Frames. Each paints the band between two insets of the token shape, so
// every frame works with every shape at any resolution. Stamped is the
// model: the others (finishes.ts) share its build and add their own surface.

import { recolour, rgba, toHsl } from "./color";
import { FINISHES, type Finish } from "./finishes";
import {
  angleTable,
  angularFill,
  bandWidth,
  clipToBand,
  degreesAt,
  litTables,
  perimeterLength,
  seededRandom,
  strokeAt,
  tracePolygon,
  type Ctx,
  type FrameGeometry,
  type LitTables,
} from "./frameKit";
import type { FrameStyle } from "./model";
import { samplePerimeter, shapePolygon } from "./shapes";

export { tracePolygon, type Ctx, type FrameGeometry } from "./frameKit";

/**
 * Stamped: the look of the Stamped Colour artwork, drawn so it takes any
 * thickness, shape and colour. Colours run around the ring as sampled from the
 * artwork (pale yellow at the top left, through orange, to near black at the
 * bottom right); an inner step is lit from the other side, so it looks pressed
 * in; fine veins and marbling cover the darker side; a drop shadow falls down
 * and to the right, and an inner shadow darkens the art at the ring's edge.
 */
const STAMPED_BASE = "#d7671f";
/** Angle (degrees, 0 = right, 90 = down) → colour, for the outer band and the inner step. */
const STAMPED_OUTER: [number, string][] = [
  [0, "#2f0f03"], [15, "#260d05"], [30, "#1b0602"], [45, "#170300"], [60, "#190502"], [75, "#1e0902"],
  [90, "#250902"], [105, "#230701"], [120, "#400f02"], [135, "#7a1f03"], [150, "#da4103"], [165, "#ff6c08"],
  [180, "#feaa29"], [195, "#feee5f"], [210, "#ffff89"], [225, "#ffff97"], [240, "#ffff9e"], [255, "#ffff99"],
  [270, "#fffc83"], [285, "#ffce54"], [300, "#fe701f"], [315, "#ac3a07"], [330, "#6c2304"], [345, "#300c01"],
];
const STAMPED_STEP: [number, string][] = [
  [0, "#b42d03"], [15, "#a02a09"], [30, "#862108"], [45, "#5e1104"], [60, "#4b0b03"], [75, "#5d1204"],
  [90, "#811d04"], [105, "#661303"], [120, "#5d1201"], [135, "#671b02"], [150, "#611e02"], [165, "#672605"],
  [180, "#6c2f0b"], [195, "#6e401f"], [210, "#6f4b2a"], [225, "#6a4e2c"], [240, "#6e5135"], [255, "#6d4d32"],
  [270, "#775032"], [285, "#794421"], [300, "#a0470e"], [315, "#b73d06"], [330, "#c53502"], [345, "#b72f03"],
];
/** Texture colours, also recoloured, so a new colour leaves no trace of the orange. */
const STAMPED_MARBLE_LIGHT = "#ff500a";
const STAMPED_VEIN_LIGHT = "#ff7832";
const STAMPED_FLECK_LIGHT = "#ff8c46";

/** Veins, flecks and marbling, on the darker parts of the band only: the lit side stays smooth. */
function stampedTexture(ctx: Ctx, g: FrameGeometry, table: string[], recol: (hex: string) => string): void {
  const w = g.inner - g.outer;
  const mid = shapePolygon(g.shape, g.R, g.outer + w / 2);
  const length = perimeterLength(mid);
  const perBand = length / w;
  const random = seededRandom(0x5eed);
  // 0 where the band is lit (lightness 0.55 and up), rising to 1 in its darkest parts.
  const darkness = table.map((c) => Math.max(0, Math.min(1, (0.55 - toHsl(c).l) / 0.4)));
  const dark = (x: number, y: number) => darkness[degreesAt(x, y)];
  const scatter = (p: { x: number; y: number; angle: number }) => {
    const along = (random() - 0.5) * (length / 40);
    const across = (random() - 0.5) * w * 1.05;
    return { x: p.x + Math.cos(p.angle) * along - Math.sin(p.angle) * across, y: p.y + Math.sin(p.angle) * along + Math.cos(p.angle) * across };
  };
  const marble = rgba(recol(STAMPED_MARBLE_LIGHT), 0.09);
  const veinLight = rgba(recol(STAMPED_VEIN_LIGHT), 0.22);
  const fleckLight = rgba(recol(STAMPED_FLECK_LIGHT), 0.25);
  ctx.save();
  clipToBand(ctx, g);
  // Marbling: long soft patches lying along the band.
  for (const p of samplePerimeter(mid, Math.round(perBand * 14))) {
    const q = scatter(p);
    if (random() > dark(q.x, q.y) ** 2) continue;
    const r = w * (0.3 + random() * 0.5);
    ctx.fillStyle = random() < 0.5 ? marble : "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.ellipse(q.x, q.y, r, r * (0.25 + random() * 0.2), p.angle + (random() - 0.5) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fine flecks.
  for (const p of samplePerimeter(mid, Math.round(perBand * 60))) {
    const q = scatter(p);
    if (random() > dark(q.x, q.y)) continue;
    const r = Math.max(0.4, w * (0.006 + random() * 0.012));
    ctx.fillStyle = random() < 0.6 ? "rgba(0, 0, 0, 0.35)" : fleckLight;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Veins: short wandering cracks with a lit edge.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const p of samplePerimeter(mid, Math.round(perBand * 18))) {
    const q = scatter(p);
    if (random() > dark(q.x, q.y) ** 1.5) continue;
    let a = random() * Math.PI * 2;
    const points = [q];
    for (let i = 0, n = 4 + Math.floor(random() * 6); i < n; i++) {
      a += (random() - 0.5) * 1.4;
      const last = points[points.length - 1];
      const step = w * (0.04 + random() * 0.07);
      points.push({ x: last.x + Math.cos(a) * step, y: last.y + Math.sin(a) * step });
    }
    for (const [offset, colour, width] of [
      [w * 0.014, veinLight, 0.014],
      [0, "rgba(0, 0, 0, 0.5)", 0.016],
    ] as const) {
      ctx.beginPath();
      points.forEach((pt, i) => (i ? ctx.lineTo(pt.x - offset, pt.y - offset) : ctx.moveTo(pt.x - offset, pt.y - offset)));
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(0.6, w * width);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const stampedTables = new Map<string, { outer: string[]; step: string[] }>();

function drawStamped(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  const recol = (hex: string) => recolour(hex, STAMPED_BASE, g.color);
  let tables = stampedTables.get(g.color);
  if (!tables) {
    tables = {
      outer: angleTable(STAMPED_OUTER.map(([a, c]) => [a, recol(c)])),
      step: angleTable(STAMPED_STEP.map(([a, c]) => [a, recol(c)])),
    };
    if (stampedTables.size > 32) stampedTables.clear();
    stampedTables.set(g.color, tables);
  }
  const step = w * 0.45;
  castShadows(ctx, g);
  angularFill(ctx, g, g.outer, g.inner, tables.outer);
  angularFill(ctx, g, g.inner - step, g.inner, tables.step);
  stampedTexture(ctx, g, tables.outer, recol);
  // The step's crease, then the rims.
  strokeAt(ctx, g, g.inner - step, w * 0.03, "rgba(25, 5, 0, 0.55)");
  rims(ctx, g);
}

/** The shadows every frame casts: one below and to the right, one onto the art. */
function castShadows(ctx: Ctx, g: FrameGeometry): void {
  const w = bandWidth(g);
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = w * 0.7;
  ctx.shadowOffsetX = w * 0.14;
  ctx.shadowOffsetY = w * 0.22;
  strokeAt(ctx, g, g.outer + w / 2, w, "#000");
  ctx.restore();
  // Inner shadow: the art darkens towards the ring, most at the top left.
  ctx.save();
  tracePolygon(ctx, shapePolygon(g.shape, g.R, g.inner));
  ctx.clip();
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.shadowBlur = w * 0.85;
  ctx.shadowOffsetX = w * 0.1;
  ctx.shadowOffsetY = w * 0.14;
  strokeAt(ctx, g, g.inner - w * 0.5, w, "#000");
  ctx.restore();
}

/** The lit outer rim and the dark inner rim every frame finishes with. */
function rims(ctx: Ctx, g: FrameGeometry): void {
  const w = bandWidth(g);
  const rim = ctx.createLinearGradient(-g.R * 0.7, -g.R * 0.7, g.R * 0.7, g.R * 0.7);
  rim.addColorStop(0, "rgba(235, 245, 255, 0.9)");
  rim.addColorStop(0.45, "rgba(255, 240, 220, 0.15)");
  rim.addColorStop(1, "rgba(0, 0, 0, 0)");
  strokeAt(ctx, g, g.outer + w * 0.02, w * 0.04, rim);
  strokeAt(ctx, g, g.inner - w * 0.012, w * 0.024, "rgba(10, 2, 0, 0.6)");
}

const finishTables = new Map<string, LitTables>();

/** A finish painted on Stamped's build. */
function drawFinish(ctx: Ctx, g: FrameGeometry, finish: Finish): void {
  const w = bandWidth(g);
  const base = finish.base ? finish.base(g.color) : g.color;
  const lighting = { light: 0.85, dark: 0.8, ...finish.lighting };
  const key = `${base}|${lighting.light}|${lighting.dark}|${lighting.highlight ?? ""}`;
  let tables = finishTables.get(key);
  if (!tables) {
    tables = litTables(base, lighting);
    if (finishTables.size > 64) finishTables.clear();
    finishTables.set(key, tables);
  }
  const step = w * (finish.step ?? 0.45);
  castShadows(ctx, g);
  angularFill(ctx, g, g.outer, g.inner, tables.band);
  if (step > 0) angularFill(ctx, g, g.inner - step, g.inner, tables.step);
  if (finish.texture) {
    ctx.save();
    clipToBand(ctx, g);
    finish.texture(ctx, g, tables, base);
    ctx.restore();
  }
  if (step > 0) strokeAt(ctx, g, g.inner - step, w * 0.03, "rgba(25, 5, 0, 0.55)");
  rims(ctx, g);
  if (finish.ornament) {
    ctx.save();
    finish.ornament(ctx, g, base);
    ctx.restore();
  }
}

export function drawFrame(ctx: Ctx, style: FrameStyle, g: FrameGeometry): void {
  if (style === "none" || g.inner <= g.outer) return;
  ctx.save();
  if (style === "stamped") drawStamped(ctx, g);
  else drawFinish(ctx, g, FINISHES[style]);
  ctx.restore();
}
