// The side panel's width, as each person last dragged it, kept in this browser.

const KEY = "lkob.panel-width.v1";
export const DEFAULT_PANEL_WIDTH = 440;

export function loadPanelWidth(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= 320 && n <= 4000 ? n : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

export function savePanelWidth(width: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    // Storage unavailable: the panel opens at the default width next time.
  }
}
