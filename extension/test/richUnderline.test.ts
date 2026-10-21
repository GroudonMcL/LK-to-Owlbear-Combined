import { describe, expect, it } from "vitest";
import { addUnderlines, stripUnderlines } from "../src/lib/richUnderline";

const find = (word: string) => (text: string) => {
  const out: { start: number; end: number }[] = [];
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + word.length)) out.push({ start: i, end: i + word.length });
  return out;
};

describe("rich underlines", () => {
  const doc = [
    { type: "paragraph", children: [{ text: "A " }, { text: "bold Dragon here", bold: true }] },
    { type: "bulleted-list", children: [{ type: "list-item", children: [{ text: "Dragon" }] }] },
  ];

  it("underlines the ranges, splitting leaves and keeping their marks", () => {
    const { nodes, phrases } = addUnderlines(doc, find("Dragon"));
    expect(phrases).toEqual(["dragon"]);
    expect((nodes[0] as { children: unknown[] }).children).toEqual([
      { text: "A " },
      { text: "bold ", bold: true },
      { text: "Dragon", bold: true, underline: true },
      { text: " here", bold: true },
    ]);
    expect(nodes[1]).toEqual({ type: "bulleted-list", children: [{ type: "list-item", children: [{ text: "Dragon", underline: true }] }] });
  });

  it("strips only its own underlines and restores the original leaves", () => {
    const { nodes, phrases } = addUnderlines(doc, find("Dragon"));
    expect(stripUnderlines(nodes, new Set(phrases))).toEqual(doc);
    const typed = [{ type: "paragraph", children: [{ text: "Mine", underline: true }] }];
    expect(stripUnderlines(typed, new Set(phrases))).toEqual(typed);
  });

  it("is stable: strip then add again gives the same tree", () => {
    const once = addUnderlines(doc, find("Dragon"));
    const again = addUnderlines(stripUnderlines(once.nodes, new Set(once.phrases)), find("Dragon"));
    expect(again.nodes).toEqual(once.nodes);
  });
});
