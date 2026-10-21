// "Open for everyone": the GM opens a page in every browser in the room; a
// player asks the GM, who approves it in a small dialog. Each browser opens
// the page as it opens any other: in its own panel or tab, and for players
// only if the page is public.

import { CH_SHARE_OPEN, CH_SHARE_REQUEST, extensionUrl, SHARE_MODAL_ID } from "../platform/channels";
import type { Platform } from "../platform/types";
import { openTextMatch } from "./open";
import { loadPageList } from "./pageLists";
import type { SharedPage } from "./sharedPage";

export { parseSharedPage, type SharedPage } from "./sharedPage";

/** The GM: opens the page for everyone else in the room. */
export async function openForEveryone(platform: Platform, page: Omit<SharedPage, "from">): Promise<void> {
  await platform.sendToRoom(CH_SHARE_OPEN, { ...page, from: await platform.playerName().catch(() => "The GM") });
  await platform.notify(`Opened “${page.name}” for everyone.`, "SUCCESS");
}

/** A player: asks the GM to open the page for everyone. */
export async function askToOpenForEveryone(platform: Platform, page: Omit<SharedPage, "from">): Promise<void> {
  await platform.sendToRoom(CH_SHARE_REQUEST, { ...page, from: await platform.playerName().catch(() => "A player") });
  await platform.notify(`Asked the GM to open “${page.name}” for everyone.`, "INFO");
}

/** Someone shared a page: open it here, if it is in this room's project. */
export async function receiveSharedPage(platform: Platform, page: SharedPage): Promise<void> {
  const list = await loadPageList(platform, await platform.getRole());
  if (list.projectId !== page.projectId) return;
  await openTextMatch(platform, { resourceId: page.resourceId, name: page.name });
}

/** The GM's browser: a player asked; show the dialog to approve it. */
export function showShareRequest(platform: Platform, page: SharedPage): Promise<void> {
  const url = extensionUrl("share.html", { project: page.projectId, resource: page.resourceId, name: page.name, from: page.from });
  return platform.openModal(SHARE_MODAL_ID, url, 380, 176);
}
