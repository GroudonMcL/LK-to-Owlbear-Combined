// Runs only the mock LegendKeeper (API + asset host), e.g. for `wrangler dev`.
// MOCK_LK_PUBLIC=1 makes its project public, so its public pages can be read without a key.
import { API_KEY, startMockLk } from "./mockLk.js";

const lk = await startMockLk(Number(process.env.MOCK_LK_PORT ?? 8790));
lk.setPublic(process.env.MOCK_LK_PUBLIC === "1");
console.log(`Mock LegendKeeper on ${lk.baseUrl} (API key ${API_KEY})`);
