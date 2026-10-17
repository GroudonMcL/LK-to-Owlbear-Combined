import { describe, expect, it } from "vitest";
import { tabUrl } from "../src/lib/urls";

describe("tabUrl", () => {
  it("sends the GM to the logged-in app", () => {
    expect(tabUrl("GM", "proj", "res", true)).toBe("https://www.legendkeeper.com/a/proj/res/");
  });

  it("sends players to the public view of a public project", () => {
    expect(tabUrl("PLAYER", "proj", "res", true)).toBe("https://www.legendkeeper.com/p/proj/res/");
  });

  it("sends players to the app when the project is private", () => {
    expect(tabUrl("PLAYER", "proj", "res", false)).toBe("https://www.legendkeeper.com/a/proj/res/");
  });
});
