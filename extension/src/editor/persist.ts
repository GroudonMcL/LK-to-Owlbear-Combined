// Remembers the last frame setup so a session of imports doesn't need
// reconfiguring for every token.

import { DEFAULT_STYLE, FRAME_PRESETS, FRAME_STYLES, SHAPES, type TokenStyle } from "./model";

// v2: new frames and defaults (more outer spacing for the drop shadow).
const KEY = "lkob.editor.style.v2";

export interface SavedLook {
  style: TokenStyle;
  presetId: string | null;
}

export function loadLook(): SavedLook {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SavedLook> | null;
    if (!raw?.style) return { style: DEFAULT_STYLE, presetId: FRAME_PRESETS[0].id };
    const style = { ...DEFAULT_STYLE, ...raw.style };
    if (!SHAPES.some((s) => s.id === style.shape)) style.shape = DEFAULT_STYLE.shape;
    if (!FRAME_STYLES.has(style.frame)) return { style: DEFAULT_STYLE, presetId: FRAME_PRESETS[0].id };
    return { style, presetId: raw.presetId ?? null };
  } catch {
    return { style: DEFAULT_STYLE, presetId: FRAME_PRESETS[0].id };
  }
}

export function saveLook(look: SavedLook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // Not essential.
  }
}
