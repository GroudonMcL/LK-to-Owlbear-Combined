import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/core/config.js";

describe("loadConfig access passwords", () => {
  it("accepts short passwords, several separated by commas", () => {
    expect(loadConfig({ LK_API_KEYS: "k", LKOB_ACCESS_TOKENS: "goblin, owlbear" }).accessTokens).toEqual(["goblin", "owlbear"]);
  });

  it("requires at least one", () => {
    expect(() => loadConfig({ LK_API_KEYS: "k", LKOB_ACCESS_TOKENS: " " })).toThrow(ConfigError);
  });
});
