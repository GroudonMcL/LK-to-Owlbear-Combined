import { describe, expect, it } from "vitest";
import type { PageEntry } from "@lkob/shared";
import { exactMatches, normalize, resolveToken, searchPages } from "../src/lib/match";

const page = (id: string, name: string, extra: Partial<PageEntry> = {}): PageEntry => ({
  id,
  name,
  aliases: [],
  tags: [],
  path: [],
  hidden: false,
  ...extra,
});

const iggwilv = page("igg", "Iggwilv", { aliases: ["Witch Queen", "Witch Queen of Perrenland"] });
const goblinA = page("gob1", "Goblin", { path: ["Bestiary"] });
const goblinB = page("gob2", "Goblin", { path: ["Sandbox"] });
const goblinLabels = page("gob3", "Goblin (labels)");
const underboss = page("boss", "Goblin Underboss", { tags: ["Monster"] });
const natasha = page("nat", "Natasha", { aliases: ["Natasha the Dark"], path: ["NPCs"] });
const pages = [goblinLabels, underboss, goblinA, goblinB, iggwilv, natasha];

describe("normalize", () => {
  it("ignores case, surrounding space and repeated spaces", () => {
    expect(normalize("  Witch   QUEEN ")).toBe("witch queen");
  });
});

describe("exactMatches", () => {
  it("matches a name or an alias exactly", () => {
    expect(exactMatches(pages, "iggwilv")).toEqual([iggwilv]);
    expect(exactMatches(pages, "witch queen")).toEqual([iggwilv]);
  });

  it("does not match partial names", () => {
    expect(exactMatches(pages, "Witch")).toEqual([]);
  });

  it("returns every page that shares a name", () => {
    expect(exactMatches(pages, "Goblin")).toEqual([goblinA, goblinB]);
  });

  it("matches nothing for blank text", () => {
    expect(exactMatches(pages, "   ")).toEqual([]);
  });
});

describe("searchPages", () => {
  it("ranks exact names first, then prefixes, then substrings", () => {
    expect(searchPages(pages, "goblin").map((p) => p.id)).toEqual(["gob1", "gob2", "gob3", "boss"]);
  });

  it("finds pages by alias, tag and folder", () => {
    expect(searchPages(pages, "the dark")).toEqual([natasha]);
    expect(searchPages(pages, "monster")).toEqual([underboss]);
    expect(searchPages(pages, "npcs")).toEqual([natasha]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchPages(pages, "")).toEqual([]);
  });
});

describe("resolveToken", () => {
  const base = { label: "", name: "", pages };

  it("prefers the GM's link over the player's and over matching", () => {
    const result = resolveToken({
      ...base,
      label: "Iggwilv",
      gmLink: { resourceId: "nat", name: "Natasha" },
      playerLink: { resourceId: "boss", name: "Goblin Underboss" },
    });
    expect(result).toEqual({ kind: "linked", link: { resourceId: "nat", name: "Natasha" }, by: "gm" });
  });

  it("uses the player's link when there is no GM link", () => {
    const result = resolveToken({ ...base, playerLink: { resourceId: "boss", name: "Goblin Underboss" } });
    expect(result).toMatchObject({ kind: "linked", by: "player" });
  });

  it("matches the label before the token name", () => {
    const result = resolveToken({ ...base, label: "Witch Queen", name: "Natasha" });
    expect(result).toEqual({ kind: "matched", page: iggwilv, on: "label" });
  });

  it("falls back to the token name when the label has no single match", () => {
    expect(resolveToken({ ...base, label: "Bob", name: "natasha" })).toEqual({
      kind: "matched",
      page: natasha,
      on: "name",
    });
    expect(resolveToken({ ...base, label: "Goblin", name: "Iggwilv" })).toMatchObject({
      kind: "matched",
      page: iggwilv,
    });
  });

  it("opens the picker with the label when nothing matches exactly once", () => {
    expect(resolveToken({ ...base, label: " Goblin ", name: "token-03.png" })).toEqual({
      kind: "pick",
      query: "Goblin",
    });
  });

  it("pre-fills the picker with the name when there is no label", () => {
    expect(resolveToken({ ...base, name: "Goblin" })).toEqual({ kind: "pick", query: "Goblin" });
  });
});
