import { describe, expect, it } from "vitest";
import { buildPageList } from "../src/core/lk/pageList.js";

const project = { id: "proj", name: "Test", isPublic: true };
const now = new Date("2026-01-01T00:00:00Z");
const r = (id: string, name: string, parentId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  parentId,
  tags: [],
  aliases: [],
  isHidden: false,
  ...extra,
});

describe("buildPageList", () => {
  const resources = [
    r("world", "World", null),
    r("npcs", "NPCs", "world", { isHidden: true }),
    r("bob", "Bob", "npcs", { aliases: ["Robert"], tags: ["NPC"], iconColor: "#4f6d8f" }),
    r("tpl", "NPC Template", "templates"),
    r("tplchild", "Template part", "tpl"),
  ];
  const list = buildPageList(project, resources, "gm", false, now);

  it("records the project and when the list was built", () => {
    expect(list).toMatchObject({
      projectId: "proj",
      projectName: "Test",
      isPublic: true,
      audience: "gm",
      truncated: false,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("builds the folder path, outermost first", () => {
    expect(list.pages.find((p) => p.id === "bob")).toEqual({
      id: "bob",
      name: "Bob",
      aliases: ["Robert"],
      tags: ["NPC"],
      path: ["World", "NPCs"],
      hidden: true,
      iconColor: "#4f6d8f",
    });
  });

  it("marks pages under a hidden folder as hidden", () => {
    expect(list.pages.find((p) => p.id === "world")?.hidden).toBe(false);
    expect(list.pages.find((p) => p.id === "npcs")?.hidden).toBe(true);
  });

  it("leaves templates out", () => {
    expect(list.pages.map((p) => p.id)).toEqual(["world", "npcs", "bob"]);
  });

  it("survives a parent cycle", () => {
    const cyclic = [r("a", "A", "b"), r("b", "B", "a")];
    expect(buildPageList(project, cyclic, "public", false, now).pages.map((p) => p.path)).toEqual([["B"], ["A"]]);
  });
});
