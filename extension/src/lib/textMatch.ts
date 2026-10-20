// "Detect after typing": finds LegendKeeper page names and aliases in the text
// of the scene's notes and text items. Matching is case-insensitive and
// whole-word, and the longest phrase wins ("Red Dragon" over "Dragon").

import type { PageEntry } from "@lkob/shared";
import type { Item } from "@owlbear-rodeo/sdk";

/** A note (an image on the Note layer) or a Text-tool item, with its text. */
export interface TextSource {
  id: string;
  kind: "note" | "text";
  /** A short label for lists: the item's name, else the start of its text. */
  label: string;
  text: string;
}

/** One page found in an item's text. */
export interface TextPageMatch {
  page: PageEntry;
  /** The words as written in the item, for the first occurrence. */
  phrase: string;
}

export interface ItemTextMatches {
  source: TextSource;
  /** Each page once, in the order the text first mentions it. */
  pages: TextPageMatch[];
}

/** Longest phrase, in words, that is looked up. */
const MAX_WORDS = 12;
const WORD = /[\p{L}\p{N}]+/gu;
const LETTER = /\p{L}/u;

interface Word {
  norm: string;
  start: number;
  end: number;
}

function words(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.normalize("NFKC").matchAll(WORD)) {
    out.push({ norm: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/** A name as the lookup key it matches: its words, lower-cased, single-spaced. */
export function phraseKey(name: string): string {
  return words(name)
    .map((w) => w.norm)
    .join(" ");
}

/** Text of Slate nodes (Owlbear's rich text), one line per block. */
function richText(nodes: unknown, depth = 0): string {
  if (!Array.isArray(nodes) || depth > 32) return "";
  const parts: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as { text?: unknown; children?: unknown };
    if (typeof n.text === "string") parts.push(n.text);
    else parts.push(richText(n.children, depth + 1), "\n");
  }
  return parts.join("");
}

/** The text of a note or Text item; null for every other item. */
export function textSource(item: Item): TextSource | null {
  const kind = item.type === "TEXT" ? "text" : item.type === "IMAGE" && item.layer === "NOTE" ? "note" : null;
  if (!kind) return null;
  const content = (item as Item & { text?: { type?: string; plainText?: unknown; richText?: unknown } }).text;
  if (!content) return null;
  const rich = content.type === "RICH" ? richText(content.richText) : "";
  const text = (rich.trim() ? rich : typeof content.plainText === "string" ? content.plainText : "").trim();
  if (!text) return null;
  const firstLine = text.split("\n")[0].trim();
  const fromText = firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
  // Owlbear names new text "Text" and new notes "Note"; the text itself says more.
  const generic = !item.name || /^(text|note)$/i.test(item.name.trim());
  return { id: item.id, kind, label: generic ? fromText : item.name, text };
}

/** Looks up page names and aliases in text. Build one per page list. */
export class PageMatcher {
  private readonly byPhrase = new Map<string, PageEntry[]>();
  private readonly maxWords: number;
  private readonly memo = new Map<string, TextPageMatch[]>();

  constructor(readonly pages: PageEntry[]) {
    let longest = 1;
    for (const page of pages) {
      for (const name of new Set([page.name, ...page.aliases])) {
        const key = phraseKey(name);
        // Single letters and bare numbers would match nearly everywhere.
        if (key.length < 2 || !LETTER.test(key)) continue;
        const list = this.byPhrase.get(key) ?? [];
        if (!list.includes(page)) list.push(page);
        this.byPhrase.set(key, list);
        longest = Math.max(longest, key.split(" ").length);
      }
    }
    this.maxWords = Math.min(MAX_WORDS, longest);
  }

  /** Pages mentioned in `text`, each once, in order of first mention. */
  find(text: string): TextPageMatch[] {
    const cached = this.memo.get(text);
    if (cached) return cached;
    const found = new Map<string, TextPageMatch>();
    const ws = words(text);
    const normalized = text.normalize("NFKC");
    for (let i = 0; i < ws.length; ) {
      let advanced = false;
      for (let len = Math.min(this.maxWords, ws.length - i); len >= 1; len--) {
        const key = ws.slice(i, i + len).map((w) => w.norm).join(" ");
        const pages = this.byPhrase.get(key);
        if (!pages) continue;
        const phrase = normalized.slice(ws[i].start, ws[i + len - 1].end);
        for (const page of pages) if (!found.has(page.id)) found.set(page.id, { page, phrase });
        i += len;
        advanced = true;
        break;
      }
      if (!advanced) i += 1;
    }
    const result = [...found.values()];
    if (this.memo.size > 500) this.memo.clear();
    this.memo.set(text, result);
    return result;
  }

  /** Every note and Text item that mentions at least one page, in scene order. */
  matchItems(items: Item[]): ItemTextMatches[] {
    const out: ItemTextMatches[] = [];
    for (const item of items) {
      const source = textSource(item);
      if (!source) continue;
      const pages = this.find(source.text);
      if (pages.length) out.push({ source, pages });
    }
    return out;
  }
}

/** A page found in an item, as lists show it. */
export interface MatchedPage {
  id: string;
  name: string;
  hidden: boolean;
  phrase: string;
}

/** One note or Text item and the pages found in it. */
export interface TextMatchGroup {
  itemId: string;
  kind: "note" | "text";
  label: string;
  pages: MatchedPage[];
}

export function toGroups(matches: ItemTextMatches[]): TextMatchGroup[] {
  return matches.map(({ source, pages }) => ({
    itemId: source.id,
    kind: source.kind,
    label: source.label,
    pages: pages.map(({ page, phrase }) => ({ id: page.id, name: page.name, hidden: page.hidden, phrase })),
  }));
}
