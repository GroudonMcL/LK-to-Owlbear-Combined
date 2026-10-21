// Procedural frames. Each style paints the band between two insets of the
// token shape, so every frame works with every shape at any resolution.

import { mix, rgba, shade } from "./color";
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

const PAINTERS: Record<Exclude<FrameStyle, "none" | "stampedColour" | "stampedGrey">, (ctx: Ctx, g: FrameGeometry) => void> = {
  line: drawLine,
  double: drawDouble,
  gilded: drawGilded,
  engraved: drawEngraved,
  arcane: drawArcane,
  riveted: drawRiveted,
  hammered: drawHammered,
  burnished: drawBurnished,
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
