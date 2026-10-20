import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/core/config.js";

describe("loadConfig", () => {
  it("needs no secrets: the API key comes from the extension", () => {
    const config = loadConfig({});
    expect(config.lkBaseUrl).toBe("https://www.legendkeeper.com");
    expect(config.allowedOrigins).toBe("*");
    expect(config).not.toHaveProperty("lkApiKeys");
    expect(config).not.toHaveProperty("accessTokens");
  });

  it("rejects malformed numbers", () => {
    expect(() => loadConfig({ LKOB_RATE_LIMIT_PER_MINUTE: "lots" })).toThrow(ConfigError);
  });
});
