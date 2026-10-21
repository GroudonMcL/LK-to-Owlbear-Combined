// End-to-end test of the deployable artefact (importer, page links, scene-text
// links, players):
//   production extension bundle + real @owlbear-rodeo/sdk
//   served by the real Cloudflare Workers runtime (wrangler dev / workerd)
//   inside an Owlbear host emulator on another origin,
//   against a mock LegendKeeper built from the v3 OpenAPI spec.
//
// Usage: npm run build:cloudflare && npm run e2e
// Env:   CHROMIUM_PATH (optional), E2E_OUT (screenshot dir, default e2e/output)

import { spawn } from "node:child_process";
import { createReadStream, mkdirSync, mkdtempSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.E2E_OUT ?? path.join(root, "e2e/output");
mkdirSync(OUT, { recursive: true });
const WORKER = "http://127.0.0.1:8787";
const HOST = "http://127.0.0.1:4800";
const NS = "io.github.groudonmcl.lk-to-owlbear";
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const API_KEY = "lk_test_key_do_not_leak_0123456789";
const PASSWORD = "goblin";
const children = [];
const failures = [];
let passed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}

function run(cmd, args, env = {}) {
  // Own process group, so cleanup also stops what npx starts (wrangler, workerd).
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  children.push({ child, log: () => log });
  return child;
}

async function waitFor(url, timeoutMs = 90_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function serveHost() {
  const dir = path.join(root, "e2e/host");
  const server = http.createServer((req, res) => {
    const file = path.join(dir, new URL(req.url, HOST).pathname === "/" ? "index.html" : new URL(req.url, HOST).pathname);
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    try {
      statSync(file);
    } catch {
      return res.writeHead(404).end();
    }
    res.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/html" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(4800, "127.0.0.1", () => resolve(server)));
}

async function main() {
  run("npx", ["tsx", "server/test/mockLkServer.ts"], { MOCK_LK_PORT: "8790", MOCK_LK_PUBLIC: "1" });
  // The LegendKeeper key and the access password, as the deploy stores them in the Worker.
  const vars = {
    LK_BASE_URL: "http://127.0.0.1:8790",
    LK_API_KEYS: API_KEY,
    LKOB_ACCESS_TOKENS: PASSWORD,
    LKOB_INSECURE_ASSET_FETCH: "1",
  };
  const varArgs = Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]);
  // A fresh local KV namespace, so the page list starts unbuilt.
  const kvState = mkdtempSync(path.join(os.tmpdir(), "lkob-e2e-kv-"));
  run("npx", ["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1", "--persist-to", kvState, ...varArgs], {
    // Local test servers must not go through any outbound proxy.
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  });
  const hostServer = await serveHost();
  await waitFor("http://127.0.0.1:8790/assets/none");
  await waitFor(`${WORKER}/api/health`);
  console.log("Stack up: mock LegendKeeper :8790, Worker (workerd) :8787, Owlbear host :4800\n");

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  // A stand-in for LegendKeeper's public view: a single-page app that pushes history entries.
  await context.route("https://www.legendkeeper.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body style="margin:0;font:14px sans-serif;background:#16181d;color:#eee">
        <header style="height:44px;background:#202329"></header><h1 id="t"></h1><a id="next" href="#">Next page</a>
        <script>
          const render = () => (document.getElementById("t").textContent = location.pathname);
          document.getElementById("next").onclick = (e) => {
            e.preventDefault();
            const n = Number((/page(\\d+)/.exec(location.pathname) || [0, 0])[1]) + 1;
            history.pushState({}, "", location.pathname.replace(/[^/]+\\/$/, "page" + n + "/"));
            render();
          };
          addEventListener("popstate", render);
          render();
        </script>`,
    }),
  );
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const host = (fn, arg) => page.evaluate(fn, arg);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  await page.goto(`${HOST}/?ext=${encodeURIComponent(WORKER)}`);
  await page.evaluate((ns) => (window.NS = ns), NS); // for checks that run inside the host page

  console.log("Manifest and loading");
  const manifest = await host(() => window.host.manifest());
  check("manifest is fetchable cross-origin (CORS)", manifest.status === 200 && manifest.cors, JSON.stringify(manifest.error ?? ""));
  check("manifest declares popover and background", manifest.body.action?.popover === "/index.html" && manifest.body.background_url === "/background.html");
  // Owlbear appends manifest paths to the origin as text, so each must start with "/".
  for (const p of [manifest.body.icon, manifest.body.action?.icon, manifest.body.action?.popover, manifest.body.background_url]) {
    const url = await host((path) => window.host.manifestUrl(path), p);
    const res = await fetch(url).catch((err) => ({ status: String(err) }));
    check(`manifest path ${p} resolves the way Owlbear resolves it`, res.status === 200, `${url} → ${res.status}`);
  }
  await host(() => window.host.boot());
  const pop = page.frameLocator("#popover");

  console.log("Connect, project, search, page, images");
  await pop.getByLabel("Access password").waitFor();
  check("server URL is implicit (same-origin build)", (await pop.getByLabel("Server URL").isVisible()) === false);
  await pop.getByLabel("Access password").fill("not-the-password");
  await pop.getByRole("button", { name: "Connect" }).click();
  await pop.getByText("Connection failed").waitFor();
  check("a wrong password is reported", (await pop.getByText("didn't accept that access password").count()) === 1);
  await pop.getByLabel("Access password").fill(PASSWORD);
  await pop.getByRole("button", { name: "Connect" }).click();
  await pop.getByRole("main").getByText("The Test Realm", { exact: true }).waitFor();
  check("the server key's project is selected automatically", true);
  const extOrigin = () => page.frames().find((f) => f.url().startsWith(WORKER));
  const saved = await extOrigin().evaluate(() => JSON.parse(localStorage.getItem("lkob.settings.v1") ?? "{}"));
  check("only the password is kept in this browser's storage", saved.accessToken === PASSWORD && !("apiKey" in saved));
  await pop.getByText("The Test Realm: 8 pages, updated just now").waitFor();
  check("with no list on the server yet, connecting builds it and says so", true);
  await pop.getByRole("button", { name: "Refresh page list" }).click();
  await pop.getByText("The Test Realm: 8 pages, updated just now").waitFor();
  check("then how many pages it has and when it was updated", true);
  const storedList = await fetch(`${WORKER}/api/public/projects/proj_test01/page-list`);
  check("the server keeps the public list for players", storedList.status === 200);
  await shot("01-settings-connected");
  await pop.getByRole("button", { name: "Done" }).click();
  await pop.getByLabel("Search LegendKeeper pages").fill("goblin");
  await pop.locator(".result", { hasText: "Goblin Boss" }).click();
  await pop.getByText("Choose artwork").waitFor();
  await pop.locator(".image-card img").first().waitFor();
  const captions = await pop.locator(".image-card .caption").allInnerTexts();
  check("page images listed", captions.length === 5, captions.join(","));
  check("detected size shown", (await pop.locator(".badge.accent").innerText()).includes("Small"));
  await page.waitForTimeout(400);
  await shot("02-page-images");

  console.log("Similar Owlbear tokens");
  await host((ns) => window.host.addItem({
    id: "hand-placed", type: "IMAGE", name: "goblin_boss.png", layer: "CHARACTER", visible: true, locked: false, metadata: {},
    position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
    image: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", width: 100, height: 100, mime: "image/png" },
    grid: { dpi: 100, offset: { x: 50, y: 50 } }, text: { type: "PLAIN", plainText: "", richText: [], style: {} },
  }), NS);
  await pop.getByText("Owlbear token named like this page is in this scene.").waitFor();
  check("an unlinked token named like the page is flagged", (await pop.locator(".token-row").filter({ hasText: "goblin_boss.png" }).count()) === 1);
  check("a similar token doesn't block importing", await pop.getByText("Choose artwork").isVisible());
  await shot("02b-similar-token");
  await pop.getByRole("button", { name: "Use existing" }).click();
  await page.waitForFunction((ns) => window.host.state.items.find((i) => i.id === "hand-placed")?.metadata[`${ns}/link`]?.resourceId === "goblin", NS, { timeout: 5000 });
  check("Use existing links the similar token to the page and selects it", (await host(() => window.host.state.selection)).includes("hand-placed"));
  await pop.getByText("token for this page already exists.").waitFor();
  check("the adopted token now shows as linked", (await pop.getByText("named like this page").count()) === 0);
  await host(() => window.host.deleteItems(["hand-placed"]));
  await pop.getByRole("button", { name: "Edit token" }).waitFor();

  console.log("Editor, export, linked token with size");
  await pop.locator(".image-card").nth(1).click();
  await pop.getByRole("button", { name: "Edit token" }).click();
  const modal = page.frameLocator('iframe[data-modal$="/editor"]');
  await modal.locator(".token-layer").waitFor();
  await modal.getByText("Loading artwork").waitFor({ state: "detached" });
  check("Forged steel and Ember gold frames offered", (await modal.getByRole("button", { name: "Forged steel" }).count()) === 1 && (await modal.getByRole("button", { name: "Ember gold" }).count()) === 1);
  await modal.getByRole("button", { name: "Arcane" }).click();
  await modal.getByRole("button", { name: "Large", exact: true }).click();
  await page.waitForTimeout(400);
  await shot("03-editor");
  await modal.getByRole("button", { name: "Create token" }).dblclick();
  await page.waitForFunction(() => window.host.state.items.length > 0 && !document.querySelector("iframe.modal"), null, { timeout: 15_000 });
  let state = await host(() => window.host.state);
  const item = state.items[0];
  const link = item.metadata["io.github.groudonmcl.lk-to-owlbear/link"];
  check("exactly one token after a double-click", state.items.length === 1, String(state.items.length));
  check("token named after the page", item.name === "Goblin Boss");
  check(
    "token labelled with its name in serif, size 18",
    item.textItemType === "LABEL" && item.text?.plainText === "Goblin Boss" && item.text.style?.fontFamily === "serif" && item.text.style?.fontSize === 18,
    JSON.stringify({ type: item.textItemType, text: item.text }),
  );
  check("token on the CHARACTER layer", item.layer === "CHARACTER");
  check("Large footprint: grid.dpi = width / 2", item.grid.dpi === item.image.width / 2, `${item.grid.dpi} vs ${item.image.width}`);
  check("anchor at the image centre", item.grid.offset.x === item.image.width / 2 && item.grid.offset.y === item.image.height / 2);
  check("link metadata stored", link?.v === 1 && link.projectId === "proj_test01" && link.resourceId === "goblin" && link.title === "Goblin Boss");
  check("token image hosted by the Worker", item.image.url.startsWith(`${WORKER}/t/`) && item.image.mime === "image/png");
  // Viewport centre (600, 400) maps to scene (1000, 700); an even 2×2 footprint snaps to the nearest grid corner.
  check("placed at the snapped viewport centre", item.position.x === 1050 && item.position.y === 750, JSON.stringify(item.position));
  check("new token selected and framed", state.selection.includes(item.id) && state.animatedTo !== null);
  check("success notification", state.notifications.some((n) => n.variant === "SUCCESS" && n.message.includes("Goblin Boss")));
  await page.waitForTimeout(1500);
  check("token image loads cross-origin into a canvas (CORS)", await host(() => window.host.mapReadable()));

  console.log("Duplicate detection and persistent links");
  await pop.getByText("A linked token for this page already exists.").waitFor();
  check("re-opening the page detects the linked token", true);
  await page.waitForTimeout(2500); // background index sync is debounced
  state = await host(() => window.host.state);
  const index = state.roomMeta["io.github.groudonmcl.lk-to-owlbear/index"];
  const sceneKey = state.sceneMeta["io.github.groudonmcl.lk-to-owlbear/scene"]?.id;
  check("background recorded the token in the room index", Boolean(sceneKey && index?.entries?.["proj_test01:goblin"]?.s?.includes(sceneKey)), JSON.stringify(index));
  check("room metadata within 16 kB", new TextEncoder().encode(JSON.stringify(state.roomMeta)).length < 16384);
  await shot("04-existing-token");
  await pop.getByRole("button", { name: "Use existing" }).click();
  await page.waitForTimeout(300);
  check("'Use existing' selects the token", (await host(() => window.host.state.selection)).includes(item.id));

  const menus = await host((id) => window.host.contextMenusFor([id]), item.id);
  check("context menu offered on a linked token", menus.some((m) => m.label === "LK Token Art"), JSON.stringify(menus));
  await pop.getByLabel("Back to search").click();
  await host((id) => window.host.clickContextMenu("io.github.groudonmcl.lk-to-owlbear/import", [id]), item.id);
  await pop.getByText("A linked token for this page already exists.").waitFor();
  check("context menu opens the linked page in the importer", (await host(() => window.host.state.actionOpen)) === true);

  await host((id) => window.host.copyItem(id), item.id);
  await pop.getByText("2 linked tokens for this page are in this scene.").waitFor();
  check("an Owlbear copy is reported as a second match", true);
  await host(() => window.host.deleteItems(window.host.state.items.map((i) => i.id)));
  await pop.getByRole("button", { name: "Edit token" }).waitFor();
  check("deleted tokens no longer block importing", true);
  await page.waitForTimeout(2500);
  state = await host(() => window.host.state);
  check("room index forgets deleted tokens", !state.roomMeta["io.github.groudonmcl.lk-to-owlbear/index"]?.entries?.["proj_test01:goblin"]);

  console.log("Placement: click to place, and cancel");
  await pop.getByRole("button", { name: "Edit token" }).click();
  await modal.getByText("Loading artwork").waitFor({ state: "detached" });
  await modal.getByText("Output").click();
  await modal.getByRole("button", { name: "Click to place" }).click();
  await modal.getByRole("button", { name: "Create token" }).click();
  await page.waitForFunction(() => window.host.state.activeMode?.endsWith("/place-mode"), null, { timeout: 10_000 });
  check("placement tool activated", true);
  await host(() => window.host.moveTool(320, 260));
  await page.waitForTimeout(500);
  check("ghost preview follows the pointer", (await host(() => window.host.state.localItems.length)) === 1);
  await host(() => window.host.clickTool(320, 260));
  await page.waitForFunction(() => window.host.state.items.length === 1, null, { timeout: 5000 });
  state = await host(() => window.host.state);
  check("token placed at the clicked, snapped square", state.items[0].position.x === 375 && state.items[0].position.y === 225, JSON.stringify(state.items[0].position));
  check("ghost removed and previous tool restored", state.localItems.length === 0 && state.activeTool === "rodeo.owlbear.tool/move");
  await shot("05-placed");

  await host(() => window.host.deleteItems(window.host.state.items.map((i) => i.id)));
  await pop.getByRole("button", { name: "Edit token" }).click();
  await modal.getByText("Loading artwork").waitFor({ state: "detached" });
  await modal.getByRole("button", { name: "Engraved" }).click(); // a different image than before, so it is newly stored
  await modal.getByRole("button", { name: "Create token" }).click();
  try {
    await page.waitForFunction(() => window.host.state.activeMode?.endsWith("/place-mode"), null, { timeout: 10_000 });
  } catch (err) {
    await shot("debug-cancel");
    console.log("DEBUG modal footer:", await modal.locator(".editor-footer").innerText().catch(() => "(no modal)"));
    console.log("DEBUG state:", JSON.stringify(await host(() => ({ mode: window.host.state.activeMode, tool: window.host.state.activeTool, items: window.host.state.items.length, errors: window.host.state.errors, notes: window.host.state.notifications.slice(-3) }))));
    throw err;
  }
  const hostedBefore = await host(() => window.host.state.log.length);
  await host(() => window.host.keyDown("Escape"));
  await page.waitForFunction(() => window.host.state.notifications.some((n) => n.message === "Placement cancelled."), null, { timeout: 5000 });
  state = await host(() => window.host.state);
  check("Escape cancels placement without creating a token", state.items.length === 0 && state.activeTool === "rodeo.owlbear.tool/move" && hostedBefore > 0);
  const placement = state.broadcasts.filter((b) => b.channel.endsWith("/place")).at(-1)?.data;
  check("placement request fits Owlbear's 16 kB broadcast limit", new TextEncoder().encode(JSON.stringify(placement)).length < 16384);
  await page.waitForTimeout(500);
  const orphan = await fetch(placement.item.image.url);
  check("the cancelled token's hosted image is deleted (KV and edge cache)", placement.cleanupHash && orphan.status === 404, `${orphan.status}`);

  console.log("Owlbear storage hosting");
  await pop.getByRole("button", { name: "Edit token" }).click();
  await modal.getByText("Loading artwork").waitFor({ state: "detached" });
  await modal.getByText("Output").click();
  await modal.getByRole("button", { name: "Owlbear storage" }).click();
  check("placement choice hidden for Owlbear storage", (await modal.getByRole("button", { name: "Click to place" }).count()) === 0);
  await modal.getByRole("button", { name: "Create token" }).click();
  await page.waitForFunction(() => window.host.state.uploads.length === 1 && !document.querySelector("iframe.modal"), null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  state = await host(() => window.host.state);
  const upload = state.uploads[0];
  check("only Owlbear's upload dialog opens: no image picker, nothing placed yet", !state.pickerOpened && state.items.length === 0);
  check("upload carried the footprint dpi", upload.grid?.dpi === 512);
  check(
    "upload carries the serif name label",
    upload.textItemType === "LABEL" && upload.text?.plainText === "Goblin Boss" && upload.text.style?.fontFamily === "serif" && upload.text.style?.fontSize === 18,
    JSON.stringify(upload.text),
  );
  check("upload is filed as a character", upload.typeHint === "CHARACTER");
  // The GM drags the saved asset from Owlbear's Assets panel onto the map.
  await host(
    (u) =>
      window.host.addItem({
        id: "from-assets", type: "IMAGE", name: u.name, layer: "CHARACTER", visible: true, locked: false, metadata: {},
        createdUserId: "gm-user", position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
        image: { url: u.url, width: u.width, height: u.height, mime: u.mime }, grid: u.grid, text: u.text, textItemType: u.textItemType,
      }),
    upload,
  );
  await page.waitForFunction((ns) => Boolean(window.host.state.items[0]?.metadata[`${ns}/link`]), NS, { timeout: 5000 });
  state = await host(() => window.host.state);
  const assetLink = state.items[0].metadata[`${NS}/link`];
  check("a token dragged in from Owlbear storage is linked to its page", assetLink.projectId === "proj_test01" && assetLink.resourceId === "goblin");

  console.log("Page links: Open LK Page and Link LK Page…");
  state = await host(() => window.host.state);
  check("the room records the GM's project for players", state.roomMeta[`${NS}/project`]?.id === "proj_test01", JSON.stringify(state.roomMeta[`${NS}/project`]));
  const imported = state.items[0];
  const importedMenus = await host((id) => window.host.contextMenusFor([id]), imported.id);
  check(
    "a linked token offers Open, Link and Token Art",
    ["Open LK Page", "Link LK Page…", "LK Token Art"].every((label) => importedMenus.some((m) => m.label === label)),
    JSON.stringify(importedMenus),
  );
  const panelFrame = page.frameLocator('iframe[data-popover$="/panel"]');
  await host((id) => window.host.clickContextMenu(`${window.NS}/open`, [id]), imported.id);
  await page.waitForFunction((ns) => Boolean(window.host.state.popovers[`${ns}/panel`]), NS, { timeout: 10_000 });
  let panel = (await host(() => window.host.popovers()))[`${NS}/panel`];
  check("Open LK Page opens an imported token's own page in the side panel", new URL(panel.url).searchParams.get("resource") === "goblin", panel.url);
  check("the side panel is pinned right, full height, and survives click-away", panel.options.anchorOrigin?.horizontal === "RIGHT" && panel.options.disableClickAway === true && panel.options.height === 784);
  await panelFrame.getByText("Goblin Boss").first().waitFor();
  check("the panel frames LegendKeeper's public view", (await panelFrame.locator("iframe.lk-frame").getAttribute("src")) === "https://www.legendkeeper.com/p/proj_test01/goblin/");
  check("the GM's Edit in LegendKeeper link opens the LegendKeeper app", (await panelFrame.getByRole("link", { name: /Edit in LegendKeeper/ }).getAttribute("href")) === "https://www.legendkeeper.com/a/proj_test01/goblin/");
  await shot("06-side-panel");

  const lkFrame = () => page.frames().find((f) => f.url().startsWith("https://www.legendkeeper.com/"));
  const navButton = (name) => panelFrame.getByRole("navigation", { name: "Page navigation" }).getByRole("button", { name, exact: true });
  const lkUrlEnds = async (suffix) => {
    for (let i = 0; i < 40 && !lkFrame()?.url().endsWith(suffix); i++) await page.waitForTimeout(100);
    return lkFrame()?.url() ?? "";
  };
  await panelFrame.frameLocator("iframe.lk-frame").getByRole("link", { name: "Next page" }).waitFor();
  check("panel nav starts with back and forward disabled", (await navButton("Back").isDisabled()) && (await navButton("Forward").isDisabled()));
  const hostUrl = page.url();
  await panelFrame.frameLocator("iframe.lk-frame").getByRole("link", { name: "Next page" }).click();
  await lkUrlEnds("/page1/");
  await panelFrame.frameLocator("iframe.lk-frame").getByRole("link", { name: "Next page" }).click();
  await lkUrlEnds("/page2/");
  await page.waitForTimeout(400);
  check("following links in the page enables Back", !(await navButton("Back").isDisabled()));
  await navButton("Back").click();
  check("Back returns to the previous LegendKeeper page", (await lkUrlEnds("/page1/")).endsWith("/page1/"), lkFrame()?.url());
  await navButton("Back").click();
  check("Back again returns to the first page", (await lkUrlEnds("/goblin/")).endsWith("/goblin/"), lkFrame()?.url());
  await page.waitForTimeout(300);
  check("Back stops at the first page; Forward is offered", (await navButton("Back").isDisabled()) && !(await navButton("Forward").isDisabled()));
  await navButton("Forward").click();
  check("Forward goes forward again", (await lkUrlEnds("/page1/")).endsWith("/page1/"), lkFrame()?.url());
  await navButton("Home: Goblin Boss").click();
  check("Home reloads the token's page", (await lkUrlEnds("/goblin/")).endsWith("/goblin/"), lkFrame()?.url());
  check("panel navigation never navigates Owlbear itself", page.url() === hostUrl);
  await host(() => (document.getElementById("toasts").innerHTML = ""));
  await page.locator('iframe[data-popover$="/panel"]').screenshot({ path: path.join(OUT, "06b-panel-nav.png") });

  const plain = (id, name, label) => ({
    id, type: "IMAGE", name, layer: "CHARACTER", visible: true, locked: false, metadata: {}, position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
    image: { url: PIXEL, width: 100, height: 100, mime: "image/png" }, grid: { dpi: 100, offset: { x: 50, y: 50 } },
    text: { type: "PLAIN", plainText: label, richText: [], style: {} },
  });
  await host((item) => window.host.addItem(item), plain("queen", "token-07.png", "The Hollow Queen"));
  const plainMenus = await host(() => window.host.contextMenusFor(["queen"]));
  check("a plain token offers Open and Link but no Token Art", plainMenus.map((m) => m.label).sort().join("|") === "Link LK Page…|Open LK Page", JSON.stringify(plainMenus));
  await host(() => window.host.clickContextMenu(`${window.NS}/open`, ["queen"]));
  await page.waitForFunction((ns) => window.host.state.popovers[`${ns}/panel`]?.el.src.includes("resource=villain"), NS, { timeout: 10_000 });
  check("a token's label matches a page alias (hidden page included for the GM)", true);
  await panelFrame.getByText("Hidden from players").waitFor();
  check("the GM reads a hidden page through the API, since the public view can't show it", (await panelFrame.locator("iframe.lk-frame").count()) === 0);

  await host((item) => window.host.addItem(item), plain("mystery", "token-08.png", ""));
  await host(() => window.host.clickContextMenu(`${window.NS}/link`, ["mystery"]));
  const picker = page.frameLocator('iframe[data-modal$="/picker"]');
  await picker.getByLabel("Search LegendKeeper pages").fill("cabal");
  await picker.locator(".result", { hasText: "Mordrith" }).waitFor();
  check("the GM's picker searches folders and flags hidden pages", (await picker.locator(".result", { hasText: "Mordrith" }).locator(".badge").innerText()) === "Hidden");
  await picker.getByLabel("Search LegendKeeper pages").fill("millbrook");
  await shot("07-picker");
  await picker.locator(".result", { hasText: "Millbrook" }).click();
  await page.waitForFunction((ns) => window.host.state.items.find((i) => i.id === "mystery")?.metadata[`${ns}/link`], NS, { timeout: 10_000 });
  state = await host(() => window.host.state);
  const manual = state.items.find((i) => i.id === "mystery").metadata[`${NS}/link`];
  check("Link LK Page… saves the same link format an import does", manual.v === 1 && manual.projectId === "proj_test01" && manual.resourceId === "village" && manual.title === "Millbrook", JSON.stringify(manual));
  await page.waitForFunction((ns) => window.host.state.popovers[`${ns}/panel`]?.el.src.includes("resource=village"), NS, { timeout: 10_000 });
  check("choosing a page opens it", true);
  await host(() => window.host.clickContextMenu(`${window.NS}/open`, ["mystery"]));
  await page.waitForTimeout(800);
  check("the linked token now opens its page directly", !(await host(() => window.host.modals()))[`${NS}/picker`]);

  console.log("Scene text: notes and Text items that name pages");
  const textItem = (id, text, extra = {}) => ({
    id, type: "TEXT", name: "Text", layer: "TEXT", visible: true, locked: false, metadata: {}, position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 },
    text: { type: "PLAIN", plainText: text, richText: [], style: {} }, textItemType: "TEXT", ...extra,
  });
  const note = textItem("note-1", "", {
    type: "IMAGE", layer: "NOTE", name: "Note",
    image: { url: PIXEL, width: 100, height: 100, mime: "image/png" }, grid: { dpi: 100, offset: { x: 50, y: 50 } },
    text: { type: "RICH", plainText: "", style: {}, richText: [{ type: "paragraph", children: [{ text: "Rumour: " }, { text: "the Hollow Queen", bold: true }, { text: " hides in Millbrook." }] }] },
  });
  await host((item) => window.host.addItem(item), textItem("text-1", "An ANCIENT RED DRAGON circles the hills above millbrookery."));
  await host((item) => window.host.addItem(item), note);
  await host((item) => window.host.addItem(item), textItem("text-2", "Nothing to see here"));
  const textMenu = `${NS}/text-pages`;
  await page.waitForFunction((id) => window.host.state.contextMenus[id], textMenu, { timeout: 10_000 });
  const menuLabels = async (id) => (await host((i) => window.host.contextMenusFor([i]), id)).map((m) => m.label);
  check("notes and Text items that name a page get the LegendKeeper pages menu", (await menuLabels("text-1")).includes("LegendKeeper pages") && (await menuLabels("note-1")).includes("LegendKeeper pages"));
  check("text without page names doesn't", !(await menuLabels("text-2")).includes("LegendKeeper pages"));
  check("tokens don't get the text menu", !(await menuLabels("queen")).includes("LegendKeeper pages"));
  await host(({ id, item }) => window.host.openContextMenuEmbed(id, [item]), { id: textMenu, item: "note-1" });
  const embed = page.frameLocator(`iframe[data-embed="${textMenu}"]`);
  await embed.getByText("Mordrith").waitFor();
  const embedText = await embed.locator(".embed-body").innerText();
  check("the menu lists the note's pages, matched on an alias, hidden flagged", embedText.includes("Millbrook") && (await embed.locator(".badge.warn").count()) === 1 && !embedText.includes("Dragon"), embedText);
  await shot("09-text-menu");
  await embed.getByRole("button", { name: /Millbrook/ }).click();
  await page.waitForFunction((ns) => window.host.state.popovers[`${ns}/panel`]?.el.src.includes("resource=village"), NS, { timeout: 10_000 });
  await panelFrame.locator("iframe.lk-frame").waitFor();
  check("a text link opens the LegendKeeper page in the side panel, as Open LK Page does", (await panelFrame.locator("iframe.lk-frame").getAttribute("src")) === "https://www.legendkeeper.com/p/proj_test01/village/");

  // Drag the panel's left edge 200 px to the left: it widens.
  const panelBox = await page.locator('iframe[data-popover$="/panel"]').boundingBox();
  const widthBefore = (await host(() => window.host.popovers()))[`${NS}/panel`].options.width;
  await page.mouse.move(panelBox.x + 3, panelBox.y + panelBox.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(panelBox.x + 3 - i * 20, panelBox.y + panelBox.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const widthAfter = (await host(() => window.host.popovers()))[`${NS}/panel`].options.width;
  check("dragging the panel's left edge resizes it", widthAfter >= widthBefore + 150, `${widthBefore} → ${widthAfter}`);
  const savedWidth = await extOrigin().evaluate(() => Number(localStorage.getItem("lkob.panel-width.v1")));
  check("the panel remembers its width", savedWidth === widthAfter, `${savedWidth}`);

  if (await pop.getByLabel("Back to search").isVisible()) await pop.getByLabel("Back to search").click();
  await pop.getByRole("button", { name: /In this scene \(3\)/ }).click();
  await pop.getByText("An ANCIENT RED DRAGON circles").waitFor();
  const groups = await pop.locator(".text-group").allInnerTexts();
  check("the popover lists every matched page, grouped by item", groups.length === 2 && groups[0].includes("Ancient Red Dragon") && groups[1].includes("Mordrith") && groups[1].includes("Millbrook"), JSON.stringify(groups));
  check("whole words only: 'millbrookery' doesn't match", !groups[0].includes("Millbrook"));
  await shot("10-scene-text");
  await pop.locator(".text-link", { hasText: "Ancient Red Dragon" }).click();
  await page.waitForFunction((ns) => window.host.state.popovers[`${ns}/panel`]?.el.src.includes("resource=dragon"), NS, { timeout: 10_000 });
  await panelFrame.locator("iframe.lk-frame").waitFor();
  check("the panel reopens at the remembered width", (await host(() => window.host.popovers()))[`${NS}/panel`].options.width === savedWidth);
  await panelFrame.getByRole("button", { name: "Full page (GM)" }).click();
  await panelFrame.getByText("Gargantuan dragon, chaotic evil").waitFor();
  check("the GM can also read the page through the API, secrets included", (await panelFrame.locator(".lk-box-secret").count()) === 1);
  await shot("11-content-panel");
  await pop.locator(".text-group-head button", { hasText: "Rumour" }).click();
  check("clicking an item's name selects it on the map", (await host(() => window.host.state.selection)).includes("note-1"));
  await host(() => window.host.deleteItems(["text-2"]));
  await host((item) => window.host.addItem(item), textItem("text-2", "Goblin Boss was here"));
  await page.waitForFunction(() => window.host.contextMenusFor(["text-2"]).some((m) => m.label === "LegendKeeper pages"), null, { timeout: 10_000 });
  check("changed text is re-checked automatically", true);
  await pop.getByText("Goblin Boss was here").waitFor();
  check("the popover follows the change", true);
  state = await host(() => window.host.state);
  check("the API key never reaches the room or scene", !JSON.stringify([state.roomMeta, state.sceneMeta, state.items]).includes(API_KEY));
  const storage = await extOrigin().evaluate(() => JSON.stringify({ ...localStorage }));
  check("the API key never reaches the browser", !storage.includes(API_KEY));

  console.log("Players");
  const linkedVillain = { ...plain("villain-token", "Mordrith", "Mordrith"), metadata: { [`${NS}/link`]: { v: 1, projectId: "proj_test01", resourceId: "villain", title: "Mordrith", linkedAt: "", importId: "" } } };
  const player = await context.newPage();
  player.on("pageerror", (e) => consoleErrors.push(e.message));
  await player.goto(`${HOST}/?role=player&ext=${encodeURIComponent(WORKER)}`);
  await player.evaluate(({ ns, items }) => {
    window.host.state.roomMeta[`${ns}/project`] = { id: "proj_test01", name: "The Test Realm" };
    window.host.state.items.push(...items);
  }, { ns: NS, items: [plain("goblin-token", "goblin.png", "Goblin Boss"), linkedVillain, plain("other", "token-09.png", ""), textItem("p-text", "Ancient Red Dragon and The Hollow Queen")] });
  await player.evaluate(() => window.host.boot());
  const playerPop = player.frameLocator("#popover");
  await playerPop.getByText("The Test Realm: 6 pages, updated just now").waitFor();
  check("players get the page-opening view, not the importer", (await playerPop.getByText("Choose artwork").count()) === 0 && (await playerPop.getByRole("button", { name: "Owlbear panel" }).isVisible()));
  await playerPop.locator(".text-link", { hasText: "Ancient Red Dragon" }).waitFor();
  check("players see public pages named in the scene, never hidden ones", (await playerPop.locator(".text-link", { hasText: "Mordrith" }).count()) === 0);
  await player.screenshot({ path: path.join(OUT, "08-player-popover.png") });
  const playerTextMenu = await player
    .waitForFunction(() => window.host.contextMenusFor(["p-text"]).some((m) => m.label === "LegendKeeper pages"), null, { timeout: 10_000 })
    .then(() => true, () => false);
  check("players get the text menu too", playerTextMenu);
  const playerMenus = await player.evaluate(() => window.host.contextMenusFor(["villain-token"]));
  check("players get Open and Link, never Token Art", playerMenus.map((m) => m.label).sort().join("|") === "Link LK Page…|Open LK Page", JSON.stringify(playerMenus));
  await player.evaluate((ns) => window.host.clickContextMenu(`${ns}/open`, ["villain-token"]), NS);
  await player.waitForFunction(() => window.host.state.notifications.some((n) => n.message.includes("isn't public")), null, { timeout: 10_000 });
  check("a GM link to a hidden page is not shown to players", (await player.evaluate(() => Object.keys(window.host.state.popovers).length)) === 0);
  await player.evaluate((ns) => window.host.clickContextMenu(`${ns}/open`, ["goblin-token"]), NS);
  await player.waitForFunction((ns) => window.host.state.popovers[`${ns}/panel`]?.el.src.includes("resource=goblin"), NS, { timeout: 10_000 });
  const playerPanel = player.frameLocator('iframe[data-popover$="/panel"]');
  check("players open public pages from the label, and get the public view in a tab", (await playerPanel.getByRole("link", { name: /Open in LegendKeeper/ }).getAttribute("href")) === "https://www.legendkeeper.com/p/proj_test01/goblin/");
  check("players also get Edit in LegendKeeper, for those who may edit", (await playerPanel.getByRole("link", { name: /Edit in LegendKeeper/ }).getAttribute("href")) === "https://www.legendkeeper.com/a/proj_test01/goblin/");
  await player.evaluate((ns) => window.host.clickContextMenu(`${ns}/link`, ["other"]), NS);
  const playerPicker = player.frameLocator('iframe[data-modal$="/picker"]');
  await playerPicker.getByLabel("Search LegendKeeper pages").fill("mordrith");
  await playerPicker.getByText("No pages match").waitFor();
  check("players can't find hidden pages", true);
  await playerPicker.getByLabel("Search LegendKeeper pages").fill("dragon");
  await playerPicker.locator(".result", { hasText: "Ancient Red Dragon" }).click();
  await player.waitForFunction((ns) => window.host.state.popovers[`${ns}/panel`]?.el.src.includes("resource=dragon"), NS, { timeout: 10_000 });
  // The extension's own storage, on its origin (not the host page's).
  const extFrame = player.frames().find((f) => f.url().startsWith(WORKER));
  const stored = await extFrame.evaluate((ns) => JSON.parse(localStorage.getItem(`${ns}/player-links/e2e-room`) ?? "{}"), NS);
  const otherItem = await player.evaluate(() => window.host.state.items.find((i) => i.id === "other"));
  check("a player's link stays in their browser, not on the token", stored.other?.resourceId === "dragon" && !otherItem.metadata[`${NS}/link`], JSON.stringify(stored));
  await playerPop.locator(".text-link", { hasText: "Ancient Red Dragon" }).click();
  await player.waitForFunction((ns) => window.host.state.popovers[`${ns}/panel`]?.el.src.includes("resource=dragon") && !window.host.state.popovers[`${ns}/panel`]?.el.src.includes("view="), NS, { timeout: 10_000 });
  const playerTextPanel = player.frameLocator('iframe[data-popover$="/panel"]');
  await playerTextPanel.locator("iframe.lk-frame").waitFor();
  check(
    "a player's text link opens only the public view",
    (await playerTextPanel.locator("iframe.lk-frame").getAttribute("src")) === "https://www.legendkeeper.com/p/proj_test01/dragon/" &&
      (await playerTextPanel.getByRole("button", { name: "Full page (GM)" }).count()) === 0,
  );
  console.log("Players making tokens");
  // Each page is its own Owlbear client; the test carries broadcasts between them.
  const relay = async (from, to, suffix) => {
    const message = (await from.evaluate(() => window.host.state.broadcasts)).filter((b) => b.channel.endsWith(suffix)).at(-1);
    await to.evaluate(({ channel, data }) => window.host.deliver(channel, data), message);
    return message;
  };
  await playerPop.getByRole("button", { name: "Ask the GM" }).click();
  await playerPop.getByText("Waiting for the GM").waitFor();
  const request = await relay(player, page, "/access-request");
  check("a player's request names them", request.data.playerId === "player-user");
  const accessDialog = page.frameLocator('iframe[data-modal$="/access-request"]');
  await accessDialog.getByText("asks to search LegendKeeper and make tokens").waitFor();
  check("the GM is asked first", true);
  await accessDialog.getByRole("button", { name: "Allow" }).click();
  await page.waitForFunction(() => window.host.state.broadcasts.some((b) => b.channel.endsWith("/access-answer")), null, { timeout: 10_000 });
  const answer = await relay(page, player, "/access-answer");
  check("the GM's browser sends a pass, never the password or the API key", /^pp1\./.test(answer.data.pass) && !JSON.stringify(answer).includes(PASSWORD) && !JSON.stringify(answer).includes(API_KEY));
  await playerPop.getByLabel("Search public pages").waitFor();
  check("the player can now search", true);
  await playerPop.getByLabel("Search public pages").fill("mordrith");
  await playerPop.getByText("No public page matches").waitFor();
  check("players' search finds no hidden pages", true);
  await playerPop.getByLabel("Search public pages").fill("dragon");
  await playerPop.locator(".result", { hasText: "Ancient Red Dragon" }).click();
  await playerPop.getByText("No images on this page").waitFor();
  check("a secret image is never offered to players", true);
  await playerPop.getByRole("button", { name: "Back to search" }).click();
  await playerPop.getByLabel("Search public pages").fill("goblin");
  await playerPop.locator(".result", { hasText: "Goblin Boss" }).click();
  await playerPop.getByText("Choose artwork").waitFor();
  await playerPop.locator(".image-card img").first().waitFor();
  check("players see a public page's art", (await playerPop.locator(".image-card").count()) === 5);
  await playerPop.getByRole("button", { name: "Edit token" }).click();
  const playerEditor = player.frameLocator('iframe[data-modal$="/editor"]');
  await playerEditor.locator(".token-layer").waitFor();
  await playerEditor.getByText("Loading artwork").waitFor({ state: "detached" });
  check("players can't hide their tokens or host them on the server", (await playerEditor.getByText("Hidden from players").count()) === 0 && (await playerEditor.getByRole("button", { name: "Extension server" }).count()) === 0);
  await playerEditor.getByRole("button", { name: "Create token" }).click();
  await player.waitForFunction(() => window.host.state.uploads.length > 0, null, { timeout: 10_000 });
  const playerUpload = (await player.evaluate(() => window.host.state.uploads)).at(-1);
  check("a player's token goes to their Owlbear storage, visible", playerUpload.visible === true && playerUpload.name === "Goblin Boss", JSON.stringify({ ...playerUpload, url: undefined }));
  await playerPop.getByRole("button", { name: "Back to search" }).click();

  const playerState = await player.evaluate(() => window.host.state);
  check("player: every SDK call handled and none failed", playerState.unhandled.length === 0 && playerState.errors.length === 0, JSON.stringify([playerState.unhandled, playerState.errors]));

  state = await host(() => window.host.state);
  check("host handled every SDK call the extension made", state.unhandled.length === 0, JSON.stringify([...new Set(state.unhandled)]));
  check("no SDK call failed", state.errors.length === 0, JSON.stringify(state.errors));
  const relevant = consoleErrors.filter((e) => !/401|Failed to load resource/.test(e));
  check("no unexpected console errors", relevant.length === 0, JSON.stringify(relevant));

  await browser.close();
  hostServer.close();
}

try {
  await main();
} catch (err) {
  failures.push(`crashed: ${err.stack ?? err}`);
  console.error(err);
  for (const c of children) console.error(c.log().slice(-2000));
} finally {
  for (const { child } of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
process.exit(0);
