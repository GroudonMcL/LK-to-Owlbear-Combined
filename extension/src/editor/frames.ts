// Procedural frames. Each style paints the band between two insets of the
// token shape, so every frame works with every shape at any resolution.

import { mix, parseHex, recolour, rgba, shade, toHex, toHsl } from "./color";
import { frameImage, isImageFrame } from "./imageFrames";
import type { FrameStyle, ShapeId } from "./model";
import { samplePerimeter, shapePolygon, type Point } from "./shapes";

export type Ctx = CanvasRenderingContext2D;

export interface FrameGeometry {
  shape: ShapeId;
  /** Token half-size in pixels; the canvas origin is the token centre. */
  R: number;
  /** Band edges in pixels from the token edge. */
  outer: number;
  inner: number;
  color: string;
}

export function tracePolygon(ctx: Ctx, points: Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function joinFor(shape: ShapeId): CanvasLineJoin {
  return shape === "square" || shape === "hexagon" || shape === "hexagonFlat" ? "miter" : "round";
}

/** Strokes a line centred at `inset` pixels from the edge, `width` pixels wide. */
function strokeAt(ctx: Ctx, g: FrameGeometry, inset: number, width: number, style: string | CanvasGradient): void {
  const poly = shapePolygon(g.shape, g.R, inset);
  if (poly.length === 0 || width <= 0) return;
  tracePolygon(ctx, poly);
  ctx.lineWidth = width;
  ctx.lineJoin = joinFor(g.shape);
  ctx.miterLimit = 4;
  ctx.strokeStyle = style;
  ctx.stroke();
}

function metalGradient(ctx: Ctx, R: number, color: string, contrast: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(-R * 0.6, -R, R * 0.6, R);
  gradient.addColorStop(0, shade(color, 0.55 * contrast));
  gradient.addColorStop(0.22, color);
  gradient.addColorStop(0.48, shade(color, -0.38 * contrast));
  gradient.addColorStop(0.7, shade(color, 0.25 * contrast));
  gradient.addColorStop(1, shade(color, -0.45 * contrast));
  return gradient;
}

/** Number of ornaments for an outline, keeping polygon vertices on ornaments. */
function ornamentCount(shape: ShapeId, approx: number): number {
  const sides = shape === "square" || shape === "rounded" ? 4 : shape === "circle" ? 1 : 6;
  return Math.max(sides, Math.round(approx / sides) * sides);
}

function drawLine(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  strokeAt(ctx, g, g.outer + w / 2, w, g.color);
}

function drawDouble(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  strokeAt(ctx, g, g.outer + w * 0.2, w * 0.4, g.color);
  strokeAt(ctx, g, g.outer + w * 0.86, w * 0.2, g.color);
  // Small diamonds bridging the two lines.
  const mid = shapePolygon(g.shape, g.R, g.outer + w * 0.6);
  const size = w * 0.24;
  ctx.fillStyle = g.color;
  for (const p of samplePerimeter(mid, ornamentCount(g.shape, 8))) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(0, -size * 0.7);
    ctx.lineTo(size, 0);
    ctx.lineTo(0, size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawGilded(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  // Soft shadow cast onto the art.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = w * 0.6;
  strokeAt(ctx, g, g.outer + w / 2, w, metalGradient(ctx, g.R, g.color, 1));
  ctx.restore();
  // Bevel: bright outer lip, dark inner lip, a fine bright inner bead.
  strokeAt(ctx, g, g.outer + w * 0.06, w * 0.12, rgba(shade(g.color, 0.75), 0.9));
  strokeAt(ctx, g, g.inner - w * 0.08, w * 0.16, rgba(shade(g.color, -0.6), 0.85));
  strokeAt(ctx, g, g.outer + w * 0.5, w * 0.06, rgba(shade(g.color, 0.6), 0.55));
}

function drawEngraved(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = w * 0.5;
  strokeAt(ctx, g, g.outer + w / 2, w, metalGradient(ctx, g.R, shade(g.color, -0.15), 0.7));
  ctx.restore();
  // Engraved channel: a dark groove with a highlight beneath it.
  strokeAt(ctx, g, g.outer + w * 0.5, w * 0.16, rgba(shade(g.color, -0.75), 0.9));
  strokeAt(ctx, g, g.outer + w * 0.6, w * 0.05, rgba(shade(g.color, 0.5), 0.5));
  strokeAt(ctx, g, g.outer + w * 0.04, w * 0.08, rgba(shade(g.color, 0.55), 0.7));
  strokeAt(ctx, g, g.inner - w * 0.05, w * 0.1, rgba(shade(g.color, -0.7), 0.9));
  // Notches across the band.
  const mid = shapePolygon(g.shape, g.R, g.outer + w / 2);
  ctx.strokeStyle = rgba(shade(g.color, -0.7), 0.85);
  ctx.lineWidth = Math.max(1, w * 0.07);
  ctx.lineCap = "round";
  for (const p of samplePerimeter(mid, ornamentCount(g.shape, 36))) {
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    ctx.beginPath();
    ctx.moveTo(p.x - nx * w * 0.32, p.y - ny * w * 0.32);
    ctx.lineTo(p.x - nx * w * 0.12, p.y - ny * w * 0.12);
    ctx.stroke();
  }
}

function drawArcane(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  const glow = shade(g.color, 0.35);
  ctx.save();
  ctx.shadowColor = rgba(g.color, 0.95);
  ctx.shadowBlur = w * 1.6;
  strokeAt(ctx, g, g.outer + w * 0.5, w * 0.5, rgba(g.color, 0.9));
  ctx.restore();
  strokeAt(ctx, g, g.outer + w * 0.5, w * 0.22, glow);
  strokeAt(ctx, g, g.outer + w * 0.08, w * 0.1, rgba(glow, 0.7));
  strokeAt(ctx, g, g.inner - w * 0.06, w * 0.1, rgba(glow, 0.7));
  // Runes: small four-pointed stars riding the band.
  const mid = shapePolygon(g.shape, g.R, g.outer + w * 0.5);
  ctx.fillStyle = shade(g.color, 0.85);
  ctx.save();
  ctx.shadowColor = rgba(g.color, 1);
  ctx.shadowBlur = w * 0.9;
  for (const p of samplePerimeter(mid, ornamentCount(g.shape, 12))) {
    const s = w * 0.62;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - s);
    ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y);
    ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
    ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y);
    ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s);
    ctx.fill();
  }
  ctx.restore();
}

function drawRiveted(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = w * 0.5;
  strokeAt(ctx, g, g.outer + w / 2, w, metalGradient(ctx, g.R, g.color, 0.75));
  ctx.restore();
  strokeAt(ctx, g, g.outer + w * 0.05, w * 0.1, rgba(shade(g.color, 0.5), 0.6));
  strokeAt(ctx, g, g.inner - w * 0.05, w * 0.1, rgba(shade(g.color, -0.65), 0.9));
  const mid = shapePolygon(g.shape, g.R, g.outer + w / 2);
  const r = w * 0.17;
  for (const p of samplePerimeter(mid, ornamentCount(g.shape, 16))) {
    const gradient = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
    gradient.addColorStop(0, shade(g.color, 0.75));
    gradient.addColorStop(0.55, shade(g.color, -0.1));
    gradient.addColorStop(1, shade(g.color, -0.6));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Deterministic noise, so the preview and the export get the same texture. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perimeterLength(points: Point[]): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
}

/** Clips to the frame band (between its outer and inner edges). */
function clipToBand(ctx: Ctx, g: FrameGeometry): void {
  ctx.beginPath();
  for (const inset of [g.outer, g.inner]) {
    shapePolygon(g.shape, g.R, inset).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.clip("evenodd");
}

/**
 * Hammered-metal pitting: dark dents with a bright fleck on their lit side.
 * Sizes and counts are in units of the band, so every resolution matches.
 */
function hammerTexture(ctx: Ctx, g: FrameGeometry, dark: string, light: string, density: number, grain = 1): void {
  const w = g.inner - g.outer;
  const mid = shapePolygon(g.shape, g.R, g.outer + w / 2);
  const count = Math.round((perimeterLength(mid) / w) * density);
  const spacing = perimeterLength(mid) / Math.max(1, count);
  const random = seededRandom(0x1f2e3d);
  ctx.save();
  clipToBand(ctx, g);
  for (const p of samplePerimeter(mid, count)) {
    const along = (random() - 0.5) * spacing;
    const across = (random() - 0.5) * w * 1.05;
    const x = p.x + Math.cos(p.angle) * along - Math.sin(p.angle) * across;
    const y = p.y + Math.sin(p.angle) * along + Math.cos(p.angle) * across;
    const r = w * (0.035 + random() * 0.08) * grain;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(x + r * 0.3, y + r * 0.3, r, r * (0.6 + random() * 0.4), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    if (random() < 0.7) {
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(x - r * 0.45, y - r * 0.45, r * (0.25 + random() * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A shadow falling down and to the right of whatever is drawn next. */
function dropShadow(ctx: Ctx, w: number, alpha: number): void {
  ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
  ctx.shadowBlur = w * 0.7;
  ctx.shadowOffsetX = w * 0.12;
  ctx.shadowOffsetY = w * 0.3;
}

/** Forged steel: a broad, pitted band of grey metal with dark rims, casting a drop shadow. */
function drawHammered(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  ctx.save();
  dropShadow(ctx, w, 0.65);
  strokeAt(ctx, g, g.outer + w / 2, w, metalGradient(ctx, g.R, g.color, 0.6));
  ctx.restore();
  // Broad mottling first, then fine pitting with bright flecks.
  hammerTexture(ctx, g, rgba(shade(g.color, -0.55), 0.22), rgba(shade(g.color, 0.4), 0.18), 3, 2.2);
  hammerTexture(ctx, g, rgba(shade(g.color, -0.7), 0.4), rgba(shade(g.color, 0.9), 0.7), 9);
  strokeAt(ctx, g, g.outer + w * 0.1, w * 0.05, rgba(shade(g.color, 0.55), 0.45));
  strokeAt(ctx, g, g.outer + w * 0.03, w * 0.06, rgba(shade(g.color, -0.8), 0.95));
  strokeAt(ctx, g, g.inner - w * 0.035, w * 0.07, rgba(shade(g.color, -0.8), 0.95));
}

/**
 * Ember gold: a polished band that runs from pale gold (top left) through
 * orange to dark copper, with a recessed inner step and a drop shadow.
 */
function drawBurnished(ctx: Ctx, g: FrameGeometry): void {
  const w = g.inner - g.outer;
  const warm = ctx.createLinearGradient(-g.R * 0.7, -g.R * 0.7, g.R * 0.7, g.R * 0.7);
  warm.addColorStop(0, mix(g.color, "#fff4a8", 0.78));
  warm.addColorStop(0.3, mix(g.color, "#ffcf4d", 0.4));
  warm.addColorStop(0.55, g.color);
  warm.addColorStop(0.8, shade(mix(g.color, "#8a1c0c", 0.35), -0.3));
  warm.addColorStop(1, shade(mix(g.color, "#8a1c0c", 0.45), -0.55));
  ctx.save();
  dropShadow(ctx, w, 0.6);
  strokeAt(ctx, g, g.outer + w / 2, w, warm);
  ctx.restore();
  // The recessed inner step, set apart by a groove and a lit edge.
  const step = w * 0.36;
  strokeAt(ctx, g, g.inner - step / 2, step, "rgba(40, 8, 0, 0.3)");
  strokeAt(ctx, g, g.inner - step, w * 0.05, rgba(shade(g.color, -0.75), 0.7));
  strokeAt(ctx, g, g.inner - step - w * 0.04, w * 0.03, rgba(mix(g.color, "#fff4c8", 0.8), 0.45));
  hammerTexture(ctx, g, rgba(shade(g.color, -0.6), 0.2), rgba(mix(g.color, "#fff4c8", 0.85), 0.35), 5);
  // Gloss along the outer lip, strongest at the top left.
  const gloss = ctx.createLinearGradient(-g.R * 0.7, -g.R * 0.7, g.R * 0.7, g.R * 0.7);
  gloss.addColorStop(0, "rgba(255, 250, 225, 0.85)");
  gloss.addColorStop(0.55, "rgba(255, 250, 225, 0)");
  strokeAt(ctx, g, g.outer + w * 0.09, w * 0.07, gloss);
  strokeAt(ctx, g, g.outer + w * 0.02, w * 0.04, rgba(shade(g.color, -0.8), 0.75));
  strokeAt(ctx, g, g.inner - w * 0.02, w * 0.04, rgba(shade(g.color, -0.85), 0.85));
}

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

/** A 360-entry lookup (one per degree) of colours between angle stops. */
function angleTable(stops: [number, string][]): string[] {
  const all = [...stops, [stops[0][0] + 360, stops[0][1]] as [number, string]];
  const table: string[] = [];
  for (let d = 0; d < 360; d++) {
    const i = all.findIndex((s, k) => k < all.length - 1 && d >= s[0] && d <= all[k + 1][0]);
    const [a0, c0] = all[i];
    const [a1, c1] = all[i + 1];
    const t = (d - a0) / (a1 - a0);
    const x = parseHex(c0);
    const y = parseHex(c1);
    table.push(toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t }));
  }
  return table;
}

const degreesAt = (x: number, y: number) => Math.floor((((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360);

/**
 * Fills the band between two insets with colour following the angle around the
 * centre: thin wedges, each one colour (canvas conic gradients don't agree
 * across renderers, and the preview and export must match).
 */
function angularFill(ctx: Ctx, g: FrameGeometry, outer: number, inner: number, table: string[]): void {
  ctx.save();
  clipToBand(ctx, { ...g, outer, inner });
  const far = g.R * 2;
  const n = 240;
  for (let i = 0; i < n; i++) {
    // A hair of overlap so no seam shows between wedges.
    const t0 = (i / n) * Math.PI * 2 - 0.004;
    const t1 = ((i + 1) / n) * Math.PI * 2 + 0.004;
    ctx.fillStyle = table[Math.floor(((i + 0.5) / n) * 360)];
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(t0) * far, Math.sin(t0) * far);
    ctx.lineTo(Math.cos(t1) * far, Math.sin(t1) * far);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

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
  // Drop shadow: the band's silhouette, down and to the right.
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
  angularFill(ctx, g, g.outer, g.inner, tables.outer);
  angularFill(ctx, g, g.inner - step, g.inner, tables.step);
  stampedTexture(ctx, g, tables.outer, recol);
  // The step's crease, a cool pale rim on the lit side, a dark inner rim.
  strokeAt(ctx, g, g.inner - step, w * 0.03, "rgba(25, 5, 0, 0.55)");
  const rim = ctx.createLinearGradient(-g.R * 0.7, -g.R * 0.7, g.R * 0.7, g.R * 0.7);
  rim.addColorStop(0, "rgba(235, 245, 255, 0.9)");
  rim.addColorStop(0.45, "rgba(255, 240, 220, 0.15)");
  rim.addColorStop(1, "rgba(0, 0, 0, 0)");
  strokeAt(ctx, g, g.outer + w * 0.02, w * 0.04, rim);
  strokeAt(ctx, g, g.inner - w * 0.012, w * 0.024, "rgba(10, 2, 0, 0.6)");
}

const PAINTERS: Record<Exclude<FrameStyle, "none" | "stampedColour" | "stampedGrey">, (ctx: Ctx, g: FrameGeometry) => void> = {
  line: drawLine,
  double: drawDouble,
  gilded: drawGilded,
  engraved: drawEngraved,
  arcane: drawArcane,
  riveted: drawRiveted,
  hammered: drawHammered,
  burnished: drawBurnished,
  stamped: drawStamped,
};

export function drawFrame(ctx: Ctx, style: FrameStyle, g: FrameGeometry): void {
  if (style === "none" || g.inner <= g.outer) return;
  ctx.save();
  if (isImageFrame(style)) {
    // The artwork, scaled to the frame's outer edge. Not loaded yet: nothing.
    const image = frameImage(style);
    const r = g.R - g.outer;
    if (image) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, -r, -r, 2 * r, 2 * r);
    }
  } else PAINTERS[style](ctx, g);
  ctx.restore();
}
