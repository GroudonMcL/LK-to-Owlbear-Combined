// "Open LK Page" and "Link LK Page…": find a token's page and show it in a
// panel inside Owlbear or in a new tab, following each person's choice.

import type { PageList } from "@lkob/shared";
import type { Item } from "@owlbear-rodeo/sdk";
import { extensionUrl, PANEL_POPOVER_ID, PICKER_MODAL_ID, TAB_MODAL_ID } from "../platform/channels";
import type { Platform } from "../platform/types";
import { createLink, LINK_KEY, parseLink } from "./links";
import { resolveToken } from "./match";
import { getPlayerLink, gmLinkFor, setPlayerLink, type PageLink } from "./pageLinks";
import { loadPageList, PageListError, type Role } from "./pageLists";
import { loadPanelWidth } from "./panelWidth";
import { loadSettings } from "./settings";
import { tokenLabel } from "./token";
import { tabUrl } from "./urls";


export type PickerMode = "open" | "link";

/** "Open LK Page": open the token's page, or the picker when it can't be decided. */
export async function openForToken(platform: Platform, item: Item): Promise<void> {
  const role = await platform.getRole();
  const list = await loadPageList(platform, role);
  const resolution = resolveToken({
    gmLink: gmLinkFor(item.metadata, list.projectId),
    playerLink: role === "PLAYER" ? getPlayerLink(platform.roomId(), item.id) : undefined,
    label: tokenLabel(item),
    name: item.name,
    pages: list.pages,
  });
  switch (resolution.kind) {
    case "linked":
      return openPage(platform, list, role, resolution.link);
    case "matched":
      return openPage(platform, list, role, { resourceId: resolution.page.id, name: resolution.page.name });
    case "pick":
      return openPicker(platform, item.id, resolution.query, "open");
  }
}

/** "Link LK Page…": always ask, starting from the label (or the name). */
export function linkToken(platform: Platform, item: Item): Promise<void> {
  return openPicker(platform, item.id, tokenLabel(item) || item.name, "link");
}

export function openPicker(platform: Platform, itemId: string, query: string, mode: PickerMode): Promise<void> {
  return platform.openModal(PICKER_MODAL_ID, extensionUrl("picker.html", { item: itemId, q: query, mode }), 480, 600);
}

/**
 * Saves a token's page: on the token for the GM (the same link an imported
 * token carries), in this browser for a player.
 */
export async function saveLink(platform: Platform, role: Role, projectId: string, itemId: string, link: PageLink | undefined): Promise<void> {
  if (role === "PLAYER") {
    setPlayerLink(platform.roomId(), itemId, link);
    return;
  }
  await platform.updateItems([itemId], (items) => {
    for (const item of items) {
      if (!link) {
        delete item.metadata[LINK_KEY];
        continue;
      }
      // Re-linking keeps the import id, which guards an import against double-creation.
      const previous = parseLink(item.metadata);
      const importId = previous?.status === "valid" ? previous.link.importId : "";
      item.metadata[LINK_KEY] = { ...createLink(projectId, link.resourceId, link.name, importId) };
    }
  });
}

/** Opens a page in this person's chosen place, applying LegendKeeper's visibility rules. */
export async function openPage(platform: Platform, list: PageList, role: Role, link: PageLink): Promise<void> {
  const entry = list.pages.find((page) => page.id === link.resourceId);
  const name = entry?.name ?? link.name;

  // A public list holds every page an anonymous visitor can see, so a missing one isn't public.
  if (role === "PLAYER" && list.isPublic && !entry) {
    return platform.notify(`"${name}" isn't public, so it can't be shown to players.`, "WARNING");
  }

  // A private project has no public view to frame, so everything opens in a tab.
  const mode = list.isPublic ? loadSettings().openMode : "tab";
  if (mode === "panel") {
    const url = extensionUrl("panel.html", {
      project: list.projectId,
      resource: link.resourceId,
      name,
      public: "1",
      ...(entry?.hidden ? { hidden: "1" } : {}),
    });
    return platform.openSidePanel(PANEL_POPOVER_ID, url, loadPanelWidth());
  }
  return openInTab(platform, tabUrl(role, list.projectId, link.resourceId, list.isPublic), name);
}

/**
 * Opens a page found in a note or Text item, exactly as "Open LK Page" opens a
 * token's page: LegendKeeper's own page, in the side panel or a new tab as
 * each person chose. Players only ever get pages in the public list (which
 * never holds hidden pages), and only the public view.
 */
export async function openTextMatch(platform: Platform, link: PageLink): Promise<void> {
  const role = await platform.getRole();
  const list = await loadPageList(platform, role);
  if (role === "PLAYER" && !list.isPublic) {
    return platform.notify("This LegendKeeper project isn't public, so its pages can't be shown to players.", "WARNING");
  }
  return openPage(platform, list, role, link);
}

/** Opens a page by id, loading the page list first (for the popover's "Open page"). */
export async function openPageById(platform: Platform, link: PageLink): Promise<void> {
  const role = await platform.getRole();
  return openPage(platform, await loadPageList(platform, role), role, link);
}

/**
 * Opens a URL in a new tab. A context menu click doesn't count as a click in
 * this extension's frame, so the browser may block the popup; then a small
 * dialog offers a button to click instead.
 */
export async function openInTab(platform: Platform, url: string, name: string): Promise<void> {
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
    return;
  }
  await platform.openModal(TAB_MODAL_ID, extensionUrl("tab.html", { url, name }), 360, 168);
}

/** A message for any failure of these flows. */
export function describeOpenError(err: unknown): string {
  if (err instanceof PageListError) return err.message;
  return `LegendKeeper: ${err instanceof Error ? err.message : String(err)}`;
}
