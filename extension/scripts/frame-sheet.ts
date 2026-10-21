// Renders every frame preset to one PNG for review:
//   npx tsx extension/scripts/frame-sheet.ts out.png [circle|square|hexagon…] [size]
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import type { Ctx } from "../src/editor/frames";
import { DEFAULT_STYLE, DEFAULT_TRANSFORM, FRAME_GROUPS, FRAME_PRESETS, type ShapeId } from "../src/editor/model";
import { renderToken } from "../src/editor/render";

const out = process.argv[2];
const shape = (process.argv[3] ?? "circle") as ShapeId;
const size = Number(process.argv[4] ?? 220);
const cols = 6;
const label = 26;
const rows = FRAME_GROUPS.reduce((n, g) => n + Math.ceil(FRAME_PRESETS.filter((p) => p.group === g).length / cols), 0);
const sheet = createCanvas(cols * size, rows * (size + label) + FRAME_GROUPS.length * 34);
const ctx = sheet.getContext("2d");
ctx.fillStyle = "#3a3d46";
ctx.fillRect(0, 0, sheet.width, sheet.height);
// A portrait-ish stand-in for art: sky, hills and a figure.
const art = createCanvas(400, 400);
const a = art.getContext("2d");
const sky = a.createLinearGradient(0, 0, 0, 400);
sky.addColorStop(0, "#8fb4d8");
sky.addColorStop(1, "#e8d6b0");
a.fillStyle = sky;
a.fillRect(0, 0, 400, 400);
a.fillStyle = "#5c7a4a";
a.beginPath();
a.ellipse(200, 420, 320, 170, 0, 0, Math.PI * 2);
a.fill();
a.fillStyle = "#3b2a2a";
a.beginPath();
a.arc(200, 170, 60, 0, Math.PI * 2);
a.fill();
a.fillRect(130, 220, 140, 180);
let y = 0;
for (const group of FRAME_GROUPS) {
  ctx.fillStyle = "#f0e6cc";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(group, 12, y + 25);
  y += 34;
  const presets = FRAME_PRESETS.filter((p) => p.group === group);
  presets.forEach((p, i) => {
    const x = (i % cols) * size;
    const yy = y + Math.floor(i / cols) * (size + label);
    const c = createCanvas(size, size);
    renderToken(c.getContext("2d") as unknown as Ctx, size, { image: art as unknown as CanvasImageSource, width: 400, height: 400 }, { ...DEFAULT_STYLE, ...p.style, shape }, DEFAULT_TRANSFORM);
    ctx.drawImage(c, x, yy);
    ctx.fillStyle = "#ffffff";
    ctx.font = "16px sans-serif";
    ctx.fillText(p.name, x + 10, yy + size + 18);
  });
  y += Math.ceil(presets.length / cols) * (size + label);
}
writeFileSync(out, sheet.toBuffer("image/png"));
