// Back and forward for the framed LegendKeeper page. The page is cross-origin,
// so the panel can't read its URL or its history; but the tab has one joint
// session history, so the panel's own history.back()/forward() step through
// the frame's navigations, and history.length shows when it adds entries.
//
// The one thing that must never happen is stepping back past the frame's first
// page, which would navigate Owlbear itself. So `pos` (entries the frame has
// added since it first loaded, up to where we stand) is kept at or below the
// truth: it is reset from history.length whenever that changes, and otherwise
// moves only with our own back/forward clicks.

export interface FrameHistory {
  /** history.length when the frame first loaded; null until then. */
  base: number | null;
  pos: number;
  length: number;
}

export const INITIAL_FRAME_HISTORY: FrameHistory = { base: null, pos: 0, length: 0 };

/** The frame's first page has loaded: entries from here on are the frame's. */
export function frameLoaded(h: FrameHistory, length: number): FrameHistory {
  return h.base === null ? { base: length, pos: 0, length } : h;
}

/**
 * history.length changed. It only grows when we stood at the newest entry, and
 * a navigation after going back truncates then adds one, so either way we now
 * stand at the newest entry.
 */
export function lengthChanged(h: FrameHistory, length: number): FrameHistory {
  if (h.base === null || length === h.length) return h;
  return { ...h, pos: Math.max(0, length - h.base), length };
}

export const canGoBack = (h: FrameHistory) => h.base !== null && h.pos > 0;
export const canGoForward = (h: FrameHistory) => h.base !== null && h.pos < h.length - h.base;

export const wentBack = (h: FrameHistory): FrameHistory => (canGoBack(h) ? { ...h, pos: h.pos - 1 } : h);
export const wentForward = (h: FrameHistory): FrameHistory => (canGoForward(h) ? { ...h, pos: h.pos + 1 } : h);
