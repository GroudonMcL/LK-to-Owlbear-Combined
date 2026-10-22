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
import { samplePerimeter, shapePolygon } from "./shapes";

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

// Classic ------------------------------------------------------------------

const polished: Finish = {
  lighting: { light: 0.9, dark: 0.75 },
  step: 0.35,
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
  texture: (ctx, g, tables) => {
    const w = bandWidth(g);
    const mid = shapePolygon(g.shape, g.R, g.outer + w / 2);
    // An even number of diamonds (and a whole number per side of a polygon), so light
    // and dark alternate all the way round, the seam at the top included.
    const per = g.shape === "circle" ? 2 : g.shape === "hexagon" || g.shape === "hexagonFlat" ? 6 : 4;
    const n = Math.max(per, Math.round(perimeterLength(mid) / (w * 0.8) / per) * per);
    // Each diamond's side tips lie on the band's middle line, shared with its
    // neighbours, and a polygon's corners fall on tips, so every diamond sits on one
    // straight side; its other two corners lie straight across, just past the band.
    const points = samplePerimeter(mid, n * 2);
    const reach = w * 0.55;
    ctx.lineJoin = "miter";
    for (let i = 0; i < n; i++) {
      const c = points[2 * i + 1];
      const left = points[2 * i];
      const right = points[(2 * i + 2) % (2 * n)];
      const nx = -Math.sin(c.angle);
      const ny = Math.cos(c.angle);
      // Light and dark relative to the band's own lighting, so they read apart on both its lit and shaded sides.
      const under = tables.band[degreesAt(c.x, c.y)];
      ctx.fillStyle = i % 2 ? mix(under, "#000000", 0.55) : mix(under, "#ffffff", 0.32);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(c.x - nx * reach, c.y - ny * reach);
      ctx.lineTo(right.x, right.y);
      ctx.lineTo(c.x + nx * reach, c.y + ny * reach);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = Math.max(0.5, w * 0.015);
      ctx.stroke();
    }
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

/** Construct: brass, its inner edge cut into gear teeth, with little gears on the band. */
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

/** Runes: the Arcane band with larger runes. */
const wizard = runic(0.26, 0.7);

export const FINISHES = {
  line: polished,
  gilded,
  engraved,
  arcane,
  wood,
  vines,
  magma,
  harlequin,
  braid,
  starfield,
  clockwork,
  wizard,
} satisfies Record<string, Finish>;

export type FinishStyle = keyof typeof FINISHES;
