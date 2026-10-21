// Where the words of a note or Text item sit, so links can be drawn over them.
// Owlbear doesn't report its text layout, so this repeats it: the item's font,
// size, line height, padding and alignment, greedy word wrap at the box
// width, headings and list items scaled and indented. It is a close guess, not
// an exact copy; the Test settings tab has knobs to calibrate it.

import { richText } from "./textMatch";

export interface LayoutLeaf {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type BlockKind = "paragraph" | "heading-one" | "heading-two" | "list-item";

/** One line of rich text (a paragraph, heading or list item) and its formatted runs. */
export interface LayoutBlock {
  kind: BlockKind;
  leaves: LayoutLeaf[];
}

/** The text fields of a note or Text item that layout reads. */
export interface TextContentLike {
  type?: string;
  plainText?: unknown;
  richText?: unknown;
}

const MAX_DEPTH = 32;

function isLeaf(node: unknown): node is LayoutLeaf {
  return Boolean(node && typeof node === "object" && typeof (node as LayoutLeaf).text === "string");
}

function leavesOf(nodes: unknown, depth = 0): LayoutLeaf[] {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return [];
  const out: LayoutLeaf[] = [];
  for (const node of nodes) {
    if (isLeaf(node)) out.push({ text: node.text, bold: node.bold === true, italic: node.italic === true, underline: node.underline === true });
    else if (node && typeof node === "object") out.push(...leavesOf((node as { children?: unknown }).children, depth + 1));
  }
  return out;
}

function blocksOf(nodes: unknown, inList: boolean, out: LayoutBlock[], depth: number): void {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return;
  for (const node of nodes) {
    if (!node || typeof node !== "object" || isLeaf(node)) continue;
    const element = node as { type?: unknown; children?: unknown };
    const type = typeof element.type === "string" ? element.type : "paragraph";
    const children = Array.isArray(element.children) ? element.children : [];
    const list = type === "bulleted-list" || type === "numbered-list";
    if (list || children.some((c) => c && typeof c === "object" && !isLeaf(c))) {
      blocksOf(children, inList || list, out, depth + 1);
      continue;
    }
    const kind: BlockKind =
      type === "heading-one" || type === "heading-two" ? type : inList || type === "list-item" ? "list-item" : "paragraph";
    out.push({ kind, leaves: leavesOf(children) });
  }
}

/** A note's or Text item's text as blocks: rich text by structure, plain text by line. */
export function textBlocks(content: TextContentLike): LayoutBlock[] {
  if (content.type === "RICH" && richText(content.richText).trim()) {
    const out: LayoutBlock[] = [];
    blocksOf(content.richText, false, out, 0);
    return out;
  }
  const plain = typeof content.plainText === "string" ? content.plainText : "";
  return plain.split("\n").map((line) => ({ kind: "paragraph", leaves: [{ text: line }] }));
}

export function blockText(block: LayoutBlock): string {
  return block.leaves.map((l) => l.text).join("");
}

export interface FontSpec {
  family: string;
  size: number;
  weight: number;
  italic: boolean;
}

/** Width of `text` set in `font`. */
export type Measure = (text: string, font: FontSpec) => number;

export interface LayoutStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  padding: number;
  textAlign: "LEFT" | "CENTER" | "RIGHT";
  textAlignVertical: "TOP" | "MIDDLE" | "BOTTOM";
}

export interface LayoutOptions {
  heading1: number;
  heading2: number;
  /** In em of the block's font. */
  listIndent: number;
  /** In em of the block's font. */
  paragraphGap: number;
}

/** The text box, in the item's own units, padding included. */
export interface LayoutBox {
  width: number;
  height: number;
  /** False for auto-sized text, which never wraps. */
  wrap: boolean;
}

/** A piece of a range on one line, in box units from the box's top-left corner. */
export interface RangeRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where an underline goes: the line's baseline. */
  baseline: number;
  fontSize: number;
  /** Every character already carries an underline mark. */
  underlined: boolean;
}

interface Token {
  start: number;
  end: number;
  x: number;
  width: number;
  space: boolean;
}

interface Line {
  tokens: Token[];
  width: number;
}

interface BlockLayout {
  lines: Line[];
  fontSize: number;
  indent: number;
  lineHeight: number;
}

const TOKEN = /\n|[^\S\n]+|\S+/g;

export function layoutRanges(
  blocks: LayoutBlock[],
  ranges: { start: number; end: number }[][],
  style: LayoutStyle,
  box: LayoutBox,
  options: LayoutOptions,
  measure: Measure,
): RangeRect[][][] {
  const fonts = blocks.map((block) => {
    const scale = block.kind === "heading-one" ? options.heading1 : block.kind === "heading-two" ? options.heading2 : 1;
    const heading = block.kind === "heading-one" || block.kind === "heading-two";
    return { size: style.fontSize * scale, weight: heading ? Math.max(700, style.fontWeight) : style.fontWeight };
  });
  const contentWidth = box.width - 2 * style.padding;

  // Per character: the leaf it belongs to.
  const leafAt = blocks.map((block) => {
    const at: number[] = [];
    block.leaves.forEach((leaf, i) => {
      for (let c = 0; c < leaf.text.length; c++) at.push(i);
    });
    return at;
  });

  const span = (b: number, from: number, to: number): number => {
    const block = blocks[b];
    const text = blockText(block);
    let width = 0;
    let c = from;
    while (c < to) {
      const leafIndex = leafAt[b][c];
      let d = c + 1;
      while (d < to && leafAt[b][d] === leafIndex) d++;
      const leaf = block.leaves[leafIndex];
      width += measure(text.slice(c, d), {
        family: style.fontFamily,
        size: fonts[b].size,
        weight: leaf?.bold ? Math.max(700, fonts[b].weight) : fonts[b].weight,
        italic: Boolean(leaf?.italic),
      });
      c = d;
    }
    return width;
  };

  const layouts: BlockLayout[] = blocks.map((block, b) => {
    const fontSize = fonts[b].size;
    const indent = block.kind === "list-item" ? options.listIndent * fontSize : 0;
    const available = box.wrap ? contentWidth - indent : Infinity;
    const text = blockText(block);
    const lines: Line[] = [{ tokens: [], width: 0 }];
    let x = 0;
    for (const m of text.matchAll(TOKEN)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      let line = lines[lines.length - 1];
      if (m[0] === "\n") {
        lines.push({ tokens: [], width: 0 });
        x = 0;
        continue;
      }
      const space = !/\S/.test(m[0]);
      const width = span(b, start, end);
      if (!space && x > 0 && x + width > available + 0.5) {
        line = { tokens: [], width: 0 };
        lines.push(line);
        x = 0;
      }
      // Spaces that end up at the start of a wrapped line take no room.
      if (space && x === 0 && lines.length > 1) continue;
      line.tokens.push({ start, end, x, width, space });
      x += width;
      if (!space) line.width = x;
    }
    return { lines, fontSize, indent, lineHeight: fontSize * style.lineHeight };
  });

  const alignWidth = box.wrap ? contentWidth : Math.max(contentWidth, ...layouts.flatMap((l) => l.lines.map((line) => line.width + l.indent)));
  let cursor = 0;
  const tops = layouts.map((layout, b) => {
    const top = cursor;
    cursor += layout.lines.length * layout.lineHeight;
    if (b < layouts.length - 1) cursor += options.paragraphGap * layout.fontSize;
    return top;
  });
  const contentHeight = box.height - 2 * style.padding;
  const dy =
    style.textAlignVertical === "MIDDLE" ? (contentHeight - cursor) / 2 : style.textAlignVertical === "BOTTOM" ? contentHeight - cursor : 0;

  return ranges.map((blockRanges, b) => {
    const layout = layouts[b];
    if (!layout) return blockRanges.map(() => []);
    const leaves = blocks[b].leaves;
    return blockRanges.map((range) => {
      const rects: RangeRect[] = [];
      layout.lines.forEach((line, n) => {
        const words = line.tokens.filter((t) => !t.space && t.end > range.start && t.start < range.end);
        if (words.length === 0) return;
        const first = words[0];
        const last = words[words.length - 1];
        const from = Math.max(range.start, first.start);
        const to = Math.min(range.end, last.end);
        const x0 = first.x + span(b, first.start, from);
        const x1 = last.x + span(b, last.start, to);
        const free = alignWidth - layout.indent - line.width;
        const align = style.textAlign === "CENTER" ? free / 2 : style.textAlign === "RIGHT" ? free : 0;
        const y = style.padding + dy + tops[b] + n * layout.lineHeight;
        let underlined = true;
        for (let c = from; c < to && underlined; c++) underlined = Boolean(leaves[leafAt[b][c]]?.underline);
        rects.push({
          x: style.padding + layout.indent + align + x0,
          y,
          width: x1 - x0,
          height: layout.lineHeight,
          baseline: y + layout.lineHeight / 2 + 0.32 * layout.fontSize,
          fontSize: layout.fontSize,
          underlined,
        });
      });
      return rects;
    });
  });
}
