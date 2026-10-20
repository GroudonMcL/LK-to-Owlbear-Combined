import { describe, expect, it } from "vitest";
import type { PageEntry } from "@lkob/shared";
import type { Item } from "@owlbear-rodeo/sdk";
import { PageMatcher, phraseKey, textSource, toGroups } from "../src/lib/textMatch";

const page = (id: string, name: string, extra: Partial<PageEntry> = {}): PageEntry => ({
  id,
  name,
  aliases: [],
  tags: [],
  path: [],
  hidden: false,
  ...extra,
});

const dragon = page("dragon", "Dragon");
const redDragon = page("red", "Red Dragon", { aliases: ["The Crimson Wyrm"] });
const tiamat = page("tia", "Tiamat's Lair", { hidden: true });
const village = page("vil", "Millbrook", { aliases: ["Mill Brook"] });
const twinA = page("twa", "Twins");
const twinB = page("twb", "Twins", { path: ["Other"] });
const letter = page("a", "A");
const year = page("y", "1492");
const matcher = new PageMatcher([dragon, redDragon, tiamat, village, twinA, twinB, letter, year]);

const ids = (text: string) => matcher.find(text).map((m) => m.page.id);

describe("PageMatcher.find", () => {
  it("matches names case-insensitively", () => {
    expect(ids("a DRAGON sleeps under millbrook")).toEqual(["dragon", "vil"]);
  });

  it("matches whole words only", () => {
    expect(ids("Dragonfly and dragons and snapdragon")).toEqual([]);
  });

  it("prefers the longest phrase", () => {
    const found = matcher.find("Beware the red dragon!");
    expect(found.map((m) => m.page.id)).toEqual(["red"]);
    expect(found[0].phrase).toBe("red dragon");
  });

  it("still finds the shorter name elsewhere in the text", () => {
    expect(ids("The Red Dragon fought another dragon.")).toEqual(["red", "dragon"]);
  });

  it("matches aliases, across line breaks and extra spaces", () => {
    expect(ids("They call it\nthe   crimson wyrm.")).toEqual(["red"]);
    expect(ids("Mill Brook")).toEqual(["vil"]);
  });

  it("treats punctuation as a word boundary, so possessives and apostrophes work", () => {
    expect(ids("The dragon's hoard")).toEqual(["dragon"]);
    expect(ids("Enter tiamat's lair")).toEqual(["tia"]);
  });

  it("lists every page sharing a name, once each", () => {
    expect(ids("Twins, twins, TWINS")).toEqual(["twa", "twb"]);
  });

  it("ignores single letters and bare numbers", () => {
    expect(ids("A note from 1492")).toEqual([]);
  });

  it("keeps the phrase as written", () => {
    expect(matcher.find("…the CRIMSON  Wyrm…")[0].phrase).toBe("the CRIMSON  Wyrm");
  });
});

describe("phraseKey", () => {
  it("lower-cases and splits on punctuation", () => {
    expect(phraseKey("  Tiamat's   LAIR ")).toBe("tiamat s lair");
  });
});

const textItem = (id: string, text: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id, name: "Text", type: "TEXT", layer: "TEXT", metadata: {}, text, ...extra }) as unknown as Item;

describe("textSource", () => {
  it("reads plain Text items", () => {
    expect(textSource(textItem("t1", { type: "PLAIN", plainText: "Red Dragon here", richText: [] }))).toEqual({
      id: "t1",
      kind: "text",
      label: "Red Dragon here",
      text: "Red Dragon here",
    });
  });

  it("reads rich text of notes, a line per block", () => {
    const note = textItem(
      "n1",
      {
        type: "RICH",
        plainText: "",
        richText: [
          { type: "heading-one", children: [{ text: "Session 3" }] },
          { type: "bulleted-list", children: [{ type: "list-item", children: [{ text: "Met the " }, { text: "dragon", bold: true }] }] },
        ],
      },
      { type: "IMAGE", layer: "NOTE", name: "Note" },
    );
    const source = textSource(note)!;
    expect(source.kind).toBe("note");
    expect(source.label).toBe("Session 3");
    expect(source.text).toContain("Met the dragon");
    expect(matcher.find(source.text).map((m) => m.page.id)).toEqual(["dragon"]);
  });

  it("ignores tokens, labels and empty text", () => {
    expect(textSource(textItem("i", { type: "PLAIN", plainText: "Dragon" }, { type: "IMAGE", layer: "CHARACTER" }))).toBeNull();
    expect(textSource(textItem("e", { type: "PLAIN", plainText: "   " }))).toBeNull();
    expect(textSource({ id: "s", type: "SHAPE", layer: "DRAWING", metadata: {} } as unknown as Item)).toBeNull();
  });

  it("uses a meaningful item name as the label", () => {
    expect(textSource(textItem("t", { type: "PLAIN", plainText: "x y" }, { name: "Quest board" }))!.label).toBe("Quest board");
  });
});

describe("PageMatcher.matchItems", () => {
  it("returns only items with matches, keeping hidden flags for the GM", () => {
    const items = [
      textItem("t1", { type: "PLAIN", plainText: "Nothing here" }),
      textItem("t2", { type: "PLAIN", plainText: "Tiamat's Lair and a dragon" }),
    ];
    const found = matcher.matchItems(items);
    expect(found.map((m) => m.source.id)).toEqual(["t2"]);
    const [group] = toGroups(found);
    expect(group).toMatchObject({ itemId: "t2", kind: "text", label: "Tiamat's Lair and a dragon" });
    expect(group.pages).toEqual([
      { id: "tia", name: "Tiamat's Lair", hidden: true, phrase: "Tiamat's Lair" },
      { id: "dragon", name: "Dragon", hidden: false, phrase: "dragon" },
    ]);
  });
});
