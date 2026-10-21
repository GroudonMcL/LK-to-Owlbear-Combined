// Drawing helpers shared by every frame: the band between two insets of the
// token shape, colour that follows the light around it, textures clipped to
// it, and ornaments placed along it.

import { mix, parseHex, shade, toHex } from "./color";
import type { ShapeId } from "./model";
import { samplePerimeter, shapePolygon, type PerimeterSample, type Point } from "./shapes";

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

export const bandWidth = (g: FrameGeometry) => g.inner - g.outer;

export function tracePolygon(ctx: Ctx, points: Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function joinFor(shape: ShapeId): CanvasLineJoin {
  return shape === "square" || shape === "hexagon" || shape === "hexagonFlat" ? "miter" : "round";
}

/** Strokes a line centred at `inset` pixels from the edge, `width` pixels wide. */
export function strokeAt(ctx: Ctx, g: FrameGeometry, inset: number, width: number, style: string | CanvasGradient): void {
  const poly = shapePolygon(g.shape, g.R, inset);
  if (poly.length === 0 || width <= 0) return;
  tracePolygon(ctx, poly);
  ctx.lineWidth = width;
  ctx.lineJoin = joinFor(g.shape);
  ctx.miterLimit = 4;
  ctx.strokeStyle = style;
  ctx.stroke();
}

/** Number of ornaments for an outline, keeping polygon vertices on ornaments. */
export function ornamentCount(shape: ShapeId, approx: number): number {
  const sides = shape === "square" || shape === "rounded" ? 4 : shape === "circle" ? 1 : 6;
  return Math.max(sides, Math.round(approx / sides) * sides);
}

/** Deterministic noise, so the preview and the export get the same texture. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function perimeterLength(points: Point[]): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
}

/** Clips to the frame band (between its outer and inner edges). */
export function clipToBand(ctx: Ctx, g: FrameGeometry): void {
  ctx.beginPath();
  for (const inset of [g.outer, g.inner]) {
    shapePolygon(g.shape, g.R, inset).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.clip("evenodd");
}

/** Points along the band, `at` of the way across it (0 = outer edge, 1 = inner edge). */
export function alongBand(g: FrameGeometry, count: number, at = 0.5): PerimeterSample[] {
  return samplePerimeter(shapePolygon(g.shape, g.R, g.outer + bandWidth(g) * at), count);
}

/** How many things of `size` pixels fit around the band. */
export function countFor(g: FrameGeometry, size: number, at = 0.5): number {
  const poly = shapePolygon(g.shape, g.R, g.outer + bandWidth(g) * at);
  return Math.max(3, Math.round(perimeterLength(poly) / Math.max(1, size)));
}

/**
 * Draws in a frame local to a point on the band: +x runs along the band
 * (clockwise), +y points inwards, towards the token's centre.
 */
export function atPoint(ctx: Ctx, p: PerimeterSample, draw: () => void): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  draw();
  ctx.restore();
}

/** The light (from the top left) as a unit vector in a point's local frame. */
export function localLight(p: PerimeterSample): Point {
  const a = -p.angle;
  const k = -Math.SQRT1_2;
  return { x: k * Math.cos(a) - k * Math.sin(a), y: k * Math.sin(a) + k * Math.cos(a) };
}

/** A small shadow for something raised off the band. */
export function raised(ctx: Ctx, w: number, alpha = 0.55): void {
  ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
  ctx.shadowBlur = w * 0.16;
  ctx.shadowOffsetX = w * 0.05;
  ctx.shadowOffsetY = w * 0.08;
}

export function noShadow(ctx: Ctx): void {
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** A shaded sphere (bead, rivet, eyeball) lit from the top left. */
export function sphere(ctx: Ctx, x: number, y: number, r: number, color: string, light: Point = { x: -0.7, y: -0.7 }): void {
  const gradient = ctx.createRadialGradient(x + light.x * r * 0.45, y + light.y * r * 0.45, r * 0.08, x, y, r);
  gradient.addColorStop(0, shade(color, 0.75));
  gradient.addColorStop(0.5, color);
  gradient.addColorStop(1, shade(color, -0.6));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A 360-entry lookup (one per degree) of colours between angle stops. */
export function angleTable(stops: [number, string][]): string[] {
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

export const degreesAt = (x: number, y: number) => Math.floor((((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360);

/**
 * Fills the band between two insets with colour following the angle around the
 * centre: thin wedges, each one colour (canvas conic gradients don't agree
 * across renderers, and the preview and export must match).
 */
export function angularFill(ctx: Ctx, g: FrameGeometry, outer: number, inner: number, table: string[]): void {
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

export interface Lighting {
  /** How far the lit side (top left) goes towards `highlight`, 0–1. */
  light: number;
  /** How far the shaded side (bottom right) goes towards black, 0–1. */
  dark: number;
  /** The lit side's colour; by default a warm, pale version of the base. */
  highlight?: string;
}

export interface LitTables {
  /** The band, lit from the top left. */
  band: string[];
  /** The pressed-in inner step, lit from the other side. */
  step: string[];
}

/** Band and step colours for any base colour, lit the way Stamped is. */
export function litTables(color: string, lighting: Lighting): LitTables {
  const highlight = lighting.highlight ?? mix(shade(color, 0.6), "#fff3c4", 0.35);
  const stepBase = shade(color, -0.4);
  const band: string[] = [];
  const step: string[] = [];
  for (let d = 0; d < 360; d++) {
    const l = Math.cos(((d - 225) * Math.PI) / 180);
    const s = Math.sign(l) * Math.abs(l) ** 0.75;
    band.push(s >= 0 ? mix(color, highlight, s * lighting.light) : shade(color, s * lighting.dark));
    const s2 = -s * 0.8;
    step.push(s2 >= 0 ? mix(stepBase, color, s2 * 0.7) : shade(stepBase, s2 * 0.5));
  }
  return { band, step };
}

/**
 * Hammered-metal pitting: dark dents with a bright fleck on their lit side.
 * Sizes and counts are in units of the band, so every resolution matches.
 */
export function hammerTexture(ctx: Ctx, g: FrameGeometry, dark: string, light: string, density: number, grain = 1, seed = 0x1f2e3d): void {
  const w = bandWidth(g);
  const mid = shapePolygon(g.shape, g.R, g.outer + w / 2);
  const count = Math.round((perimeterLength(mid) / w) * density);
  const spacing = perimeterLength(mid) / Math.max(1, count);
  const random = seededRandom(seed);
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

/** A path that follows the band at `at` of the way across, wobbling by `wobble(i)` pixels inwards. */
export function wavyLine(ctx: Ctx, g: FrameGeometry, at: number, steps: number, wobble: (i: number, t: number) => number): void {
  ctx.beginPath();
  const points = alongBand(g, steps, at);
  points.forEach((p, i) => {
    const off = wobble(i, i / steps);
    const x = p.x - Math.sin(p.angle) * off;
    const y = p.y + Math.cos(p.angle) * off;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}
