import { describe, expect, it } from "vitest";
import { blockText, layoutRanges, textBlocks, type LayoutOptions, type LayoutStyle, type Measure } from "../src/lib/textLayout";

// Every character is 10 units wide at size 10 (scaled with size), bold ones 12.
const measure: Measure = (text, font) => text.length * font.size * (font.weight >= 700 ? 1.2 : 1);
const style: LayoutStyle = {
  fontFamily: "Roboto",
  fontSize: 10,
  fontWeight: 400,
  lineHeight: 1.5,
  padding: 5,
  textAlign: "LEFT",
  textAlignVertical: "TOP",
};
const options: LayoutOptions = { heading1: 2, heading2: 1.5, listIndent: 1.5, paragraphGap: 0 };

describe("textBlocks", () => {
  it("reads rich text blocks, lists and marks", () => {
    const blocks = textBlocks({
      type: "RICH",
      richText: [
        { type: "heading-one", children: [{ text: "Title" }] },
        { type: "paragraph", children: [{ text: "A " }, { text: "bold", bold: true }, { text: " word", underline: true }] },
        { type: "bulleted-list", children: [{ type: "list-item", children: [{ text: "Item" }] }] },
      ],
    });
    expect(blocks.map((b) => [b.kind, blockText(b)])).toEqual([
      ["heading-one", "Title"],
      ["paragraph", "A bold word"],
      ["list-item", "Item"],
    ]);
    expect(blocks[1].leaves[1]).toMatchObject({ bold: true });
  });

  it("splits plain text into lines", () => {
    expect(textBlocks({ type: "PLAIN", plainText: "one\ntwo" }).map(blockText)).toEqual(["one", "two"]);
  });
});

describe("layoutRanges", () => {
  it("places a word on its line, after the padding", () => {
    const blocks = textBlocks({ type: "PLAIN", plainText: "the dragon sleeps" });
    const [[[rect]]] = layoutRanges(blocks, [[{ start: 4, end: 10 }]], style, { width: 1000, height: 100, wrap: true }, options, measure);
    expect(rect).toMatchObject({ x: 45, y: 5, width: 60, height: 15, underlined: false });
  });

  it("wraps at the box width and splits a phrase across lines", () => {
    // Content width 100: "aaaa bbbb" (90) fits, "cccc" wraps.
    const blocks = textBlocks({ type: "PLAIN", plainText: "aaaa bbbb cccc" });
    const [[rects]] = layoutRanges(blocks, [[{ start: 5, end: 14 }]], style, { width: 110, height: 100, wrap: true }, options, measure);
    expect(rects.map((r) => [r.x, r.y, r.width])).toEqual([
      [55, 5, 40],
      [5, 20, 40],
    ]);
  });

  it("never wraps auto-sized text, and aligns to the widest line", () => {
    const blocks = textBlocks({ type: "PLAIN", plainText: "aaaa bbbb cccc\nxx" });
    const centred = { ...style, textAlign: "CENTER" as const };
    const placed = layoutRanges(blocks, [[{ start: 10, end: 14 }], [{ start: 0, end: 2 }]], centred, { width: 20, height: 40, wrap: false }, options, measure);
    expect(placed[0][0]).toHaveLength(1);
    expect(placed[0][0][0].x).toBe(105);
    expect(placed[1][0][0].x).toBe(5 + 60); // (140 - 20) / 2
  });

  it("scales headings, indents list items and stacks lines", () => {
    const blocks = textBlocks({
      type: "RICH",
      richText: [
        { type: "heading-one", children: [{ text: "Dragon" }] },
        { type: "bulleted-list", children: [{ type: "list-item", children: [{ text: "Dragon" }] }] },
      ],
    });
    const placed = layoutRanges(blocks, [[{ start: 0, end: 6 }], [{ start: 0, end: 6 }]], style, { width: 1000, height: 100, wrap: true }, options, measure);
    const heading = placed[0][0][0];
    const item = placed[1][0][0];
    expect(heading).toMatchObject({ x: 5, y: 5, width: 144, fontSize: 20 }); // bold at size 20
    expect(item).toMatchObject({ x: 20, y: 35, width: 60 });
  });

  it("aligns to the bottom and reports existing underlines", () => {
    const blocks = textBlocks({ type: "RICH", richText: [{ type: "paragraph", children: [{ text: "Dragon", underline: true }] }] });
    const bottom = { ...style, textAlignVertical: "BOTTOM" as const };
    const [[[rect]]] = layoutRanges(blocks, [[{ start: 0, end: 6 }]], bottom, { width: 200, height: 110, wrap: true }, options, measure);
    expect(rect).toMatchObject({ y: 90, underlined: true });
  });
});
