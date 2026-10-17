// End-to-end test of the deployable artefact (importer, page links, players):
//   production extension bundle + real @owlbear-rodeo/sdk
//   served by the real Cloudflare Workers runtime (wrangler dev / workerd)
//   inside an Owlbear host emulator on another origin,
//   against a mock LegendKeeper built from the v3 OpenAPI spec.
//
// Usage: npm run build:cloudflare && npm run e2e
// Env:   CHROMIUM_PATH (optional), E2E_OUT (screenshot dir, default e2e/output)

import { spawn } from "node:child_process";
import { createReadStream, mkdirSync, statSync } from "node:fs";
import http from "node:http";
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
const TOKEN = "e2e-access-token-0123456789abcdef";
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
  const vars = {
    LK_API_KEYS: "lk_test_key_do_not_leak_0123456789",
    LKOB_ACCESS_TOKENS: TOKEN,
    LK_BASE_URL: "http://127.0.0.1:8790",
    LKOB_INSECURE_ASSET_FETCH: "1",
  };
  const varArgs = Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]);
  run("npx", ["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1", ...varArgs], {
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
  await pop.getByLabel("Access password").fill("wrong-token-wrong-token-wrong");
  await pop.getByRole("button", { name: "Connect" }).click();
  await pop.getByText("Connection failed").waitFor();
  check("a wrong access token is reported", true);
  await pop.getByLabel("Access password").fill(TOKEN);
  await pop.getByRole("button", { name: "Connect" }).click();
  await pop.getByRole("main").getByText("The Test Realm").waitFor();
  check("project resolved from the server's key and auto-selected", await pop.getByRole("radio").isChecked());
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

  console.log("Editor, export, linked token with size");
  await pop.locator(".image-card").nth(1).click();
  await pop.getByRole("button", { name: "Edit token" }).click();
  const modal = page.frameLocator('iframe[data-modal$="/editor"]');
  await modal.locator(".token-layer").waitFor();
  await modal.getByText("Loading artwork").waitFor({ state: "detached" });
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
  await pop.getByText("A token for this page already exists.").waitFor();
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
  await pop.getByText("A token for this page already exists.").waitFor();
  check("context menu opens the linked page in the importer", (await host(() => window.host.state.actionOpen)) === true);

  await host((id) => window.host.copyItem(id), item.id);
  await pop.getByText("2 tokens for this page are in this scene.").waitFor();
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
  await modal.getByRole("button", { name: "Centre of view" }).click();
  await modal.getByRole("button", { name: "Owlbear storage" }).click();
  await modal.getByRole("button", { name: "Create token" }).click();
  await page.waitForFunction(() => window.host.state.items.length === 1, null, { timeout: 15_000 });
  state = await host(() => window.host.state);
  check("token created from the Owlbear-stored image", state.uploads.length === 1 && state.items[0].image.url.startsWith("data:image/png"));
  check("upload carried the footprint dpi", state.uploads[0].grid?.dpi === 512);

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
  check("the GM's full-page link opens the LegendKeeper app", (await panelFrame.getByRole("link", { name: /Open in LegendKeeper/ }).getAttribute("href")) === "https://www.legendkeeper.com/a/proj_test01/goblin/");
  await shot("06-side-panel");

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
  await panelFrame.getByText("This page is hidden").waitFor();
  check("a hidden page explains that the public view can't show it", true);

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

  console.log("Players");
  const linkedVillain = { ...plain("villain-token", "Mordrith", "Mordrith"), metadata: { [`${NS}/link`]: { v: 1, projectId: "proj_test01", resourceId: "villain", title: "Mordrith", linkedAt: "", importId: "" } } };
  const player = await context.newPage();
  player.on("pageerror", (e) => consoleErrors.push(e.message));
  await player.goto(`${HOST}/?role=player&ext=${encodeURIComponent(WORKER)}`);
  await player.evaluate(({ ns, items }) => {
    window.host.state.roomMeta[`${ns}/project`] = { id: "proj_test01", name: "The Test Realm" };
    window.host.state.items.push(...items);
  }, { ns: NS, items: [plain("goblin-token", "goblin.png", "Goblin Boss"), linkedVillain, plain("other", "token-09.png", "")] });
  await player.evaluate(() => window.host.boot());
  const playerPop = player.frameLocator("#popover");
  await playerPop.getByText("public pages").waitFor();
  check("players get the page-opening view, not the importer", (await playerPop.getByText("Choose artwork").count()) === 0 && (await playerPop.getByRole("button", { name: "Owlbear panel" }).isVisible()));
  await player.screenshot({ path: path.join(OUT, "08-player-popover.png") });
  const playerMenus = await player.evaluate(() => window.host.contextMenusFor(["villain-token"]));
  check("players get Open and Link, never Token Art", playerMenus.map((m) => m.label).sort().join("|") === "Link LK Page…|Open LK Page", JSON.stringify(playerMenus));
  await player.evaluate((ns) => window.host.clickContextMenu(`${ns}/open`, ["villain-token"]), NS);
  await player.waitForFunction(() => window.host.state.notifications.some((n) => n.message.includes("isn't public")), null, { timeout: 10_000 });
  check("a GM link to a hidden page is not shown to players", (await player.evaluate(() => Object.keys(window.host.state.popovers).length)) === 0);
  await player.evaluate((ns) => window.host.clickContextMenu(`${ns}/open`, ["goblin-token"]), NS);
  await player.waitForFunction((ns) => window.host.state.popovers[`${ns}/panel`]?.el.src.includes("resource=goblin"), NS, { timeout: 10_000 });
  const playerPanel = player.frameLocator('iframe[data-popover$="/panel"]');
  check("players open public pages from the label, and get the public view in a tab", (await playerPanel.getByRole("link", { name: /Open in LegendKeeper/ }).getAttribute("href")) === "https://www.legendkeeper.com/p/proj_test01/goblin/");
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
