// A stand-in for the LegendKeeper v3 API and its asset host, shaped after the
// OpenAPI spec, for integration tests and local UI development.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { createCanvas } from "@napi-rs/canvas";

export const PROJECT_ID = "proj_test01";
export const API_KEY = "lk_test_key_do_not_leak_0123456789";
/** A working key for a different project. */
export const OTHER_API_KEY = "lk_other_project_key_0123456789";
export const OTHER_PROJECT_ID = "proj_other";

export function makePng(width: number, height: number, color = "#b0413e"): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f3d27a";
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer("image/png");
}

/** Procedural portrait-style art: sky gradient, a hooded figure, optional plain background. */
export function makeArt(width: number, height: number, hue: number, plainBackground = false): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (plainBackground) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, `hsl(${hue}, 45%, 22%)`);
    sky.addColorStop(0.6, `hsl(${(hue + 30) % 360}, 50%, 38%)`);
    sky.addColorStop(1, `hsl(${(hue + 50) % 360}, 55%, 52%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255, 255, 230, ${0.2 + ((i * 37) % 10) / 20})`;
      ctx.beginPath();
      ctx.arc(((i * 97) % 100) / 100 * width, ((i * 53) % 45) / 100 * height, 1 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const u = Math.min(width, height);
  const cx = width / 2;
  const cy = height * 0.42;
  // Cloak and shoulders.
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 30%, 18%)`;
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.42, height);
  ctx.quadraticCurveTo(cx - u * 0.38, cy + u * 0.18, cx, cy - u * 0.28);
  ctx.quadraticCurveTo(cx + u * 0.38, cy + u * 0.18, cx + u * 0.42, height);
  ctx.closePath();
  ctx.fill();
  // Face in the hood.
  ctx.fillStyle = `hsl(${(hue + 20) % 360}, 35%, 62%)`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, u * 0.12, u * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  // Glowing eyes.
  ctx.fillStyle = `hsl(${(hue + 160) % 360}, 90%, 70%)`;
  for (const dx of [-0.045, 0.045]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * u, cy - u * 0.02, u * 0.022, u * 0.012, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Staff.
  ctx.strokeStyle = `hsl(${(hue + 40) % 360}, 40%, 40%)`;
  ctx.lineWidth = u * 0.025;
  ctx.beginPath();
  ctx.moveTo(cx + u * 0.3, height);
  ctx.lineTo(cx + u * 0.34, cy - u * 0.3);
  ctx.stroke();
  ctx.fillStyle = `hsl(${(hue + 160) % 360}, 90%, 65%)`;
  ctx.beginPath();
  ctx.arc(cx + u * 0.34, cy - u * 0.33, u * 0.04, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer("image/png");
}

export interface MockLk {
  baseUrl: string;
  assetBase: string;
  /** Requests seen, as "METHOD path". */
  requests: string[];
  /** Requests that carried an API key, as "KEY METHOD path". */
  authorizedRequests: string[];
  /** Override: respond to the next N calls of a path prefix with a status. */
  failNext(pathPrefix: string, status: number, code: string, times?: number, headers?: Record<string, string>): void;
  /** Makes the project public, so its public pages can be listed without a key. */
  setPublic(isPublic: boolean): void;
  close(): Promise<void>;
}

function runs(text: string) {
  return [{ text }];
}

function folder(id: string, name: string, parentId: string | null, isHidden: boolean, rank: string) {
  // getResource omits parentId at the root (listResources says null).
  return { id, name, ...(parentId ? { parentId } : {}), tags: [], aliases: [], rank, isHidden, permissions: {}, documents: [], properties: [] };
}

interface FixtureResource {
  id: string;
  name: string;
  parentId?: string | null;
  tags: string[];
  aliases: string[];
  rank: string;
  isHidden: boolean;
  documents: { id: string; name: string; type: string }[];
}

/** listResources' view of a resource (a ResourceListItem). */
function listed(r: FixtureResource) {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parentId ?? null,
    tags: r.tags,
    aliases: r.aliases,
    rank: r.rank,
    isHidden: r.isHidden,
    documents: r.documents.map((d) => ({ id: d.id, name: d.name, type: d.type })),
  };
}

/** Hidden, or under a hidden folder: anonymous visitors can't see it. */
function hiddenFromPublic(r: FixtureResource, all: Record<string, unknown>): boolean {
  for (let at: FixtureResource | undefined = r, depth = 0; at && depth < 20; depth++) {
    if (at.isHidden) return true;
    at = at.parentId ? (all[at.parentId] as FixtureResource | undefined) : undefined;
  }
  return false;
}

export function buildFixtures(assetBase: string) {
  const resources: Record<string, unknown> = {
    goblin: {
      id: "goblin",
      name: "Goblin Boss",
      parentId: "bestiary",
      tags: ["monster", "goblinoid"],
      aliases: ["Boss"],
      rank: "a0",
      isHidden: false,
      permissions: {},
      imageUrl: `${assetBase}/assets/goblin-icon.png`,
      banner: { enabled: true, url: `${assetBase}/assets/goblin-banner.png`, yPosition: 50 },
      documents: [
        { id: "doc1", name: "Overview", type: "page", rank: "a0", isHidden: false },
        { id: "doc2", name: "Lair map", type: "map", rank: "a1", isHidden: false },
        { id: "doc3", name: "Broken", type: "page", rank: "a2", isHidden: false },
      ],
      properties: [
        { id: "p1", kind: "image", url: `${assetBase}/assets/goblin-portrait.png`, title: "Portrait" },
        {
          id: "p2",
          kind: "keyValue",
          title: "Stats",
          rows: [
            { id: "r1", rank: "a0", key: "Type", text: "Humanoid", content: runs("Humanoid") },
            { id: "r2", rank: "a1", key: "Size", text: "Small", content: runs("Small") },
          ],
        },
      ],
      updatedAt: "2026-10-01T10:00:00Z",
    },
    dragon: {
      id: "dragon",
      name: "Ancient Red Dragon",
      parentId: "bestiary",
      tags: ["monster"],
      aliases: [],
      rank: "a1",
      isHidden: false,
      permissions: {},
      documents: [
        { id: "d1", name: "Statblock", type: "page", rank: "a0", isHidden: false },
        { id: "d2", name: "DM notes", type: "page", rank: "a1", isHidden: true },
      ],
      properties: [],
    },
    village: {
      id: "village",
      name: "Millbrook",
      tags: ["location"],
      aliases: [],
      rank: "a2",
      isHidden: false,
      permissions: {},
      documents: [{ id: "v1", name: "Main", type: "page", rank: "a0", isHidden: false }],
      // A sidebar field only the GM sees.
      properties: [{ id: "vp", kind: "image", url: `${assetBase}/assets/goblin-banner.png`, title: "Secret map", isHidden: true }],
    },
    ogre: {
      id: "ogre",
      name: "Ogre",
      tags: ["monster"],
      aliases: [],
      rank: "a3",
      isHidden: false,
      permissions: {},
      documents: [
        { id: "o1", name: "Main", type: "page", rank: "a0", isHidden: false },
        { id: "o2", name: "Gallery", type: "board", rank: "a1", isHidden: false },
        { id: "o3", name: "Deleted board", type: "board", rank: "a2", isHidden: false, deletedAt: "2026-01-01T00:00:00Z" },
      ],
      properties: [],
    },
    // Folders and a hidden branch, for page lists.
    bestiary: folder("bestiary", "Bestiary", null, false, "a4"),
    cabal: folder("cabal", "The Cabal", null, true, "a5"),
    villain: { ...folder("villain", "Mordrith", "cabal", false, "a6"), aliases: ["The Hollow Queen"], tags: ["npc"] },
    tpl: folder("tpl", "NPC Template", "templates", false, "a7"),
    missingimg: {
      id: "missingimg",
      name: "Lost Portrait",
      tags: [],
      aliases: [],
      rank: "a3",
      isHidden: false,
      permissions: {},
      documents: [{ id: "m1", name: "Main", type: "page", rank: "a0", isHidden: false }],
      properties: [{ id: "x", kind: "image", url: `${assetBase}/assets/does-not-exist.png`, title: "Gone" }],
    },
  };

  const blocks: Record<string, unknown[]> = {
    "goblin/doc1": [
      { id: "b1", kind: "heading", level: 1, content: runs("Goblin Boss") },
      {
        id: "b2",
        kind: "infobox",
        rows: [{ id: "ib1", kind: "image", url: `${assetBase}/assets/goblin-infobox.png`, title: "Image" }],
      },
      {
        id: "b3",
        kind: "layout",
        children: [
          {
            id: "b4",
            kind: "layoutColumn",
            children: [
              { id: "b5", kind: "image", url: `${assetBase}/assets/goblin-portrait.png`, title: "Duplicate" },
              { id: "b6", kind: "image", url: `${assetBase}/assets/goblin-action.png`, alt: "Goblin attacking" },
            ],
          },
        ],
      },
      { id: "b7", kind: "paragraph", content: runs("A large goblin, chaotic and cruel, leads the warband.") },
      {
        id: "b8",
        kind: "bulletList",
        children: [
          {
            id: "b9",
            kind: "listItem",
            children: [
              {
                id: "b10",
                kind: "paragraph",
                content: [{ text: "Serves ", bold: true }, { mention: { resourceId: "dragon", name: "Ancient Red Dragon" } }, { text: " (see ", link: "javascript:alert(1)" }, { text: "wiki", link: "https://example.com/wiki" }, { text: ")" }],
              },
            ],
          },
        ],
      },
      { id: "b11", kind: "secret", children: [{ id: "b12", kind: "paragraph", content: runs("Secretly a kobold.") }] },
    ],
    "dragon/d1": [
      { id: "s1", kind: "paragraph", content: runs("Gargantuan dragon, chaotic evil") },
      {
        id: "s2",
        kind: "secret",
        children: [{ id: "s3", kind: "image", url: `${assetBase}/assets/dragon.jpg`, title: "Red dragon art" }],
      },
    ],
    "dragon/d2": [{ id: "n1", kind: "image", url: `${assetBase}/assets/goblin-action.png`, title: "Lair plan" }],
    "village/v1": [{ id: "v", kind: "paragraph", content: runs("A large village by the river.") }],
    "missingimg/m1": [],
    "ogre/o1": [{ id: "o", kind: "image", url: `${assetBase}/assets/ogre-main.png`, title: "Ogre" }],
  };

  // Board content (tldraw records), by "resource/document".
  const boards: Record<string, unknown> = {
    "ogre/o2": {
      shapes: [
        { id: "shape:frame", type: "frame", x: 0, y: 500, parentId: "page:1", props: {} },
        // Inside the frame: really at y = 520, below the shape at y = 100.
        { id: "shape:low", type: "image", x: 10, y: 20, parentId: "shape:frame", props: { assetId: "asset:low" } },
        { id: "shape:high", type: "image", x: 300, y: 100, parentId: "page:1", props: { assetId: "asset:high" } },
        { id: "shape:text", type: "text", x: 0, y: 0, parentId: "page:1", props: { text: "Notes" } },
      ],
      assets: [
        { id: "asset:low", type: "image", props: { src: `${assetBase}/assets/ogre-club.png`, name: "club.png" } },
        { id: "asset:high", type: "image", props: { src: `${assetBase}/assets/ogre-face.png`, name: "face.png" } },
        // On the board but not shown by any shape.
        { id: "asset:spare", type: "image", props: { src: `${assetBase}/assets/ogre-spare.png`, name: "" } },
        { id: "asset:link", type: "bookmark", props: { src: "https://example.com" } },
        // Already on the page tab: listed once.
        { id: "asset:dup", type: "image", props: { src: `${assetBase}/assets/ogre-main.png` } },
      ],
    },
  };

  return { resources, blocks, boards };
}

export async function startMockLk(listenPort = 0): Promise<MockLk> {
  const requests: string[] = [];
  const authorizedRequests: string[] = [];
  const failures: { prefix: string; status: number; code: string; times: number; headers: Record<string, string> }[] = [];
  let isPublic = false;
  const pngs: Record<string, Buffer> = {
    "goblin-icon.png": makeArt(64, 64, 110),
    "goblin-banner.png": makeArt(800, 200, 220),
    "goblin-portrait.png": makeArt(600, 800, 20),
    "goblin-infobox.png": makeArt(512, 512, 280),
    "goblin-action.png": makeArt(900, 600, 0, true),
  };
  // A JPEG would need an encoder; serve PNG bytes under a .jpg name to prove sniffing ignores names.
  pngs["dragon.jpg"] = makeArt(1200, 900, 350);

  let assetBase = "";
  let fixtures: ReturnType<typeof buildFixtures>;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const pathname = url.pathname.replace(/\/$/, "");
    requests.push(`${req.method} ${pathname}`);
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (auth) authorizedRequests.push(`${auth} ${req.method} ${pathname}`);

    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", "x-request-id": "req_mock", ...headers });
      res.end(JSON.stringify(body));
    };

    if (pathname.startsWith("/assets/")) {
      const png = pngs[pathname.slice("/assets/".length)];
      if (!png) return json(404, { message: "Not found" });
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": png.length });
      return void res.end(png);
    }

    const failure = failures.find((f) => pathname.startsWith(f.prefix) && f.times > 0);
    if (failure) {
      failure.times -= 1;
      return json(failure.status, { message: "Mock failure", code: failure.code, requestId: "req_fail" }, failure.headers);
    }

    const listPath = `/api/v3/projects/${PROJECT_ID}/resources`;
    const keyless = !req.headers.authorization;
    if (req.headers.authorization === `Bearer ${OTHER_API_KEY}`) {
      if (pathname === "/api/v3/projects") {
        return json(200, { data: [{ id: OTHER_PROJECT_ID, name: "Another World", isPublic: false }], hasMore: false, nextCursor: null });
      }
      return json(403, { message: "Wrong project", code: "WRONG_PROJECT", requestId: "r" });
    }
    if (keyless && isPublic && pathname === listPath) {
      // A public project lists its public pages to anyone.
    } else if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      return json(401, { message: "Unauthenticated", code: "UNAUTHENTICATED", requestId: "req_401" });
    }

    if (pathname === "/api/v3/projects") {
      return json(200, { data: [{ id: PROJECT_ID, name: "The Test Realm", isPublic }], hasMore: false, nextCursor: null });
    }

    if (pathname === listPath) {
      // Ordered by id, two per page, so clients must follow the cursor.
      const all = Object.values(fixtures.resources) as FixtureResource[];
      const visible = all
        .filter((r) => !keyless || !hiddenFromPublic(r, fixtures.resources))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Math.min(2, Number(url.searchParams.get("limit") ?? 32));
      const data = visible.slice(start, start + limit).map(listed);
      const next = start + limit < visible.length ? String(start + limit) : null;
      return json(200, { data, hasMore: next !== null, nextCursor: next });
    }

    const base = `/api/v3/projects/${PROJECT_ID}`;
    if (!pathname.startsWith(base)) return json(403, { message: "Wrong project", code: "WRONG_PROJECT", requestId: "r" });
    const rest = pathname.slice(base.length);

    if (rest === "/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const limit = Number(url.searchParams.get("limit") ?? 32);
      const data: unknown[] = [];
      for (const r of Object.values(fixtures.resources) as { id: string; name: string; tags: string[] }[]) {
        if (r.name.toLowerCase().includes(q)) {
          data.push({ resource: { id: r.id, name: r.name, tags: r.tags, path: [{ id: "root", name: "Bestiary" }] } });
          // A second hit for the same resource, matching in a document.
          data.push({
            resource: { id: r.id, name: r.name, tags: r.tags },
            document: {
              id: "doc",
              name: "Overview",
              highlights: [{ segment: `About ${r.name} and friends`, index: 0, matchStart: 6, matchEnd: 6 + r.name.length }],
            },
          });
        }
      }
      return json(200, { data: data.slice(0, limit), hasMore: false, nextCursor: null });
    }

    const resMatch = /^\/resources\/([^/]+)(?:\/docs\/([^/]+)\/(blocks|board))?$/.exec(rest);
    if (resMatch) {
      const [, rid, docId, part] = resMatch;
      const resource = fixtures.resources[rid];
      if (!resource) return json(404, { message: "Not found", code: "NOT_FOUND", requestId: "r404" });
      if (!docId) return json(200, resource);
      if (part === "board") {
        const board = fixtures.boards[`${rid}/${docId}`];
        if (!board) return json(400, { message: "Not a board", code: "KIND_MISMATCH", requestId: "r400" });
        return json(200, { schema: {}, pages: [], bindings: [], version: "v1", ...(board as object) });
      }
      const content = fixtures.blocks[`${rid}/${docId}`];
      if (!content) return json(500, { message: "Internal", code: "INTERNAL", requestId: "r500" });
      return json(200, { id: docId, version: "v1", schema: 1, text: "", blocks: content });
    }

    json(404, { message: "Not found", code: "NOT_FOUND", requestId: "r" });
  });

  await new Promise<void>((resolve) => server.listen(listenPort, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  assetBase = baseUrl;
  fixtures = buildFixtures(assetBase);

  return {
    baseUrl,
    assetBase,
    requests,
    authorizedRequests,
    failNext(prefix, status, code, times = 1, headers = {}) {
      failures.push({ prefix, status, code, times, headers });
    },
    setPublic(value) {
      isPublic = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
