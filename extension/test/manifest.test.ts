import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(path.join(__dirname, "../public/manifest.json"), "utf8"));

// Owlbear refuses to add an extension whose manifest breaks these rules.
describe("manifest.json", () => {
  it("keeps the description within Owlbear's 128 characters", () => {
    expect(manifest.description.length).toBeLessThanOrEqual(128);
  });

  it("starts every path with a slash", () => {
    for (const p of [manifest.icon, manifest.background_url, manifest.action.icon, manifest.action.popover]) {
      expect(p).toMatch(/^\//);
    }
  });
});
