import { NAMESPACE } from "../lib/links";

export const EDITOR_MODAL_ID = `${NAMESPACE}/editor`;
export const PLACE_TOOL_ID = `${NAMESPACE}/place-tool`;
export const PLACE_MODE_ID = `${NAMESPACE}/place-mode`;
export const IMPORT_MENU_ID = `${NAMESPACE}/import`;
export const OPEN_MENU_ID = `${NAMESPACE}/open`;
export const LINK_MENU_ID = `${NAMESPACE}/link`;
export const PICKER_MODAL_ID = `${NAMESPACE}/picker`;
export const TAB_MODAL_ID = `${NAMESPACE}/tab`;
export const PANEL_POPOVER_ID = `${NAMESPACE}/panel`;
export const TEXT_MENU_ID = `${NAMESPACE}/text-pages`;
export const SHARE_MODAL_ID = `${NAMESPACE}/share-request`;
export const ACCESS_MODAL_ID = `${NAMESPACE}/access-request`;

/** Local broadcast channels between this extension's frames. */
export const CH_PLACE = `${NAMESPACE}/place`;
export const CH_TOKEN_CREATED = `${NAMESPACE}/token-created`;
/** The page list was reloaded on purpose ("Refresh page list"): match again. */
export const CH_PAGES_REFRESHED = `${NAMESPACE}/pages-refreshed`;

/** Between browsers in the room: open a page for everyone, and a player asking the GM to. */
export const CH_SHARE_OPEN = `${NAMESPACE}/share-open`;
export const CH_SHARE_REQUEST = `${NAMESPACE}/share-request`;
/** Between browsers in the room: a player asks to search and make tokens, and the GM's answer. */
export const CH_ACCESS_REQUEST = `${NAMESPACE}/access-request`;
export const CH_ACCESS_ANSWER = `${NAMESPACE}/access-answer`;
/** Between browsers in the room: the GM had the server rebuild the page lists. */
export const CH_PAGE_LIST_REBUILT = `${NAMESPACE}/page-list-rebuilt`;

/** Absolute URL of one of this extension's pages or assets. */
export function extensionUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(path, window.location.href);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  return url.toString();
}
