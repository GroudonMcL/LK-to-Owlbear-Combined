// Unlinked Owlbear tokens whose name or label looks like a page's title, so
// the GM can reuse a token they placed by hand instead of importing a second.

import { LINK_KEY } from "./links";

export interface SimilarCandidate {
  id: string;
  name: string;
  /** The token's visible label, "" when it has none. */
  label: string;
  metadata: Record<string, unknown>;
}

export interface SimilarToken {
  id: string;
  /** The token text that matched: its label, or else its name. */
  matched: string;
}

const STOP_WORDS = new Set(["a", "an", "the", "of", "and", "token", "png", "jpg", "jpeg", "webp"]);

/** Words of a name, ignoring case, punctuation, file extensions and filler words. */
export function nameWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.(png|jpe?g|webp|gif|svg)$/, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/**
 * Two names are similar when they are the same words up to small typos, or
 * every word of the shorter (at least 3 letters in all) is a word of the
 * longer: "Tiamat" ~ "Tiamat (God Template clip)", "Goblin" ~ "Goblin Boss".
 */
export function similarNames(a: string, b: string): boolean {
  const wa = nameWords(a);
  const wb = nameWords(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const ja = wa.join(" ");
  const jb = wb.join(" ");
  if (ja === jb) return true;
  const longest = Math.max(ja.length, jb.length);
  if (longest >= 5 && editDistance(ja, jb) <= Math.floor(longest / 6)) return true;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (short.join("").length < 3) return false;
  return short.every((w) => long.includes(w));
}

/** Unlinked tokens similar to any of `names` (a page's title and aliases), best first. */
export function findSimilarTokens(tokens: SimilarCandidate[], names: string[], limit = 6): SimilarToken[] {
  const wanted = names.filter((n) => nameWords(n).length > 0);
  const found: { token: SimilarToken; exact: boolean }[] = [];
  for (const token of tokens) {
    if (token.metadata[LINK_KEY] !== undefined) continue;
    for (const text of [token.label, token.name]) {
      if (!text.trim() || !wanted.some((n) => similarNames(text, n))) continue;
      const exact = wanted.some((n) => nameWords(n).join(" ") === nameWords(text).join(" "));
      found.push({ token: { id: token.id, matched: text.trim() }, exact });
      break;
    }
  }
  // Exact matches first; otherwise scene order.
  return found
    .sort((x, y) => Number(y.exact) - Number(x.exact))
    .slice(0, limit)
    .map((f) => f.token);
}
