import type { PageEntry } from "@lkob/shared";
import type { PageLink } from "./pageLinks";

/** Lower-cases, trims and collapses whitespace so "  Iggwilv " equals "iggwilv". */
export function normalize(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Pages whose name or any alias equals `term` after normalizing. */
export function exactMatches(pages: PageEntry[], term: string): PageEntry[] {
  const wanted = normalize(term);
  if (!wanted) return [];
  return pages.filter(
    (page) =>
      normalize(page.name) === wanted ||
      page.aliases.some((alias) => normalize(alias) === wanted),
  );
}

/**
 * Ranked search over names, aliases, tags and folder paths.
 * Exact name beats exact alias, then name prefix, name substring, alias substring,
 * and finally tag or folder matches. Ties keep list order.
 */
export function searchPages(pages: PageEntry[], query: string, limit = 50): PageEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const scored: { page: PageEntry; score: number; index: number }[] = [];
  pages.forEach((page, index) => {
    const score = scorePage(page, q);
    if (score > 0) scored.push({ page, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.page);
}

function scorePage(page: PageEntry, q: string): number {
  const name = normalize(page.name);
  const aliases = page.aliases.map(normalize);
  if (name === q) return 100;
  if (aliases.includes(q)) return 90;
  if (name.startsWith(q)) return 70;
  if (name.includes(q)) return 60;
  if (aliases.some((a) => a.includes(q))) return 50;
  if (page.tags.some((t) => normalize(t).includes(q))) return 30;
  if (page.path.some((p) => normalize(p).includes(q))) return 20;
  return 0;
}

export type Resolution =
  | { kind: "linked"; link: PageLink; by: "gm" | "player" }
  | { kind: "matched"; page: PageEntry; on: "label" | "name" }
  | { kind: "pick"; query: string };

export interface ResolveInput {
  gmLink?: PageLink;
  playerLink?: PageLink;
  /** The token's visible label text, if any. */
  label: string;
  /** The token's own name, usually from its image file. */
  name: string;
  pages: PageEntry[];
}

/**
 * Decides what "Open LK Page" does for a token: a saved link (GM's first),
 * else exactly one name/alias match on the label, then on the name,
 * else the picker pre-filled with the label (or the name).
 */
export function resolveToken(input: ResolveInput): Resolution {
  if (input.gmLink) return { kind: "linked", link: input.gmLink, by: "gm" };
  if (input.playerLink) return { kind: "linked", link: input.playerLink, by: "player" };

  for (const on of ["label", "name"] as const) {
    const term = input[on];
    const matches = exactMatches(input.pages, term);
    if (matches.length === 1) return { kind: "matched", page: matches[0], on };
  }

  return { kind: "pick", query: (input.label.trim() || input.name).trim() };
}
