// Runs the deploy helpers against a mock of the Cloudflare REST API.

import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../server/src/core/config.js";
import { createHandler } from "../server/src/core/handler.js";
import { LkClient } from "../server/src/core/lk/client.js";
import { MemoryPageListStore } from "../server/src/core/pageListStore.js";
import { PageService, ProjectResolver } from "../server/src/core/services.js";
import { toNodeListener } from "../server/src/node/adapter.js";
import { safeFetch } from "../server/src/node/safeFetch.js";
import { API_KEY, PROJECT_ID, startMockLk, type MockLk } from "../server/test/mockLk.js";

const exec = promisify(execFile);
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");

let server: http.Server;
let api = "";
const state = { subdomain: "gm-realm" as string | null, namespaces: [] as { id: string; title: string }[], creates: 0, authOk: true };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!state.authOk) return send(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
    const url = new URL(req.url!, "http://x");
    if (url.pathname === "/accounts/acct/workers/subdomain") {
      return state.subdomain
        ? send(200, { success: true, result: { subdomain: state.subdomain } })
        : send(404, { success: false, errors: [{ code: 10007, message: "This account does not have a subdomain" }] });
    }
    if (url.pathname === "/accounts/acct/storage/kv/namespaces" && req.method === "GET") {
      return send(200, { success: true, result: state.namespaces });
    }
    if (url.pathname === "/accounts/acct/storage/kv/namespaces" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        state.creates++;
        const ns = { id: `ns${state.creates}`.padEnd(32, "0"), title: JSON.parse(body).title };
        state.namespaces.push(ns);
        send(200, { success: true, result: ns });
      });
      return;
    }
    send(404, { success: false, errors: [{ code: 7003, message: "No route" }] });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function workspace() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lkob-deploy-"));
  copyFileSync(path.join(root, "wrangler.jsonc"), path.join(dir, "wrangler.jsonc"));
  return dir;
}

async function prepare(dir: string, env: Record<string, string> = {}) {
  const output = path.join(dir, "gh-output");
  writeFileSync(output, "");
  try {
    const r = await exec("node", [path.join(here, "prepare.mjs")], {
      cwd: dir,
      env: { ...process.env, CF_API_BASE: api, CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acct", GITHUB_OUTPUT: output, ...env },
    });
    return { code: 0, out: r.stdout + r.stderr, ghOutput: readFileSync(output, "utf8") };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr, ghOutput: "" };
  }
}

describe("deploy/prepare.mjs", () => {
  it("creates the token namespace once and reuses it on the next deploy", async () => {
    const first = workspace();
    const r1 = await prepare(first);
    expect(r1.code).toBe(0);
    expect(r1.ghOutput).toContain("subdomain=gm-realm");
    const id = state.namespaces[0].id;
    expect(readFileSync(path.join(first, "wrangler.jsonc"), "utf8")).toContain(`"id": "${id}"`);

    const second = workspace();
    const r2 = await prepare(second);
    expect(r2.code).toBe(0);
    expect(state.creates).toBe(1); // redeploys keep the same storage, so hosted tokens survive
    expect(readFileSync(path.join(second, "wrangler.jsonc"), "utf8")).toContain(`"id": "${id}"`);
  });

  it("explains a missing workers.dev subdomain", async () => {
    state.subdomain = null;
    const r = await prepare(workspace());
    state.subdomain = "gm-realm";
    expect(r.code).toBe(1);
    expect(r.out).toContain("Workers & Pages");
  });

  it("explains a bad API token", async () => {
    state.authOk = false;
    const r = await prepare(workspace());
    state.authOk = true;
    expect(r.code).toBe(1);
    expect(r.out).toContain("Edit Cloudflare Workers");
  });

  it("requires the Cloudflare secrets", async () => {
    const r = await prepare(workspace(), { CLOUDFLARE_API_TOKEN: "" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("CLOUDFLARE_API_TOKEN");
  });
});

describe("deploy/secrets.mjs", () => {
  async function secrets(env: Record<string, string>) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lkob-secrets-"));
    const file = path.join(dir, "s.json");
    try {
      const r = await exec("node", [path.join(here, "secrets.mjs"), file], { env: { ...process.env, ...env } });
      return { code: 0, out: r.stdout + r.stderr, json: JSON.parse(readFileSync(file, "utf8")) };
    } catch (err) {
      const e = err as { code: number; stdout: string; stderr: string };
      return { code: e.code, out: e.stdout + e.stderr, json: null };
    }
  }

  it("writes the bulk-secrets file without printing values", async () => {
    const r = await secrets({ LK_API_KEYS: "lk_secret_value", LKOB_ACCESS_TOKENS: "a-long-access-token-0123456789" });
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ LK_API_KEYS: "lk_secret_value", LKOB_ACCESS_TOKENS: "a-long-access-token-0123456789" });
    expect(r.out).not.toContain("lk_secret_value");
  });

  it("accepts the Page Link extension's singular LK_API_KEY secret", async () => {
    const r = await secrets({ LK_API_KEYS: "", LK_API_KEY: "lk_single", LKOB_ACCESS_TOKENS: "a-long-access-token-0123456789" });
    expect(r.code).toBe(0);
    expect(r.json.LK_API_KEYS).toBe("lk_single");
  });

  it("rejects a missing key or password", async () => {
    expect((await secrets({ LK_API_KEYS: "", LK_API_KEY: "", LKOB_ACCESS_TOKENS: "a-long-access-token-0123456789" })).code).toBe(1);
    const noPassword = await secrets({ LK_API_KEYS: "k", LKOB_ACCESS_TOKENS: " " });
    expect(noPassword.code).toBe(1);
    expect(noPassword.out).toContain("LKOB_ACCESS_TOKENS");
  });

  it("accepts a short password", async () => {
    const r = await secrets({ LK_API_KEYS: "k", LKOB_ACCESS_TOKENS: "goblin" });
    expect(r.code).toBe(0);
    expect(r.json.LKOB_ACCESS_TOKENS).toBe("goblin");
  });
});

describe("deploy/page-list.mjs", () => {
  let lk: MockLk;
  let worker: http.Server;
  let url = "";
  let pageLists: MemoryPageListStore;

  beforeAll(async () => {
    lk = await startMockLk();
    const config = loadConfig({ LK_BASE_URL: lk.baseUrl, LK_API_KEYS: API_KEY, LKOB_ACCESS_TOKENS: "pw1, pw2", LKOB_TOKEN_HOSTING: "off" });
    const projects = new ProjectResolver();
    pageLists = new MemoryPageListStore();
    const pages = new PageService(projects, {
      lkBaseUrl: lk.baseUrl,
      pageLists,
      listRequestsPerChunk: 2,
      maxSourceImageBytes: config.maxSourceImageBytes,
      assetHostAllowlist: null,
      allowInsecureAssetFetch: true,
      fetchImage: safeFetch,
    });
    const makeClient = (apiKey: string) => new LkClient({ baseUrl: lk.baseUrl, apiKey, sleep: async () => {} });
    worker = http.createServer(toNodeListener(createHandler({ config, projects, pages, tokens: null, makeClient, log: () => {} })));
    await new Promise<void>((r) => worker.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(worker.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => worker.close(() => r()));
    await lk.close();
  });

  async function warm(env: Record<string, string>) {
    const r = await exec("node", [path.join(here, "page-list.mjs")], { env: { ...process.env, ...env } });
    return r.stdout + r.stderr;
  }

  it("builds both stored lists for every project, with the first password, printing neither secret", async () => {
    const out = await warm({ WORKER_URL: url, LKOB_ACCESS_TOKENS: "pw1, pw2" });
    expect(out).toMatch(/The Test Realm: \d+ pages for the GM, 0 public\./);
    expect(out).not.toContain("pw1");
    expect(JSON.parse((await pageLists.get(`page-list/gm/${PROJECT_ID}`))!).resources.length).toBeGreaterThan(5);
    expect(await pageLists.get(`page-list/public/${PROJECT_ID}`)).not.toBeNull();
  });

  it("warns instead of failing the deploy", async () => {
    const out = await warm({ WORKER_URL: url, LKOB_ACCESS_TOKENS: "wrong" });
    expect(out).toContain("::warning::Page lists not built: The server didn't accept that access password.");
  });
});
