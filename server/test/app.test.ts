import { mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPageList, type StoredPageList } from "@lkob/shared";
import { loadConfig } from "../src/core/config.js";
import { createHandler, VERSION } from "../src/core/handler.js";
import { LkClient } from "../src/core/lk/client.js";
import { imageIdFor } from "../src/core/lk/extract.js";
import { MemoryPageListStore } from "../src/core/pageListStore.js";
import { PageService, ProjectResolver } from "../src/core/services.js";
import { toNodeListener } from "../src/node/adapter.js";
import { FileTokenStore } from "../src/node/fileTokenStore.js";
import { safeFetch } from "../src/node/safeFetch.js";
import worker, { type KvLike } from "../src/worker.js";
import { API_KEY, makePng, OTHER_API_KEY, OTHER_PROJECT_ID, PROJECT_ID, startMockLk, type MockLk } from "./mockLk.js";

let lk: MockLk;
let server: http.Server;
let base = "";
let tokenDir = "";
let rateLimit = 1000;
const PASSWORD = "goblin";
const OTHER_PASSWORD = "a-second-password";

/** In-memory stand-in for a Workers KV namespace. */
export function fakeKv(): KvLike & { size: () => number } {
  const store = new Map<string, { value: Uint8Array; metadata: unknown }>();
  return {
    async get(key: string) {
      const hit = store.get(key);
      return hit ? new TextDecoder().decode(hit.value) : null;
    },
    async getWithMetadata(key: string) {
      const hit = store.get(key);
      return hit
        ? { value: new Response(hit.value).body as ReadableStream<Uint8Array>, metadata: hit.metadata as never }
        : { value: null, metadata: null };
    },
    async put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { metadata?: unknown }) {
      store.set(key, { value: typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value), metadata: options?.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    size: () => store.size,
  };
}

const RUNTIMES = ["node", "worker"] as const;
type Runtime = (typeof RUNTIMES)[number];

function envFor(options: { hosting?: boolean }) {
  return {
    LK_BASE_URL: lk.baseUrl,
    LK_API_KEYS: `${API_KEY},${OTHER_API_KEY}`,
    LKOB_ACCESS_TOKENS: `${PASSWORD},${OTHER_PASSWORD}`,
    LKOB_TOKEN_DIR: tokenDir,
    LKOB_TOKEN_HOSTING: options.hosting === false ? "off" : "on",
    LKOB_PUBLIC_URL: "https://tokens.example",
    LKOB_ALLOWED_ORIGINS: "https://ext.example",
    LKOB_INSECURE_ASSET_FETCH: "1",
    LKOB_RATE_LIMIT_PER_MINUTE: String(rateLimit),
  };
}

let runtime: Runtime = "node";

async function start(options: { hosting?: boolean } = {}) {
  let handle: (request: Request) => Promise<Response>;
  if (runtime === "node") {
    const config = loadConfig(envFor(options));
    const projects = new ProjectResolver();
    const pages = new PageService(projects, {
      lkBaseUrl: lk.baseUrl,
      pageLists: new MemoryPageListStore(),
      listRequestsPerChunk: 2,
      maxSourceImageBytes: config.maxSourceImageBytes,
      assetHostAllowlist: null,
      allowInsecureAssetFetch: true,
      fetchImage: safeFetch,
    });
    let tokens: FileTokenStore | null = null;
    if (config.tokenHosting) {
      tokens = new FileTokenStore(config.tokenStoreDir, config.tokenStoreMaxBytes);
      await tokens.init();
    }
    const makeClient = (apiKey: string) => new LkClient({ baseUrl: lk.baseUrl, apiKey, sleep: async () => {} });
    handle = createHandler({ config, projects, pages, tokens, makeClient, log: () => {} });
  } else {
    // The real Worker entry, with a fake KV namespace and static-asset binding.
    const env = {
      ...envFor(options),
      TOKENS: fakeKv(),
      ASSETS: { fetch: async () => new Response("<!doctype html>static", { headers: { "Content-Type": "text/html" } }) },
    };
    const ctx = { waitUntil: () => undefined };
    handle = (request) => worker.fetch(request, env, ctx);
  }
  server = http.createServer(toNodeListener(handle));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop() {
  await new Promise<void>((r) => server.close(() => r()));
}

function api(pathname: string, init: RequestInit = {}, password = PASSWORD) {
  return fetch(base + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${password}`, Origin: "https://ext.example", ...(init.headers ?? {}) },
  });
}

describe.each(RUNTIMES)("%s runtime", (which) => {
beforeAll(async () => {
  runtime = which;
  lk = await startMockLk();
  tokenDir = await mkdtemp(path.join(os.tmpdir(), "lkob-tokens-"));
  await start();
});

afterAll(async () => {
  await stop();
  await lk.close();
  await rm(tokenDir, { recursive: true, force: true });
});

beforeEach(() => {
  lk.requests.length = 0;
});

describe("auth and CORS", () => {
  it("serves health without auth", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(await res.json()).toEqual({ ok: true, version: VERSION, tokenHosting: true });
  });

  it("asks for the access password without calling LegendKeeper", async () => {
    const missing = await fetch(`${base}/api/projects`);
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe("UNAUTHORIZED");
    const wrong = await api("/api/projects", {}, "nope");
    expect(wrong.status).toBe(401);
    // A LegendKeeper key is not a password here.
    expect((await api("/api/projects", {}, API_KEY)).status).toBe(401);
    expect(lk.requests).toEqual([]);
  });

  it("accepts any of several passwords", async () => {
    expect((await api("/api/projects", {}, OTHER_PASSWORD)).status).toBe(200);
  });

  it("answers preflight for the allowed origin only", async () => {
    const ok = await fetch(`${base}/api/projects`, { method: "OPTIONS", headers: { Origin: "https://ext.example" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://ext.example");
    expect(ok.headers.get("access-control-allow-headers")).toContain("Authorization");
    const other = await fetch(`${base}/api/projects`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("projects and search", () => {
  it("names the project each of the server's keys opens", async () => {
    const body = await (await api("/api/projects")).json();
    expect(body).toEqual({
      projects: [
        { id: PROJECT_ID, name: "The Test Realm", isPublic: false },
        { id: OTHER_PROJECT_ID, name: "Another World", isPublic: false },
      ],
    });
  });

  it("de-duplicates search hits and keeps the content match snippet", async () => {
    const body = await (await api(`/api/projects/${PROJECT_ID}/search?q=goblin`)).json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ id: "goblin", name: "Goblin Boss", path: ["Bestiary"], tags: ["monster", "goblinoid"] });
  });

  it("caches identical searches", async () => {
    await api(`/api/projects/${PROJECT_ID}/search?q=dragon`);
    await api(`/api/projects/${PROJECT_ID}/search?q=Dragon`);
    expect(lk.requests.filter((r) => r.endsWith("/search"))).toHaveLength(1);
  });

  it("returns an empty list for blank searches without calling LegendKeeper", async () => {
    const body = await (await api(`/api/projects/${PROJECT_ID}/search?q=%20`)).json();
    expect(body.results).toEqual([]);
    expect(lk.requests).toEqual([]);
  });

  it("refuses projects no key opens, without asking LegendKeeper", async () => {
    await api("/api/projects");
    lk.requests.length = 0;
    const res = await api(`/api/projects/proj_nobody/search?q=x`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("PROJECT_NOT_CONFIGURED");
    expect(lk.requests).toEqual([]);
  });

  it("uses each project's own key", async () => {
    await api("/api/projects");
    lk.requests.length = 0;
    lk.authorizedRequests.length = 0;
    await api(`/api/projects/${OTHER_PROJECT_ID}/pages/goblin?fresh=1`);
    await api(`/api/projects/${PROJECT_ID}/pages/goblin?fresh=1`);
    expect(lk.authorizedRequests).toContain(`${OTHER_API_KEY} GET /api/v3/projects/${OTHER_PROJECT_ID}/resources/goblin`);
    expect(lk.authorizedRequests).toContain(`${API_KEY} GET /api/v3/projects/${PROJECT_ID}/resources/goblin`);
    expect(lk.authorizedRequests.filter((r) => r.startsWith(API_KEY)).every((r) => !r.includes(OTHER_PROJECT_ID))).toBe(true);
  });
});

describe("page details", () => {
  it("returns title, images, size and warnings but never asset URLs", async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/pages/goblin?fresh=1`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(lk.assetBase);
    expect(text).not.toContain("/assets/");
    const page = JSON.parse(text);
    expect(page).toMatchObject({ id: "goblin", name: "Goblin Boss", tags: ["monster", "goblinoid"] });
    expect(page.size).toMatchObject({ category: "small", source: "keyValue" });
    expect(page.images.map((i: { label: string }) => i.label)).toEqual([
      "Portrait", "Overview · image 1", "Goblin attacking", "Page image", "Banner",
    ]);
    // The "Broken" document fails upstream: reported, not fatal. The map document is not read.
    expect(page.warnings).toEqual(['The document "Broken" could not be read, so its images and stats are missing.']);
    expect(lk.requests).not.toContain(`GET /api/v3/projects/${PROJECT_ID}/resources/goblin/docs/doc2/blocks`);
  });

  it("includes images from board tabs", async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/pages/ogre?fresh=1`);
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.images.map((i: { source: string; label: string }) => `${i.source}:${i.label}`)).toEqual([
      "block:Ogre", "board:Gallery · image 1", "board:Gallery · image 2", "board:Gallery · image 3",
    ]);
    expect(page.warnings).toEqual([]);
    // A deleted board is not read.
    expect(lk.requests).not.toContain(`GET /api/v3/projects/${PROJECT_ID}/resources/ogre/docs/o3/board`);
  });

  it("maps a LegendKeeper 404 to PAGE_NOT_FOUND", async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/pages/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatchObject({ code: "PAGE_NOT_FOUND", retryable: false });
  });

  it("maps upstream outages to a retryable error rather than an empty page", async () => {
    lk.failNext(`/api/v3/projects/${PROJECT_ID}/resources/village`, 503, "INTERNAL", 3);
    const res = await api(`/api/projects/${PROJECT_ID}/pages/village?fresh=1`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
  });

  it("explains key problems such as a lapsed plan", async () => {
    lk.failNext(`/api/v3/projects/${PROJECT_ID}/resources/dragon`, 402, "PAID_PLAN_REQUIRED", 1);
    const res = await api(`/api/projects/${PROJECT_ID}/pages/dragon?fresh=1`);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("UPSTREAM_AUTH");
    expect(body.error.message).toMatch(/paid plan/);
  });

  it("passes LegendKeeper rate limits through with Retry-After", async () => {
    lk.failNext(`/api/v3/projects/${PROJECT_ID}/resources/dragon`, 429, "RATE_LIMITED", 1, { "retry-after": "90" });
    const res = await api(`/api/projects/${PROJECT_ID}/pages/dragon?fresh=1`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    expect((await res.json()).error).toMatchObject({ code: "RATE_LIMITED", retryable: true, retryAfter: 90 });
  });

  it("returns the page's content to read, with safe links, mentions, secrets and image ids", async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/pages/goblin/content?fresh=1`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(lk.assetBase);
    expect(text).not.toContain("javascript:");
    const content = JSON.parse(text);
    expect(content).toMatchObject({ id: "goblin", name: "Goblin Boss", aliases: ["Boss"], otherDocuments: ["Lair map"] });
    expect(content.sidebar[1]).toMatchObject({ kind: "box", title: "Stats" });
    expect(content.sidebar[1].children[0]).toMatchObject({ kind: "keyValue", rows: [{ key: "Type", runs: [{ text: "Humanoid" }] }, { key: "Size" }] });
    const overview = content.documents.find((d: { name: string }) => d.name === "Overview");
    expect(overview.blocks[0]).toEqual({ kind: "heading", level: 1, runs: [{ text: "Goblin Boss" }] });
    const list = overview.blocks.find((b: { kind: string }) => b.kind === "list");
    expect(list.items[0][0].runs).toEqual([
      { text: "Serves ", bold: true },
      { text: "Ancient Red Dragon", mention: "dragon" },
      { text: " (see " },
      { text: "wiki", link: "https://example.com/wiki" },
      { text: ")" },
    ]);
    expect(overview.blocks.at(-1)).toMatchObject({ kind: "box", tone: "secret", children: [{ kind: "paragraph" }] });
    const details = await (await api(`/api/projects/${PROJECT_ID}/pages/goblin`)).json();
    const imageIds = details.images.map((i: { id: string }) => i.id);
    const contentImage = overview.blocks.find((b: { kind: string }) => b.kind === "image");
    expect(imageIds).toContain(contentImage.imageId);
    expect(content.documents.find((d: { name: string }) => d.name === "Broken")).toMatchObject({ failed: true, blocks: [] });
  });

  it("rejects malformed ids", async () => {
    const res = await api(`/api/projects/${PROJECT_ID}/pages/${encodeURIComponent("../etc")}`);
    expect(res.status).toBe(400);
  });
});

describe("image proxy", () => {
  it("serves an image that belongs to the page, sniffed from its bytes", async () => {
    const page = await (await api(`/api/projects/${PROJECT_ID}/pages/dragon`)).json();
    const res = await api(`/api/projects/${PROJECT_ID}/pages/dragon/images/${page.images[0].id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png"); // served as .jpg upstream, sniffed as PNG
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
  });

  it("refuses image ids that are not on the page, even if they exist elsewhere", async () => {
    const goblinImage = await imageIdFor(`${lk.assetBase}/assets/goblin-portrait.png`);
    const res = await api(`/api/projects/${PROJECT_ID}/pages/dragon/images/${goblinImage}`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("IMAGE_NOT_FOUND");
  });

  it("reports images the asset host cannot serve", async () => {
    const page = await (await api(`/api/projects/${PROJECT_ID}/pages/missingimg`)).json();
    const res = await api(`/api/projects/${PROJECT_ID}/pages/missingimg/images/${page.images[0].id}`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "IMAGE_UNAVAILABLE", retryable: false });
  });
});

describe("token hosting", () => {
  it("stores a PNG once, serves it publicly with CORS, and deletes it", async () => {
    const png = makePng(256, 256);
    const first = await api("/api/tokens", { method: "POST", body: png, headers: { "Content-Type": "image/png" } });
    expect(first.status).toBe(201);
    const stored = await first.json();
    expect(stored).toMatchObject({ width: 256, height: 256, mime: "image/png", created: true });
    expect(stored.url).toBe(`https://tokens.example/t/${stored.hash}.png`);

    const again = await api("/api/tokens", { method: "POST", body: png });
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);

    const pub = await fetch(`${base}/t/${stored.hash}.png`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("access-control-allow-origin")).toBe("*");
    expect(pub.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await pub.arrayBuffer()).equals(png)).toBe(true);

    const del = await api(`/api/tokens/${stored.hash}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await fetch(`${base}/t/${stored.hash}.png`)).status).toBe(404);
    if (runtime === "node") expect((await readdir(tokenDir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects non-images, oversized images and anonymous uploads", async () => {
    const notImage = await api("/api/tokens", { method: "POST", body: "<svg/>" });
    expect(notImage.status).toBe(415);
    const huge = await api("/api/tokens", { method: "POST", body: makePng(3000, 10) });
    expect(huge.status).toBe(400);
    const anon = await fetch(`${base}/api/tokens`, { method: "POST", body: makePng(64, 64) });
    expect(anon.status).toBe(401);
    const wrong = await api("/api/tokens", { method: "POST", body: makePng(64, 64) }, "nope");
    expect(wrong.status).toBe(401);
  });

  it("only serves well-formed token file names", async () => {
    expect((await fetch(`${base}/t/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await fetch(`${base}/t/abc.png`)).status).toBe(404);
  });

  it("reports when hosting is off", async () => {
    await stop();
    await start({ hosting: false });
    const res = await api("/api/tokens", { method: "POST", body: makePng(64, 64) });
    expect(res.status).toBe(404);
    expect((await (await fetch(`${base}/api/health`)).json()).tokenHosting).toBe(false);
    await stop();
    await start();
  });
});

/** Builds a stored page list step by step, as the extension and the deploy do. */
async function build(projectId: string, audience: "gm" | "public", buildId = `b${Math.random().toString(36).slice(2, 10)}`) {
  let cursor = "";
  let steps = 0;
  for (let part = 0; ; part++) {
    const res = await api(`/api/projects/${projectId}/page-list/build`, {
      method: "POST",
      body: JSON.stringify({ audience, buildId, part, cursor }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const step = await res.json();
    steps++;
    if (step.done) return { steps, ...step };
    cursor = step.nextCursor;
  }
}

async function stored(path: string, password: string | null = PASSWORD): Promise<StoredPageList> {
  const res = password ? await api(path, {}, password) : await fetch(base + path);
  expect(res.status).toBe(200);
  return res.json();
}

describe("page lists", () => {
  it("has no list before the first build", async () => {
    await stop();
    await start(); // a fresh server (and, for the worker, an empty KV namespace)
    const res = await api(`/api/projects/${PROJECT_ID}/page-list`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("PAGE_LIST_NOT_BUILT");
    const pub = await fetch(`${base}/api/public/projects/${PROJECT_ID}/page-list`);
    expect(pub.status).toBe(404);
    expect((await pub.json()).error.message).toMatch(/Refresh page list/);
  });

  it("builds the GM's list in steps, following LegendKeeper's cursor, and stores it for everyone", async () => {
    const result = await build(PROJECT_ID, "gm");
    if (runtime === "node") expect(result.steps).toBeGreaterThan(1); // two LegendKeeper calls per step here
    lk.requests.length = 0;
    const list = await stored(`/api/projects/${PROJECT_ID}/page-list`);
    expect(lk.requests).toEqual([]); // served from storage
    expect(list).toMatchObject({ project: { id: PROJECT_ID, name: "The Test Realm", isPublic: false }, audience: "gm", truncated: false });
    expect(list.resources).toHaveLength(result.total);
    const pages = buildPageList(list.project, list.resources, "gm");
    const byId = Object.fromEntries(pages.pages.map((p) => [p.id, p]));
    expect(byId.goblin).toEqual({ id: "goblin", name: "Goblin Boss", aliases: ["Boss"], tags: ["monster", "goblinoid"], path: ["Bestiary"], hidden: false, iconColor: null });
    expect(byId.villain).toMatchObject({ path: ["The Cabal"], hidden: true, aliases: ["The Hollow Queen"] });
    expect(byId.tpl).toBeUndefined(); // templates are not pages
    // Another password reads the same stored list.
    expect((await stored(`/api/projects/${PROJECT_ID}/page-list`, OTHER_PASSWORD)).generatedAt).toBe(list.generatedAt);
  });

  it("answers 204 when the browser already has the current list", async () => {
    const { generatedAt } = await stored(`/api/projects/${PROJECT_ID}/page-list`);
    const same = await api(`/api/projects/${PROJECT_ID}/page-list?since=${encodeURIComponent(generatedAt)}`);
    expect(same.status).toBe(204);
    const older = await api(`/api/projects/${PROJECT_ID}/page-list?since=2000-01-01T00:00:00.000Z`);
    expect(older.status).toBe(200);
  });

  it("keeps the old list until a rebuild finishes", async () => {
    const before = await stored(`/api/projects/${PROJECT_ID}/page-list`);
    const first = await api(`/api/projects/${PROJECT_ID}/page-list/build`, {
      method: "POST",
      body: JSON.stringify({ audience: "gm", buildId: "halfway", part: 0, cursor: "" }),
    });
    expect(first.status).toBe(200);
    // The Worker here lists the whole mock project in one step; the Node server needs several.
    if (!(await first.json()).done) {
      expect((await stored(`/api/projects/${PROJECT_ID}/page-list`)).generatedAt).toBe(before.generatedAt);
    }
    await new Promise((r) => setTimeout(r, 5));
    await build(PROJECT_ID, "gm");
    expect((await stored(`/api/projects/${PROJECT_ID}/page-list`)).generatedAt).not.toBe(before.generatedAt);
  });

  it("requires the password to read the GM list or build, and checks build steps", async () => {
    expect((await fetch(`${base}/api/projects/${PROJECT_ID}/page-list`)).status).toBe(401);
    expect((await fetch(`${base}/api/projects/${PROJECT_ID}/page-list/build`, { method: "POST", body: "{}" })).status).toBe(401);
    const post = (body: unknown) => api(`/api/projects/${PROJECT_ID}/page-list/build`, { method: "POST", body: JSON.stringify(body) });
    expect((await post({ audience: "everyone", buildId: "abcdef", part: 0, cursor: "" })).status).toBe(400);
    expect((await post({ audience: "gm", buildId: "x", part: 0, cursor: "" })).status).toBe(400);
    expect((await post({ audience: "gm", buildId: "abcdef", part: 1, cursor: "" })).status).toBe(400);
    expect((await post({ audience: "gm", buildId: "abcdef", part: 0, cursor: "x".repeat(3000) })).status).toBe(400);
    expect((await api(`/api/projects/${PROJECT_ID}/page-list/build`, { method: "POST", body: "not json" })).status).toBe(400);
    // A later step whose earlier parts were never stored can't finish.
    const orphan = await post({ audience: "gm", buildId: "orphan1", part: 3, cursor: "zzz" });
    expect(orphan.status).toBe(409);
  });

  it("stores an empty public list for a private project, read without any password", async () => {
    await build(PROJECT_ID, "public");
    const list = await stored(`/api/public/projects/${PROJECT_ID}/page-list`, null);
    expect(list.project.isPublic).toBe(false);
    expect(list.resources).toEqual([]);
  });

  it("lists a public project's public pages keylessly, so hidden ones never appear", async () => {
    lk.setPublic(true);
    try {
      lk.requests.length = 0;
      lk.authorizedRequests.length = 0;
      await build(PROJECT_ID, "public");
      // Every listing call for the public list went out without a key.
      expect(lk.requests.filter((r) => r.endsWith("/resources")).length).toBeGreaterThan(0);
      expect(lk.authorizedRequests.filter((r) => r.endsWith(`${PROJECT_ID}/resources`))).toEqual([]);
      const list = await stored(`/api/public/projects/${PROJECT_ID}/page-list`, null);
      expect(list.project.isPublic).toBe(true);
      const pages = buildPageList(list.project, list.resources, "public");
      const ids = pages.pages.map((p) => p.id);
      expect(ids).toContain("goblin");
      expect(ids).not.toContain("cabal");
      expect(ids).not.toContain("villain");
      expect(pages.pages.every((p) => !p.hidden)).toBe(true);
    } finally {
      lk.setPublic(false);
    }
  });

  it("serves no public list for projects it holds no key for", async () => {
    const res = await fetch(`${base}/api/public/projects/proj_unknown/page-list`);
    expect(res.status).toBe(404);
    expect((await fetch(`${base}/api/public/projects/bad%20id/page-list`)).status).toBe(400);
    const buildOther = await api(`/api/projects/proj_unknown/page-list/build`, {
      method: "POST",
      body: JSON.stringify({ audience: "public", buildId: "abcdef", part: 0, cursor: "" }),
    });
    expect(buildOther.status).toBe(404);
  });
});

describe("players' pages", () => {
  let pass = "";
  const player = (path: string, token = pass) => fetch(base + path, { headers: { Authorization: `Bearer ${token}`, Origin: "https://ext.example" } });

  beforeAll(async () => {
    lk.setPublic(true);
    await build(PROJECT_ID, "public");
    const res = await api("/api/player-pass", { method: "POST", body: JSON.stringify({ projectId: PROJECT_ID }) });
    expect(res.status).toBe(200);
    ({ pass } = await res.json());
  });

  afterAll(() => lk.setPublic(false));

  it("issues passes only to the GM, for projects the server has a key for", async () => {
    expect((await fetch(`${base}/api/player-pass`, { method: "POST", body: JSON.stringify({ projectId: PROJECT_ID }) })).status).toBe(401);
    const unknown = await api("/api/player-pass", { method: "POST", body: JSON.stringify({ projectId: "proj_nobody" }) });
    expect(unknown.status).toBe(404);
    expect(pass).toMatch(/^pp1\./);
  });

  it("serves a public page and its images to a pass", async () => {
    const res = await player(`/api/player/projects/${PROJECT_ID}/pages/goblin`);
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page).toMatchObject({ id: "goblin", name: "Goblin Boss" });
    expect(page.images.length).toBeGreaterThan(2);
    const image = await player(`/api/player/projects/${PROJECT_ID}/pages/goblin/images/${page.images[0].id}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
  });

  it("leaves out secret blocks, hidden tabs and hidden sidebar fields", async () => {
    const gmDragon = await (await api(`/api/projects/${PROJECT_ID}/pages/dragon?fresh=1`)).json();
    expect(gmDragon.images.map((i: { label: string }) => i.label)).toEqual(expect.arrayContaining(["Red dragon art", "Lair plan"]));
    const dragon = await (await player(`/api/player/projects/${PROJECT_ID}/pages/dragon`)).json();
    expect(dragon.images).toEqual([]);
    expect(dragon.documents.map((d: { name: string }) => d.name)).toEqual(["Statblock"]);
    // The GM's image ids don't open anything for a player.
    const secret = await player(`/api/player/projects/${PROJECT_ID}/pages/dragon/images/${gmDragon.images[0].id}`);
    expect(secret.status).toBe(404);
    const village = await (await player(`/api/player/projects/${PROJECT_ID}/pages/village`)).json();
    expect(village.images).toEqual([]);
  });

  it("refuses pages that aren't public", async () => {
    const res = await player(`/api/player/projects/${PROJECT_ID}/pages/villain`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toMatch(/isn't public/);
  });

  it("refuses forged, missing or misplaced credentials", async () => {
    const forged = pass.slice(0, -4) + (pass.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect((await player(`/api/player/projects/${PROJECT_ID}/pages/goblin`, forged)).status).toBe(401);
    expect((await player(`/api/player/projects/${PROJECT_ID}/pages/goblin`, PASSWORD)).status).toBe(401);
    expect((await fetch(`${base}/api/player/projects/${PROJECT_ID}/pages/goblin`)).status).toBe(401);
    // A pass opens nothing of the GM's.
    expect((await player(`/api/projects/${PROJECT_ID}/pages/goblin`)).status).toBe(401);
    expect((await player(`/api/projects`)).status).toBe(401);
    // Nor another project.
    expect((await player(`/api/player/projects/${OTHER_PROJECT_ID}/pages/goblin`)).status).toBe(401);
  });
});

describe("secrets", () => {
  it("never echoes the LegendKeeper key in any response", async () => {
    const responses = await Promise.all([
      api("/api/projects"),
      api("/api/projects", {}, "wrong"),
      api(`/api/projects/${PROJECT_ID}/page-list`),
      api(`/api/projects/${PROJECT_ID}/search?q=goblin`),
      api(`/api/projects/${PROJECT_ID}/pages/goblin`),
      api(`/api/projects/${PROJECT_ID}/pages/nope`),
    ]);
    for (const res of responses) expect(await res.text()).not.toContain(API_KEY);
  });
});

describe("rate limiting", () => {
  it("limits requests per password", async () => {
    await stop();
    rateLimit = 3;
    await start();
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await api("/api/projects")).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect((await api("/api/projects", {}, OTHER_PASSWORD)).status).toBe(200);
    await stop();
    rateLimit = 1000;
    await start();
  });
});

if (which === "worker") {
  describe("worker routing", () => {
    it("serves the extension's static files for non-API paths", async () => {
      const res = await fetch(`${base}/manifest.json`);
      expect(await res.text()).toContain("static");
    });
  });
}
});
