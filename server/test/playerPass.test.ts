import { describe, expect, it } from "vitest";
import { PlayerPasses } from "../src/core/playerPass.js";

describe("player passes", () => {
  it("open the project they name until they expire", async () => {
    let now = 1_000_000;
    const passes = new PlayerPasses(["goblin"], () => now);
    const { pass, expiresAt } = await passes.issue("proj_a", 60_000);
    expect(expiresAt).toBe(new Date(1_060_000).toISOString());
    expect(await passes.verify(pass)).toBe("proj_a");
    now = 1_060_001;
    expect(await passes.verify(pass)).toBeNull();
  });

  it("stop working when the access password changes", async () => {
    const { pass } = await new PlayerPasses(["goblin"]).issue("proj_a");
    expect(await new PlayerPasses(["goblin"]).verify(pass)).toBe("proj_a");
    expect(await new PlayerPasses(["dragon"]).verify(pass)).toBeNull();
  });

  it("can't be edited to name another project", async () => {
    const passes = new PlayerPasses(["goblin"]);
    const { pass } = await passes.issue("proj_a");
    const [prefix, , signature] = pass.split(".");
    const payload = Buffer.from(JSON.stringify({ p: "proj_b", e: Date.now() + 60_000 })).toString("base64url");
    expect(await passes.verify(`${prefix}.${payload}.${signature}`)).toBeNull();
    expect(await passes.verify("pp1.not.valid!")).toBeNull();
    expect(await passes.verify("goblin")).toBeNull();
  });
});
