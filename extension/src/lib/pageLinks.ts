// Which page a token opens. The GM's link lives on the token (the same link
// an imported token gets, see links.ts), so everyone shares it. A player's
// own choice stays in their browser and never changes the token.

import { NAMESPACE, parseLink } from "./links";

/** A token's page, as far as opening it is concerned. */
export interface PageLink {
  resourceId: string;
  name: string;
}

/** The GM's link on a token, if it points into `projectId`. */
export function gmLinkFor(metadata: Record<string, unknown> | undefined, projectId: string): PageLink | undefined {
  const parsed = parseLink(metadata);
  if (parsed?.status !== "valid" || parsed.link.projectId !== projectId) return undefined;
  return { resourceId: parsed.link.resourceId, name: parsed.link.title };
}

const playerLinksKey = (roomId: string) => `${NAMESPACE}/player-links/${roomId}`;

function readLinks(roomId: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(localStorage.getItem(playerLinksKey(roomId)) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A player's own link for a token, kept only in their browser. */
export function getPlayerLink(roomId: string, itemId: string): PageLink | undefined {
  return asPageLink(readLinks(roomId)[itemId]);
}

export function setPlayerLink(roomId: string, itemId: string, link: PageLink | undefined): void {
  const links = readLinks(roomId);
  if (link) links[itemId] = { resourceId: link.resourceId, name: link.name };
  else delete links[itemId];
  try {
    localStorage.setItem(playerLinksKey(roomId), JSON.stringify(links));
  } catch {
    // Storage unavailable: the choice lasts only for this page load.
  }
}

/** Accepts only a well-formed PageLink, since storage holds untyped data. */
export function asPageLink(value: unknown): PageLink | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { resourceId, name } = value as Record<string, unknown>;
  return typeof resourceId === "string" && resourceId && typeof name === "string" ? { resourceId, name } : undefined;
}
