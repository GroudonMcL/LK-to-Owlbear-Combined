// Local demo: a mock LegendKeeper plus the real backend, so the extension UI
// can be tried without a paid LegendKeeper key or an Owlbear room.
//   npm run demo            (backend on :8787; enter the printed access password)
//   npm run dev:extension   then open http://localhost:5173/?mock

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.js";
import { createHandler } from "../src/core/handler.js";
import { MemoryPageListStore } from "../src/core/pageListStore.js";
import { PageService, ProjectResolver } from "../src/core/services.js";
import { toNodeListener } from "../src/node/adapter.js";
import { FileTokenStore } from "../src/node/fileTokenStore.js";
import { safeFetch } from "../src/node/safeFetch.js";
import { API_KEY, startMockLk } from "./mockLk.js";

const port = Number(process.env.PORT ?? 8787);
const DEMO_PASSWORD = "demo";

const lk = await startMockLk();
const config = loadConfig({
  LK_BASE_URL: lk.baseUrl,
  LK_API_KEYS: API_KEY,
  LKOB_ACCESS_TOKENS: DEMO_PASSWORD,
  LKOB_TOKEN_DIR: path.join(os.tmpdir(), "lkob-demo-tokens"),
  LKOB_PUBLIC_URL: `http://localhost:${port}`,
  LKOB_INSECURE_ASSET_FETCH: "1",
});
const projects = new ProjectResolver();
const pages = new PageService(projects, {
  lkBaseUrl: lk.baseUrl,
  pageLists: new MemoryPageListStore(),
  maxSourceImageBytes: config.maxSourceImageBytes,
  assetHostAllowlist: null,
  allowInsecureAssetFetch: true,
  fetchImage: safeFetch,
});
const tokens = new FileTokenStore(config.tokenStoreDir, config.tokenStoreMaxBytes);
await tokens.init();
http.createServer(toNodeListener(createHandler({ config, projects, pages, tokens }))).listen(port, () => {
  console.log(`Demo backend on http://localhost:${port} (mock LegendKeeper at ${lk.baseUrl})`);
  console.log(`Access password: ${DEMO_PASSWORD}`);
});
