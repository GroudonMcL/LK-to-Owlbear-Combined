// Frame finishes in the manner of Stamped: every one shares its build (a
// band lit from the top left, a pressed-in inner step, a drop shadow and an
// inner shadow on the art) and adds its own surface and ornaments. Colours
// come from the border colour, so each finish takes any colour.

import { mix, rgba, shade, toHsl } from "./color";
import {
  alongBand,
  atPoint,
  bandWidth,
  countFor,
  degreesAt,
  hammerTexture,
  localLight,
  noShadow,
  ornamentCount,
  perimeterLength,
  raised,
  seededRandom,
  sphere,
  strokeAt,
  wavyLine,
  type Ctx,
  type FrameGeometry,
  type Lighting,
  type LitTables,
} from "./frameKit";
import { shapePolygon } from "./shapes";

export interface Finish {
  /** The band's colour, made from the border colour (default: the border colour). */
  base?: (color: string) => string;
  lighting?: Partial<Lighting>;
  /** Width of the pressed-in inner step, as a fraction of the band; 0 for none. */
  step?: number;
  /** Painted over the band's colour, clipped to the band. */
  texture?: (ctx: Ctx, g: FrameGeometry, tables: LitTables, base: string) => void;
  /** Painted last, over the rims; may reach past the band. */
  ornament?: (ctx: Ctx, g: FrameGeometry, base: string) => void;
}

/** How dark the band is at a point, 0 (lit) to 1 (darkest), from its table. */
function darknessAt(tables: LitTables): (x: number, y: number) => number {
  const values = tables.band.map((c) => Math.max(0, Math.min(1, (0.55 - toHsl(c).l) / 0.4)));
  return (x, y) => values[degreesAt(x, y)];
}

/** Soft marbling and flecks, like Stamped's, on the darker side. */
function marble(ctx: Ctx, g: FrameGeometry, tables: LitTables, base: string, seed = 0x5eed, amount = 1): void {
  const w = bandWidth(g);
  const random = seededRandom(seed);
  const dark = darknessAt(tables);
  const n = countFor(g, w / (14 * amount));
  for (const p of alongBand(g, n)) {
    const across = (random() - 0.5) * w;
    const x = p.x - Math.sin(p.angle) * across;
    const y = p.y + Math.cos(p.angle) * across;
    if (random() > 0.25 + dark(x, y) * 0.75) continue;
    const r = w * (0.25 + random() * 0.45);
    ctx.fillStyle = random() < 0.5 ? rgba(shade(base, 0.35), 0.08) : "rgba(0, 0, 0, 0.1)";
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.25 + random() * 0.2), p.angle + (random() - 0.5) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of alongBand(g, countFor(g, w / (50 * amount)))) {
    const across = (random() - 0.5) * w;
    const x = p.x - Math.sin(p.angle) * across;
    const y = p.y + Math.cos(p.angle) * across;
    if (random() > dark(x, y)) continue;
    ctx.fillStyle = random() < 0.6 ? "rgba(0, 0, 0, 0.3)" : rgba(shade(base, 0.5), 0.25);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.4, w * (0.006 + random() * 0.012)), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A groove cut into the band: dark line with a lit edge below it. */
function groove(ctx: Ctx, g: FrameGeometry, at: number, base: string, width = 0.06): void {
  const w = bandWidth(g);
  strokeAt(ctx, g, g.outer + w * at, w * width, rgba(shade(base, -0.8), 0.85));
  strokeAt(ctx, g, g.outer + w * (at + width * 0.8), w * width * 0.4, rgba(shade(base, 0.6), 0.45));
}

/** Battle wear: dents (lit on their far side) and scratches with a bright edge. */
function battleWear(ctx: Ctx, g: FrameGeometry, base: string, seed: number): void {
  const w = bandWidth(g);
  const random = seededRandom(seed);
  for (const p of alongBand(g, countFor(g, w * 0.8))) {
    if (random() < 0.35) continue;
    const across = (random() - 0.5) * w * 0.8;
    const x = p.x - Math.sin(p.angle) * across;
    const y = p.y + Math.cos(p.angle) * across;
    const r = w * (0.08 + random() * 0.14);
    const dent = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    dent.addColorStop(0, "rgba(0, 0, 0, 0.5)");
    dent.addColorStop(0.7, "rgba(0, 0, 0, 0.2)");
    dent.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = dent;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + random() * 0.4), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    // The lip of the dent catches the light on the side away from it.
    ctx.strokeStyle = rgba(shade(base, 0.7), 0.45);
    ctx.lineWidth = Math.max(0.5, w * 0.025);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.85, 0, Math.PI * 0.6);
    ctx.stroke();
  }
  ctx.lineCap = "round";
  for (const p of alongBand(g, countFor(g, w * 0.35))) {
    if (random() < 0.3) continue;
    const across = (random() - 0.5) * w;
    const x = p.x - Math.sin(p.angle) * across;
    const y = p.y + Math.cos(p.angle) * across;
    const a = p.angle + (random() - 0.5) * 2.2;
    const len = w * (0.15 + random() * 0.45);
    const bend = (random() - 0.5) * w * 0.12;
    const dx = Math.cos(a) * len;
    const dy = Math.sin(a) * len;
    for (const [offset, colour, width] of [
      [w * 0.012, rgba(shade(base, 0.8), 0.55), 0.016],
      [0, "rgba(0, 0, 0, 0.55)", 0.014],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(0.5, w * width);
      ctx.beginPath();
      ctx.moveTo(x - dx / 2 + offset, y - dy / 2 + offset);
      ctx.quadraticCurveTo(x - Math.sin(a) * bend + offset, y + Math.cos(a) * bend + offset, x + dx / 2 + offset, y + dy / 2 + offset);
      ctx.stroke();
    }
  }
}

// Classic ------------------------------------------------------------------

const polished: Finish = {
  lighting: { light: 0.9, dark: 0.75 },
  step: 0.35,
};

const double: Finish = {
  step: 0,
  texture: (ctx, g, _t, base) => {
    groove(ctx, g, 0.22, base, 0.08);
    groove(ctx, g, 0.78, base, 0.08);
  },
  ornament: (ctx, g, base) => {
    const w = bandWidth(g);
    const s = w * 0.2;
    for (const p of alongBand(g, ornamentCount(g.shape, 12))) {
      atPoint(ctx, p, () => {
        raised(ctx, w);
        const gradient = ctx.createLinearGradient(-s, -s, s, s);
        gradient.addColorStop(0, shade(base, 0.6));
        gradient.addColorStop(1, shade(base, -0.5));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(-s * 1.3, 0);
        ctx.lineTo(0, -s);
        ctx.lineTo(s * 1.3, 0);
        ctx.lineTo(0, s);
        ctx.closePath();
        ctx.fill();
      });
    }
  },
};

const gilded: Finish = {
  lighting: { light: 0.95, dark: 0.8, highlight: "#fff6c8" },
  step: 0.4,
  texture: (ctx, g, tables, base) => marble(ctx, g, tables, base, 0x9e1d, 0.6),
  ornament: (ctx, g, base) => {
    // A row of beads where the step meets the band.
    const w = bandWidth(g);
    const r = w * 0.07;
    for (const p of alongBand(g, countFor(g, r * 2.6, 0.6), 0.6)) {
      raised(ctx, w, 0.4);
      sphere(ctx, p.x, p.y, r, shade(base, 0.15));
    }
    noShadow(ctx);
  },
};

const engraved: Finish = {
  lighting: { light: 0.7, dark: 0.75 },
  step: 0.4,
  texture: (ctx, g, tables, base) => {
    marble(ctx, g, tables, base, 0xe17a, 0.7);
    groove(ctx, g, 0.3, base, 0.1);
    const w = bandWidth(g);
    ctx.strokeStyle = rgba(shade(base, -0.75), 0.8);
    ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.lineCap = "round";
    for (const p of alongBand(g, ornamentCount(g.shape, 40), 0.3)) {
      atPoint(ctx, p, () => {
        ctx.beginPath();
        ctx.moveTo(0, -w * 0.2);
        ctx.lineTo(0, -w * 0.02);
        ctx.stroke();
      });
    }
  },
};

const riveted: Finish = {
  lighting: { light: 0.75, dark: 0.8 },
  step: 0.35,
  texture: (ctx, g, _t, base) => {
    hammerTexture(ctx, g, rgba(shade(base, -0.6), 0.25), rgba(shade(base, 0.6), 0.25), 4);
    battleWear(ctx, g, base, 0xf16);
  },
  ornament: (ctx, g, base) => {
    const w = bandWidth(g);
    const r = w * 0.16;
    for (const p of alongBand(g, ornamentCount(g.shape, 12), 0.33)) {
      raised(ctx, w);
      sphere(ctx, p.x, p.y, r, shade(base, 0.05));
    }
    noShadow(ctx);
  },
};

/** Glowing glyphs: short strokes picked from a little alphabet. */
const RUNES: number[][][] = [
  [[0, -1, 0, 1], [0, -1, 0.7, -0.4]],
  [[0, -1, 0, 1], [-0.6, -0.3, 0.6, 0.3]],
  [[-0.6, 1, 0, -1], [0, -1, 0.6, 1], [-0.3, 0.2, 0.3, 0.2]],
  [[0, -1, 0, 1], [0, 0, 0.6, -0.6], [0, 0, 0.6, 0.6]],
  [[-0.6, -1, 0.6, 1], [0.6, -1, -0.6, 1]],
  [[0, -1, 0, 1], [-0.6, -0.5, 0, 0], [0.6, -0.5, 0, 0]],
  [[-0.5, -1, 0.5, -1], [0, -1, 0, 1], [-0.5, 1, 0.5, 1]],
];

function runic(runeSize: number, spacing: number): Finish {
  return {
  base: (c) => mix(shade(c, -0.8), "#20222b", 0.5),
  lighting: { light: 0.45, dark: 0.7, highlight: "#8a8f9c" },
  step: 0.3,
  texture: (ctx, g, tables, base) => marble(ctx, g, tables, base, 0xa4c),
  ornament: (ctx, g) => {
    const w = bandWidth(g);
    const glow = shade(g.color, 0.35);
    ctx.save();
    ctx.shadowColor = rgba(g.color, 1);
    ctx.shadowBlur = w * 0.5;
    strokeAt(ctx, g, g.inner - w * 0.3, w * 0.035, rgba(glow, 0.9));
    ctx.strokeStyle = glow;
    ctx.lineWidth = Math.max(1, w * 0.05 * (runeSize / 0.17));
    ctx.lineCap = "round";
    const random = seededRandom(0x7a1);
    const size = w * runeSize;
    for (const p of alongBand(g, countFor(g, w * spacing, 0.36), 0.36)) {
      const rune = RUNES[Math.floor(random() * RUNES.length)];
      atPoint(ctx, p, () => {
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of rune) {
          ctx.moveTo(x0 * size * 0.7, y0 * size);
          ctx.lineTo(x1 * size * 0.7, y1 * size);
        }
        ctx.stroke();
      });
    }
    ctx.restore();
  },
  };
}

const arcane = runic(0.17, 0.5);

// Textures ----------------------------------------------------------------

const wood: Finish = {
  lighting: { light: 0.55, dark: 0.75 },
  step: 0.3,
  texture: (ctx, g, _t, base) => {
    const w = bandWidth(g);
    const random = seededRandom(0x0a4);
    const steps = countFor(g, w * 0.12);
    ctx.lineWidth = Math.max(0.6, w * 0.018);
    for (let k = 0; k < 14; k++) {
      const at = random();
      const freq = 3 + Math.floor(random() * 9);
      const phase = random() * Math.PI * 2;
      const amp = w * (0.02 + random() * 0.05);
      ctx.strokeStyle = random() < 0.6 ? rgba(shade(base, -0.65), 0.45) : rgba(shade(base, 0.4), 0.25);
      wavyLine(ctx, g, at, steps, (_i, t) => Math.sin(t * Math.PI * 2 * freq + phase) * amp);
      ctx.stroke();
    }
    // Knots.
    for (const p of alongBand(g, 5, 0.5)) {
      if (random() < 0.4) continue;
      atPoint(ctx, p, () => {
        for (let ring = 3; ring >= 1; ring--) {
          ctx.strokeStyle = rgba(shade(base, -0.7), 0.5);
          ctx.beginPath();
          ctx.ellipse((random() - 0.5) * w, (random() - 0.5) * w * 0.3, w * 0.09 * ring, w * 0.04 * ring, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  },
};

const stone: Finish = {
  lighting: { light: 0.6, dark: 0.75 },
  step: 0,
  texture: (ctx, g, _t, base) => {
    const w = bandWidth(g);
    const random = seededRandom(0x570e);
    const outer = shapePolygon(g.shape, g.R, g.outer - 1);
    const inner = shapePolygon(g.shape, g.R, g.inner + 1);
    const n = countFor(g, w * 1.15);
    const outerPts = samplePoints(outer, n);
    const innerPts = samplePoints(inner, n);
    const at = (pts: { x: number; y: number }[], i: number) => pts[((i % n) + n) % n];
    for (let i = 0; i < n; i++) {
      const a0 = at(outerPts, i);
      const a1 = at(outerPts, i + 1);
      const b0 = at(innerPts, i);
      const b1 = at(innerPts, i + 1);
      // Each block a slightly different tone.
      ctx.fillStyle = random() < 0.5 ? rgba(shade(base, 0.4), random() * 0.18) : rgba(shade(base, -0.5), random() * 0.22);
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.lineTo(b1.x, b1.y);
      ctx.lineTo(b0.x, b0.y);
      ctx.closePath();
      ctx.fill();
      // Mortar between blocks.
      ctx.strokeStyle = rgba(shade(base, -0.85), 0.8);
      ctx.lineWidth = w * 0.06;
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      const jx = (a0.x + b0.x) / 2 + (random() - 0.5) * w * 0.15;
      const jy = (a0.y + b0.y) / 2 + (random() - 0.5) * w * 0.15;
      ctx.lineTo(jx, jy);
      ctx.lineTo(b0.x, b0.y);
      ctx.stroke();
    }
    hammerTexture(ctx, g, rgba(shade(base, -0.7), 0.3), rgba(shade(base, 0.5), 0.2), 12, 0.6, 0x570f);
  },
};

/** `n` points spaced evenly along a closed outline. */
function samplePoints(poly: ReturnType<typeof shapePolygon>, n: number) {
  const total = perimeterLength(poly);
  const out: { x: number; y: number }[] = [];
  let edge = 0;
  let walked = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    for (;;) {
      const p = poly[edge];
      const q = poly[(edge + 1) % poly.length];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (walked + len >= target - 1e-9 || edge === poly.length - 1) {
        const t = len ? (target - walked) / len : 0;
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        break;
      }
      walked += len;
      edge++;
    }
  }
  return out;
}

/** Twisted strands, as on a rope. */
function ropeStrands(ctx: Ctx, g: FrameGeometry, base: string, seed = 0x40e): void {
  const w = bandWidth(g);
  const random = seededRandom(seed);
  for (const p of alongBand(g, countFor(g, w * 0.32))) {
    const l = localLight(p);
    atPoint(ctx, p, () => {
      ctx.rotate(-0.6);
      const gradient = ctx.createLinearGradient(l.x * w * 0.3, l.y * w * 0.3, -l.x * w * 0.3, -l.y * w * 0.3);
      gradient.addColorStop(0, rgba(shade(base, 0.45), 0.55));
      gradient.addColorStop(0.5, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.45)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.2, w * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(shade(base, -0.8), 0.6);
      ctx.lineWidth = Math.max(0.6, w * 0.025);
      ctx.beginPath();
      ctx.moveTo(w * 0.17, -w * 0.8);
      ctx.lineTo(w * 0.17, w * 0.8);
      ctx.stroke();
      // Fibres.
      ctx.strokeStyle = rgba(shade(base, 0.5), 0.2);
      ctx.lineWidth = Math.max(0.4, w * 0.01);
      for (let f = 0; f < 3; f++) {
        const x = (random() - 0.5) * w * 0.25;
        ctx.beginPath();
        ctx.moveTo(x, -w * 0.5);
        ctx.lineTo(x + w * 0.04, w * 0.5);
        ctx.stroke();
      }
    });
  }
}

/** Overlapping scales in staggered rows, `size` of the band across. */
function drawScales(ctx: Ctx, g: FrameGeometry, base: string, size: number): void {
  const w = bandWidth(g);
  const r = w * size;
  let row = 0;
  for (let at = 0.15; at < 1.1; at += size * 1.5, row++) {
    const shift = row % 2 === 1;
    const pts = alongBand(g, countFor(g, r * 1.6, at), at);
    pts.forEach((p, i) => {
      const q = pts[(i + (shift ? 1 : 0)) % pts.length];
      const x = shift ? (p.x + q.x) / 2 : p.x;
      const y = shift ? (p.y + q.y) / 2 : p.y;
      atPoint(ctx, { x, y, angle: p.angle }, () => {
        const gradient = ctx.createLinearGradient(0, -r, 0, r);
        gradient.addColorStop(0, rgba(shade(base, 0.45), 0.5));
        gradient.addColorStop(1, rgba(shade(base, -0.5), 0.35));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, -r * 0.2, r, 0, Math.PI);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(shade(base, -0.8), 0.7);
        ctx.lineWidth = Math.max(0.6, w * 0.025 * (size / 0.2));
        ctx.beginPath();
        ctx.arc(0, -r * 0.2, r, 0, Math.PI);
        ctx.stroke();
      });
    });
  }
}

const vines: Finish = {
  base: (c) => mix(c, "#4a3320", 0.55),
  lighting: { light: 0.5, dark: 0.75 },
  step: 0.25,
  texture: (ctx, g, tables, base) => wood.texture!(ctx, g, tables, base),
  ornament: (ctx, g) => {
    const w = bandWidth(g);
    const leaf = g.color;
    const steps = countFor(g, w * 0.08);
    const waves = Math.max(4, countFor(g, w * 1.8));
    raised(ctx, w, 0.45);
    ctx.strokeStyle = shade(leaf, -0.35);
    ctx.lineWidth = w * 0.1;
    ctx.lineCap = "round";
    wavyLine(ctx, g, 0.5, steps, (_i, t) => Math.sin(t * Math.PI * 2 * waves) * w * 0.22);
    ctx.stroke();
    const pts = alongBand(g, waves * 2, 0.5);
    pts.forEach((p, i) => {
      const side = i % 2 ? 1 : -1;
      atPoint(ctx, p, () => {
        ctx.translate(0, side * w * 0.1);
        ctx.rotate(side * 0.9);
        ctx.scale(2.3, 2.3);
        const gradient = ctx.createLinearGradient(0, -w * 0.15, 0, w * 0.15);
        gradient.addColorStop(0, shade(leaf, 0.35));
        gradient.addColorStop(1, shade(leaf, -0.3));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(w * 0.17, side * w * 0.12, w * 0.36, 0);
        ctx.quadraticCurveTo(w * 0.17, -side * w * 0.12, 0, 0);
        ctx.fill();
      });
    });
    noShadow(ctx);
    ctx.strokeStyle = rgba(shade(leaf, -0.6), 0.6);
    ctx.lineWidth = Math.max(0.5, w * 0.012);
  },
};

const magma: Finish = {
  base: (c) => mix(shade(c, -0.85), "#1a1414", 0.4),
  lighting: { light: 0.35, dark: 0.6, highlight: "#6a5a55" },
  step: 0.3,
  texture: (ctx, g, _t, base) => {
    hammerTexture(ctx, g, rgba(shade(base, -0.6), 0.5), rgba(shade(base, 0.4), 0.25), 8);
    const w = bandWidth(g);
    const random = seededRandom(0x1a7a);
    ctx.save();
    ctx.shadowColor = rgba(g.color, 1);
    ctx.shadowBlur = w * 0.3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const p of alongBand(g, countFor(g, w * 0.55))) {
      atPoint(ctx, p, () => {
        let x = (random() - 0.5) * w * 0.4;
        let y = -w * 0.5;
        let a = Math.PI / 2 + (random() - 0.5);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let i = 0; i < 6; i++) {
          a += (random() - 0.5) * 1.2;
          x += Math.cos(a) * w * 0.18;
          y += Math.sin(a) * w * 0.18;
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(g.color, 0.9);
        ctx.lineWidth = w * 0.05;
        ctx.stroke();
        ctx.strokeStyle = rgba(mix(g.color, "#fff3a0", 0.6), 0.9);
        ctx.lineWidth = w * 0.018;
        ctx.stroke();
      });
    }
    ctx.restore();
  },
};

const harlequin: Finish = {
  lighting: { light: 0.6, dark: 0.75 },
  step: 0,
  texture: (ctx, g, _t, base) => {
    const w = bandWidth(g);
    const pts = alongBand(g, ornamentCount(g.shape, countFor(g, w * 0.7)));
    pts.forEach((p, i) => {
      atPoint(ctx, p, () => {
        ctx.fillStyle = i % 2 ? rgba(shade(base, -0.75), 0.6) : rgba(shade(base, 0.55), 0.35);
        ctx.beginPath();
        ctx.moveTo(-w * 0.4, 0);
        ctx.lineTo(0, -w * 0.55);
        ctx.lineTo(w * 0.4, 0);
        ctx.lineTo(0, w * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(shade(base, -0.85), 0.5);
        ctx.lineWidth = Math.max(0.5, w * 0.02);
        ctx.stroke();
      });
    });
  },
};

const braid: Finish = {
  base: (c) => shade(c, -0.55),
  lighting: { light: 0.4, dark: 0.7 },
  step: 0,
  texture: (ctx, g, tables, base) => {
    marble(ctx, g, tables, base, 0xb4a1, 0.5);
    const w = bandWidth(g);
    const steps = countFor(g, w * 0.05);
    const twists = countFor(g, w * 0.9);
    const strand = shade(g.color, 0.1);
    // Two strands crossing; each crossing alternates which is on top.
    for (const phase of [0, Math.PI]) {
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = w * 0.24;
      wavyLine(ctx, g, 0.5, steps, (_i, t) => Math.sin(t * Math.PI * 2 * twists + phase) * w * 0.25);
      ctx.stroke();
      ctx.strokeStyle = strand;
      ctx.lineWidth = w * 0.17;
      ctx.stroke();
      ctx.strokeStyle = rgba(shade(strand, 0.6), 0.6);
      ctx.lineWidth = w * 0.04;
      ctx.stroke();
    }
  },
};

const starfield: Finish = {
  base: (c) => mix(shade(c, -0.8), "#0b0d1e", 0.5),
  lighting: { light: 0.35, dark: 0.6, highlight: "#4a4f7a" },
  step: 0.25,
  texture: (ctx, g) => {
    const w = bandWidth(g);
    const random = seededRandom(0x57a2);
    for (const p of alongBand(g, countFor(g, w * 0.6))) {
      const across = (random() - 0.5) * w;
      ctx.fillStyle = rgba(g.color, 0.18);
      ctx.beginPath();
      ctx.ellipse(p.x - Math.sin(p.angle) * across, p.y + Math.cos(p.angle) * across, w * 0.5, w * 0.2, p.angle, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of alongBand(g, countFor(g, w * 0.07))) {
      const across = (random() - 0.5) * w;
      const r = Math.max(0.4, w * (0.008 + random() ** 3 * 0.04));
      ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + random() * 0.6})`;
      ctx.beginPath();
      ctx.arc(p.x - Math.sin(p.angle) * across, p.y + Math.cos(p.angle) * across, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

// Classes -----------------------------------------------------------------

/** Barbarian: hide, with three-claw gashes. */
const claws: Finish = {
  lighting: { light: 0.5, dark: 0.75 },
  step: 0.3,
  texture: (ctx, g, _t, base) => {
    hammerTexture(ctx, g, rgba(shade(base, -0.5), 0.25), rgba(shade(base, 0.4), 0.15), 10, 0.5, 0xc1a);
    battleWear(ctx, g, base, 0xba4);
    const w = bandWidth(g);
    const random = seededRandom(0xc1a3);
    ctx.lineCap = "round";
    for (const p of alongBand(g, ornamentCount(g.shape, 6), 0.5)) {
      atPoint(ctx, p, () => {
        ctx.rotate(0.7 + (random() - 0.5) * 0.4);
        ctx.scale(1.7, 1.5);
        for (const dx of [-0.16, 0, 0.16]) {
          ctx.strokeStyle = "rgba(20, 5, 0, 0.9)";
          ctx.lineWidth = w * 0.09;
          ctx.beginPath();
          ctx.moveTo(dx * w, -w * 0.55);
          ctx.quadraticCurveTo(dx * w + w * 0.05, 0, dx * w, w * 0.55);
          ctx.stroke();
          ctx.strokeStyle = rgba(shade(base, 0.5), 0.5);
          ctx.lineWidth = w * 0.02;
          ctx.beginPath();
          ctx.moveTo(dx * w - w * 0.04, -w * 0.5);
          ctx.quadraticCurveTo(dx * w + w * 0.01, 0, dx * w - w * 0.04, w * 0.5);
          ctx.stroke();
        }
      });
    }
  },
};

/** Bard: notes dancing round the ring. */
const notes: Finish = {
  lighting: { light: 0.7, dark: 0.8 },
  step: 0.3,
  texture: (ctx, g, tables, base) => {
    marble(ctx, g, tables, base, 0xba7d, 0.6);
    groove(ctx, g, 0.25, base, 0.04);
    groove(ctx, g, 0.4, base, 0.04);
    groove(ctx, g, 0.55, base, 0.04);
  },
  ornament: (ctx, g) => {
    const w = bandWidth(g);
    const ink = "#f3d27a";
    const random = seededRandom(0xba7e);
    for (const p of alongBand(g, countFor(g, w * 1.7), 0.5)) {
      atPoint(ctx, p, () => {
        ctx.scale(2.5, 2.5);
        raised(ctx, w, 0.6);
        ctx.fillStyle = ink;
        ctx.strokeStyle = ink;
        ctx.lineWidth = w * 0.035;
        const y = (random() - 0.5) * w * 0.25;
        const pair = random() < 0.4;
        const heads = pair ? [-w * 0.1, w * 0.1] : [0];
        for (const x of heads) {
          ctx.beginPath();
          ctx.ellipse(x, y + w * 0.1, w * 0.07, w * 0.05, -0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(x + w * 0.06, y + w * 0.09);
          ctx.lineTo(x + w * 0.06, y - w * 0.2);
          ctx.stroke();
        }
        ctx.beginPath();
        if (pair) {
          ctx.moveTo(-w * 0.04, y - w * 0.2);
          ctx.lineTo(w * 0.16, y - w * 0.2);
          ctx.lineWidth = w * 0.06;
        } else {
          ctx.moveTo(w * 0.06, y - w * 0.2);
          ctx.quadraticCurveTo(w * 0.18, y - w * 0.12, w * 0.14, y - w * 0.02);
        }
        ctx.stroke();
      });
    }
    noShadow(ctx);
  },
};

/** Cleric: a sunburst of rays. */
const radiant: Finish = {
  lighting: { light: 0.95, dark: 0.75, highlight: "#fffbe0" },
  step: 0.3,
  texture: (ctx, g, _t, base) => {
    const w = bandWidth(g);
    const pts = alongBand(g, ornamentCount(g.shape, countFor(g, w * 0.42)), 0.7);
    pts.forEach((p, i) => {
      atPoint(ctx, p, () => {
        const long = i % 2 === 0;
        ctx.fillStyle = long ? rgba(mix(base, "#fffbe0", 0.7), 0.7) : rgba(shade(base, -0.4), 0.45);
        ctx.beginPath();
        ctx.moveTo(-w * 0.1, w * 0.15);
        ctx.lineTo(0, -(long ? w * 0.85 : w * 0.6));
        ctx.lineTo(w * 0.1, w * 0.15);
        ctx.closePath();
        ctx.fill();
      });
    });
  },
  ornament: (ctx, g, base) => {
    const w = bandWidth(g);
    for (const p of alongBand(g, ornamentCount(g.shape, 4), 0.5)) {
      raised(ctx, w);
      sphere(ctx, p.x, p.y, w * 0.3, mix(base, "#fff1b0", 0.3));
    }
    noShadow(ctx);
  },
};

/** Monk: prayer beads on a cord. */
const beads: Finish = {
  base: (c) => shade(c, -0.25),
  lighting: { light: 0.5, dark: 0.75 },
  step: 0,
  texture: (ctx, g, _t, base) => ropeStrands(ctx, g, base, 0xbead),
  ornament: (ctx, g) => {
    const w = bandWidth(g);
    const bead = mix(g.color, "#3a2010", 0.55);
    const pts = alongBand(g, countFor(g, w * 0.62));
    pts.forEach((p, i) => {
      const k = i % 9;
      // Every ninth is a large jade bead; its neighbours make way for it.
      if (k === 1 || k === 8) return;
      raised(ctx, w);
      sphere(ctx, p.x, p.y, w * (k === 0 ? 0.5 : 0.27), k === 0 ? "#3d8c6a" : bead);
    });
    noShadow(ctx);
  },
};

/** Paladin: polished silver with gold crosses and gems. */
const holy: Finish = {
  lighting: { light: 0.95, dark: 0.75, highlight: "#ffffff" },
  step: 0.35,
  texture: (ctx, g, _t, base) => groove(ctx, g, 0.3, base, 0.05),
  ornament: (ctx, g) => {
    const w = bandWidth(g);
    const gold = "#d9ad4a";
    const pts = alongBand(g, ornamentCount(g.shape, 8), 0.42);
    pts.forEach((p) => {
      atPoint(ctx, p, () => {
        raised(ctx, w);
        const s = w * 0.48;
        const gradient = ctx.createLinearGradient(-s, -s, s, s);
        gradient.addColorStop(0, "#fff0b8");
        gradient.addColorStop(1, shade(gold, -0.45));
        ctx.fillStyle = gradient;
        const t = w * 0.1;
        ctx.fillRect(-s * 0.7, -t, s * 1.4, t * 2);
        ctx.fillRect(-t, -s, t * 2, s * 2);
      });
    });
    const mid = alongBand(g, pts.length * 2, 0.42).filter((_p, i) => i % 2 === 1);
    for (const p of mid) {
      raised(ctx, w, 0.4);
      sphere(ctx, p.x, p.y, w * 0.14, "#3b6fd8");
    }
    noShadow(ctx);
  },
};

/** Ranger: rows of arrow fletching. */
const fletching: Finish = {
  lighting: { light: 0.6, dark: 0.75 },
  step: 0.25,
  texture: (ctx, g, _t, base) => {
    const w = bandWidth(g);
    const pts = alongBand(g, countFor(g, w * 0.4), 0.45);
    pts.forEach((p, i) => {
      atPoint(ctx, p, () => {
        ctx.strokeStyle = i % 4 < 2 ? rgba(shade(base, 0.5), 0.55) : rgba(mix(base, "#b0402a", 0.5), 0.7);
        ctx.lineWidth = w * 0.09;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(-w * 0.18, -w * 0.42);
        ctx.lineTo(w * 0.14, 0);
        ctx.lineTo(-w * 0.18, w * 0.42);
        ctx.stroke();
      });
    });
    strokeAt(ctx, g, g.outer + w * 0.45, w * 0.04, rgba(shade(base, -0.7), 0.7));
  },
};

/** Rogue: dark leather, stitched along both edges. */
const stitched: Finish = {
  lighting: { light: 0.45, dark: 0.7 },
  step: 0.25,
  texture: (ctx, g, _t, base) => {
    hammerTexture(ctx, g, rgba(shade(base, -0.6), 0.25), rgba(shade(base, 0.5), 0.12), 14, 0.4, 0x5717);
    const w = bandWidth(g);
    for (const at of [0.16, 0.66]) {
      strokeAt(ctx, g, g.outer + w * at, w * 0.05, "rgba(0, 0, 0, 0.35)");
      for (const p of alongBand(g, countFor(g, w * 0.24, at), at)) {
        atPoint(ctx, p, () => {
          ctx.rotate(-0.35);
          ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
          ctx.lineWidth = w * 0.055;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(-w * 0.07, w * 0.015);
          ctx.lineTo(w * 0.07, w * 0.015);
          ctx.stroke();
          ctx.strokeStyle = "#d8cbb0";
          ctx.lineWidth = w * 0.04;
          ctx.beginPath();
          ctx.moveTo(-w * 0.07, 0);
          ctx.lineTo(w * 0.07, 0);
          ctx.stroke();
        });
      }
    }
  },
};

/** Artificer: brass, its inner edge cut into gear teeth, with little gears on the band. */
const clockwork: Finish = {
  lighting: { light: 0.9, dark: 0.8, highlight: "#fff1c0" },
  step: 0.3,
  texture: (ctx, g, tables, base) => marble(ctx, g, tables, base, 0xc10c, 0.5),
  ornament: (ctx, g, base) => {
    const w = bandWidth(g);
    // Teeth reach in from the inner edge, like a ring gear's.
    ctx.save();
    raised(ctx, w, 0.6);
    for (const p of alongBand(g, countFor(g, w * 0.6, 1), 1)) {
      const l = localLight(p);
      atPoint(ctx, p, () => {
        const gradient = ctx.createLinearGradient(l.x * w * 0.15, l.y * w * 0.15, -l.x * w * 0.15, -l.y * w * 0.15);
        gradient.addColorStop(0, shade(base, 0.35));
        gradient.addColorStop(1, shade(base, -0.45));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(-w * 0.17, -w * 0.05);
        ctx.lineTo(-w * 0.1, w * 0.3);
        ctx.lineTo(w * 0.1, w * 0.3);
        ctx.lineTo(w * 0.17, -w * 0.05);
        ctx.closePath();
        ctx.fill();
      });
    }
    ctx.restore();
    for (const p of alongBand(g, ornamentCount(g.shape, 6), 0.45)) {
      raised(ctx, w);
      const r = w * 0.36;
      ctx.fillStyle = shade(base, 0.2);
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 ? r : r * 1.3;
        ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      noShadow(ctx);
      sphere(ctx, p.x, p.y, r * 0.8, shade(base, 0.05));
      ctx.fillStyle = shade(base, -0.7);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    noShadow(ctx);
  },
};

/** Eyes that watch from the ring (Warlock). */
function eyesOrnament(ctx: Ctx, g: FrameGeometry, count: number, iris: string, scale: number): void {
  const w = bandWidth(g);
  const random = seededRandom(0xe7e5);
  for (const p of alongBand(g, count, 0.48)) {
    const r = w * scale * (0.85 + random() * 0.2);
    // Every eye looks at the middle of the token.
    atPoint(ctx, p, () => {
      raised(ctx, w, 0.6);
      ctx.fillStyle = "#f2ead8";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.3, r, 0, 0, Math.PI * 2);
      ctx.fill();
      noShadow(ctx);
      const sclera = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.3);
      sclera.addColorStop(0, "rgba(255, 255, 255, 0)");
      sclera.addColorStop(1, "rgba(120, 20, 20, 0.45)");
      ctx.fillStyle = sclera;
      ctx.fill();
      sphere(ctx, 0, r * 0.3, r * 0.6, iris);
      ctx.fillStyle = "#050505";
      ctx.beginPath();
      ctx.ellipse(0, r * 0.35, r * 0.15, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(-r * 0.2, r * 0.05, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(20, 0, 10, 0.85)";
      ctx.lineWidth = w * 0.05;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.3, r, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
}

const eyes: Finish = {
  base: (c) => shade(c, -0.2),
  lighting: { light: 0.5, dark: 0.75 },
  step: 0.25,
  texture: (ctx, g, tables, base) => marble(ctx, g, tables, base, 0xe7e, 1.4),
  ornament: (ctx, g) => eyesOrnament(ctx, g, ornamentCount(g.shape, 6), "#c7e04a", 0.5),
};

/** Sorcerer: large draconic scales. */
const sorcerer: Finish = {
  lighting: { light: 0.75, dark: 0.8 },
  step: 0.25,
  texture: (ctx, g, _t, base) => drawScales(ctx, g, base, 0.3),
};

/** Wizard: the Arcane band with larger runes. */
const wizard = runic(0.26, 0.7);

export const FINISHES = {
  line: polished,
  double,
  gilded,
  engraved,
  riveted,
  arcane,
  wood,
  stone,
  vines,
  magma,
  harlequin,
  braid,
  starfield,
  claws,
  notes,
  radiant,
  beads,
  holy,
  fletching,
  stitched,
  clockwork,
  eyes,
  sorcerer,
  wizard,
} satisfies Record<string, Finish>;

export type FinishStyle = keyof typeof FINISHES;
