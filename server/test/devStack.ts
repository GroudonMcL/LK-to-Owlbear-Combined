// Local demo: a mock LegendKeeper plus the real backend, so the extension UI
// can be tried without a paid LegendKeeper key or an Owlbear room.
//   npm run demo            (backend on :8787; paste the printed mock API key)
//   npm run dev:extension   then open http://localhost:5173/?mock

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.js";
import { createHandler } from "../src/core/handler.js";
import { PageService, ProjectResolver } from "../src/core/services.js";
import { toNodeListener } from "../src/node/adapter.js";
import { FileTokenStore } from "../src/node/fileTokenStore.js";
import { safeFetch } from "../src/node/safeFetch.js";
import { API_KEY, startMockLk } from "./mockLk.js";

const port = Number(process.env.PORT ?? 8787);

const lk = await startMockLk();
const config = loadConfig({
  LK_BASE_URL: lk.baseUrl,
  LKOB_TOKEN_DIR: path.join(os.tmpdir(), "lkob-demo-tokens"),
  LKOB_PUBLIC_URL: `http://localhost:${port}`,
  LKOB_INSECURE_ASSET_FETCH: "1",
});
const projects = new ProjectResolver();
const pages = new PageService(projects, {
  lkBaseUrl: lk.baseUrl,
  maxSourceImageBytes: config.maxSourceImageBytes,
  assetHostAllowlist: null,
  allowInsecureAssetFetch: true,
  fetchImage: safeFetch,
});
const tokens = new FileTokenStore(config.tokenStoreDir, config.tokenStoreMaxBytes);
await tokens.init();
http.createServer(toNodeListener(createHandler({ config, projects, pages, tokens }))).listen(port, () => {
  console.log(`Demo backend on http://localhost:${port} (mock LegendKeeper at ${lk.baseUrl})`);
  console.log(`Mock LegendKeeper API key: ${API_KEY}`);
});
