// Tokens saved to the GM's Owlbear storage. Owlbear's upload dialog returns
// nothing, so a stored token can't be placed for the GM; instead this browser
// remembers its link, and the background page attaches it when the GM drags
// that asset from Owlbear's Assets panel onto the map.

import { LINK_KEY, type TokenLink } from "./links";

export interface AssetLink {
  /** The asset's name, which an item placed from it carries. */
  name: string;
  link: TokenLink;
  savedAt: number;
}

/** The fields of a scene item this needs. */
export interface PlacedItem {
  id: string;
  type: string;
  name: string;
  createdUserId: string;
  metadata: Record<string, unknown>;
}

const KEY = "lkob.assetLinks.v1";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;

export function loadAssetLinks(now = Date.now()): AssetLink[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as AssetLink[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.name && entry.link && now - entry.savedAt < MAX_AGE_MS) : [];
  } catch {
    return [];
  }
}

/** Remembers a stored token's link; a newer token with the same name replaces it. */
export function rememberAssetLink(name: string, link: TokenLink, now = Date.now()): void {
  const entries = [{ name, link, savedAt: now }, ...loadAssetLinks(now).filter((entry) => entry.name !== name)].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage may be blocked; the token can still be linked with "Link LK Page…".
  }
}

/**
 * Links for items this player just placed from a remembered asset. Items that
 * already carry a link, or were placed by someone else, are left alone.
 */
export function linksForPlacedItems(added: PlacedItem[], entries: AssetLink[], userId: string): { id: string; link: TokenLink }[] {
  const out: { id: string; link: TokenLink }[] = [];
  for (const item of added) {
    if (item.type !== "IMAGE" || item.createdUserId !== userId || item.metadata[LINK_KEY] !== undefined) continue;
    const entry = entries.find((e) => e.name === item.name);
    if (entry) out.push({ id: item.id, link: entry.link });
  }
  return out;
}
