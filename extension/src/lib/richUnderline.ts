// "Real underline" mode: page names underlined in the note's own rich text, so
// everyone sees them. The phrases the extension underlined are recorded on the
// item, so it can take its underlines off again without touching the ones
// people typed.

import { NAMESPACE } from "./links";

/** Item metadata: the phrases (lower-cased) this extension underlined. */
export const UNDERLINED_KEY = `${NAMESPACE}/underlined`;

type Leaf = { text: string; underline?: boolean; [mark: string]: unknown };
type Element = { type?: string; children: unknown[]; [key: string]: unknown };

const MAX_DEPTH = 32;

function isLeaf(node: unknown): node is Leaf {
  return Boolean(node && typeof node === "object" && typeof (node as Leaf).text === "string");
}

function isElement(node: unknown): node is Element {
  return Boolean(node && typeof node === "object" && Array.isArray((node as Element).children));
}

function sameMarks(a: Leaf, b: Leaf): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("text");
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function merge(leaves: Leaf[]): Leaf[] {
  const out: Leaf[] = [];
  for (const leaf of leaves) {
    const prev = out[out.length - 1];
    if (prev && sameMarks(prev, leaf)) out[out.length - 1] = { ...prev, text: prev.text + leaf.text };
    else out.push({ ...leaf });
  }
  return out.length ? out : [{ text: "" }];
}

/** Calls `fn` with the leaves of each block whose children are all text; returns a new tree. */
function mapBlocks(nodes: unknown[], fn: (leaves: Leaf[]) => Leaf[], depth = 0): unknown[] {
  if (depth > MAX_DEPTH) return nodes;
  return nodes.map((node) => {
    if (!isElement(node)) return node;
    if (node.children.every(isLeaf)) return { ...node, children: fn(node.children as Leaf[]) };
    return { ...node, children: mapBlocks(node.children, fn, depth + 1) };
  });
}

export function phraseOf(text: string): string {
  return text.trim().toLowerCase();
}

/** Removes the underline from leaves whose whole text is one of `phrases`. */
export function stripUnderlines(nodes: unknown[], phrases: ReadonlySet<string>): unknown[] {
  if (phrases.size === 0) return nodes;
  return mapBlocks(nodes, (leaves) =>
    merge(
      leaves.map((leaf) => {
        if (leaf.underline !== true || !phrases.has(phraseOf(leaf.text))) return leaf;
        const { underline: _underline, ...rest } = leaf;
        return rest as Leaf;
      }),
    ),
  );
}

/**
 * Underlines the ranges `rangesFor` finds in each block's text, splitting
 * leaves at the range edges. Returns the new tree and the phrases underlined.
 */
export function addUnderlines(
  nodes: unknown[],
  rangesFor: (blockText: string) => { start: number; end: number }[],
): { nodes: unknown[]; phrases: string[] } {
  const phrases = new Set<string>();
  const out = mapBlocks(nodes, (leaves) => {
    const text = leaves.map((l) => l.text).join("");
    const ranges = rangesFor(text);
    if (ranges.length === 0) return leaves;
    for (const r of ranges) phrases.add(phraseOf(text.slice(r.start, r.end)));
    const cuts = new Set<number>([0, text.length]);
    let offset = 0;
    for (const leaf of leaves) cuts.add((offset += leaf.text.length));
    for (const r of ranges) cuts.add(r.start).add(r.end);
    const points = [...cuts].sort((a, b) => a - b);
    const result: Leaf[] = [];
    let leafIndex = 0;
    let leafStart = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const [from, to] = [points[i], points[i + 1]];
      if (from === to) continue;
      while (leafStart + leaves[leafIndex].text.length <= from) leafStart += leaves[leafIndex++].text.length;
      const piece: Leaf = { ...leaves[leafIndex], text: text.slice(from, to) };
      if (ranges.some((r) => from >= r.start && to <= r.end)) piece.underline = true;
      result.push(piece);
    }
    return result.length ? result : leaves;
  });
  return { nodes: out, phrases: [...phrases].sort() };
}
