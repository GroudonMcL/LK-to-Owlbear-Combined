import { describe, expect, it } from "vitest";
import { parseSharedPage } from "../src/lib/sharedPage";

describe("parseSharedPage", () => {
  it("reads a shared page and names an unknown sender", () => {
    expect(parseSharedPage({ projectId: "p", resourceId: "r", name: "Dragon" })).toEqual({
      projectId: "p",
      resourceId: "r",
      name: "Dragon",
      from: "Someone",
    });
  });

  it("refuses anything that isn't a page", () => {
    expect(parseSharedPage(null)).toBeNull();
    expect(parseSharedPage({ projectId: "p", name: "Dragon" })).toBeNull();
    expect(parseSharedPage({ projectId: "p", resourceId: 5, name: "Dragon" })).toBeNull();
    expect(parseSharedPage({ projectId: "p", resourceId: "r", name: "x".repeat(501) })).toBeNull();
  });
});
