// Builds the Worker's stored page lists right after a deploy, so the first
// GM and players to open the extension get them at once. Each list is built
// a step at a time (see PageListBuildStep in shared/src/pageList.ts): a big
// project needs more LegendKeeper calls than one Worker request may make.
//
// Env: WORKER_URL (https://lk-to-owlbear.<subdomain>.workers.dev),
//      LKOB_ACCESS_TOKENS (the first password is used; never printed)
//
// A failure is a warning, not a failed deploy: the GM can build the lists
// later with "Refresh page list" in the extension's Settings.

import { randomBytes } from "node:crypto";

const base = (process.env.WORKER_URL ?? "").replace(/\/+$/, "");
const password = (process.env.LKOB_ACCESS_TOKENS ?? "").split(/[,\s]+/).find(Boolean) ?? "";
const MAX_STEPS = 60;

function warn(message) {
  console.log(`::warning::Page lists not built: ${message} The GM can build them with "Refresh page list" in the extension's Settings.`);
  process.exit(0);
}

async function call(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + path, {
      ...init,
      headers: { Authorization: `Bearer ${password}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(90_000),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return body;
    const retryable = res.status === 429 || res.status >= 500 || body?.error?.retryable;
    if (retryable && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) || 5 * (attempt + 1);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(body?.error?.message ?? `the Worker answered ${res.status}.`);
  }
}

async function build(projectId, audience) {
  const buildId = randomBytes(9).toString("base64url");
  let cursor = "";
  for (let part = 0; part < MAX_STEPS; part++) {
    const step = await call(`/api/projects/${encodeURIComponent(projectId)}/page-list/build`, {
      method: "POST",
      body: JSON.stringify({ audience, buildId, part, cursor }),
    });
    if (step.done) return step.total;
    cursor = step.nextCursor;
  }
  throw new Error("the listing never finished.");
}

if (!base) warn("WORKER_URL is not set.");
if (!password) warn("the LKOB_ACCESS_TOKENS secret is empty.");

try {
  const { projects } = await call("/api/projects?refresh=1");
  for (const project of projects) {
    const gm = await build(project.id, "gm");
    const pub = await build(project.id, "public");
    console.log(`${project.name}: ${gm} pages for the GM, ${pub} public.`);
  }
} catch (err) {
  warn(err instanceof Error ? err.message : String(err));
}
