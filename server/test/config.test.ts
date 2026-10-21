import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/core/config.js";

const SECRETS = { LK_API_KEYS: "lk_one, lk_two", LKOB_ACCESS_TOKENS: "goblin" };

describe("loadConfig", () => {
  it("reads the LegendKeeper keys and access passwords", () => {
    const config = loadConfig(SECRETS);
    expect(config.lkApiKeys).toEqual(["lk_one", "lk_two"]);
    expect(config.accessTokens).toEqual(["goblin"]);
    expect(config.lkBaseUrl).toBe("https://www.legendkeeper.com");
    expect(config.allowedOrigins).toBe("*");
  });

  it("accepts LegendKeeper Link's singular LK_API_KEY", () => {
    expect(loadConfig({ LK_API_KEY: "lk_single", LKOB_ACCESS_TOKENS: "pw" }).lkApiKeys).toEqual(["lk_single"]);
  });

  it("requires a key and a password", () => {
    expect(() => loadConfig({ LKOB_ACCESS_TOKENS: "pw" })).toThrow(/LK_API_KEYS/);
    expect(() => loadConfig({ LK_API_KEYS: "k", LKOB_ACCESS_TOKENS: " " })).toThrow(/LKOB_ACCESS_TOKENS/);
  });

  it("rejects malformed numbers", () => {
    expect(() => loadConfig({ ...SECRETS, LKOB_RATE_LIMIT_PER_MINUTE: "lots" })).toThrow(ConfigError);
  });
});
