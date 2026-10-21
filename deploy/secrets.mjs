// Validates the LegendKeeper secrets from the repository secrets and writes
// them as a JSON file for `wrangler deploy --secrets-file`. The file path comes from
// argv and should live in $RUNNER_TEMP; values are never printed.
//
// Env: LK_API_KEYS (or LK_API_KEY, the name the Page Link extension used),
//      LKOB_ACCESS_TOKENS

import { writeFileSync } from "node:fs";

const out = process.argv[2];
const keys = (process.env.LK_API_KEYS || process.env.LK_API_KEY || "").trim();
const tokens = (process.env.LKOB_ACCESS_TOKENS ?? "").trim();

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!out) fail("usage: node deploy/secrets.mjs <output.json>");
if (!keys) fail("Add the LK_API_KEYS repository secret: your LegendKeeper API key (Project Settings → Developers → API Keys).");
if (!tokens) fail("Add the LKOB_ACCESS_TOKENS repository secret: the password you will type into the extension.");

writeFileSync(out, JSON.stringify({ LK_API_KEYS: keys, LKOB_ACCESS_TOKENS: tokens }), { mode: 0o600 });
console.log("Secrets validated.");
