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

/** Local broadcast channels between this extension's frames. */
export const CH_PLACE = `${NAMESPACE}/place`;
export const CH_TOKEN_CREATED = `${NAMESPACE}/token-created`;

/** Absolute URL of one of this extension's pages or assets. */
export function extensionUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(path, window.location.href);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  return url.toString();
}
