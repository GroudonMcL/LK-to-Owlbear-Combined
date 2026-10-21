// Test settings for links drawn on the map itself: page names in notes and
// Text items, underlined and clickable. Per browser, in localStorage, like the
// other settings; everyone (GM and players) has their own.

import { useEffect, useState } from "react";

/**
 * How linked words are marked:
 * - "overlay": lines the extension draws over the words, for this person only;
 * - "rich": a real underline written into the note's text (GM only; everyone sees it);
 * - "none": no marks.
 */
export type UnderlineStyle = "overlay" | "rich" | "none";

export interface SceneLinkSettings {
  /** Master switch for everything on the map. */
  enabled: boolean;
  underline: UnderlineStyle;
  /** Option B: click an underlined word to open its page. */
  clickWords: boolean;
  /** Option C: a book badge on the corner of each note or text that names pages. */
  badge: boolean;
  /** Overlay underline colour and opacity. */
  color: string;
  opacity: number;
  /** Overlay underline thickness, in em. */
  thickness: number;
  /** Moves the overlay underline down (+) or up (−), in em. */
  offset: number;
  /** Calibration for the word layout, which has to guess how Owlbear sets text. */
  textScale: number;
  heading1: number;
  heading2: number;
  /** List indent, in em. */
  listIndent: number;
  /** Extra space after each paragraph, in em. */
  paragraphGap: number;
  /** Shows the click areas, to check the layout lines up. */
  showBoxes: boolean;
}

export const DEFAULT_SCENE_LINK_SETTINGS: SceneLinkSettings = {
  enabled: true,
  underline: "overlay",
  clickWords: true,
  badge: false,
  color: "#9e9e9e",
  opacity: 0.9,
  thickness: 0.07,
  offset: 0,
  textScale: 1,
  heading1: 2,
  heading2: 1.5,
  listIndent: 1.5,
  paragraphGap: 0,
  showBoxes: false,
};

const KEY = "lkob.sceneLinks.v1";
const EVENT = "lkob-scene-links";
export const SCENE_LINK_SETTINGS_KEY = KEY;

export function loadSceneLinkSettings(): SceneLinkSettings {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SceneLinkSettings>) : {};
    return { ...DEFAULT_SCENE_LINK_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SCENE_LINK_SETTINGS };
  }
}

export function saveSceneLinkSettings(update: Partial<SceneLinkSettings>): SceneLinkSettings {
  const next = { ...loadSceneLinkSettings(), ...update };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be blocked (private mode); settings then last for this page only.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
  return next;
}

export function resetSceneLinkSettings(): SceneLinkSettings {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
  return loadSceneLinkSettings();
}

export function useSceneLinkSettings(): SceneLinkSettings {
  const [settings, setSettings] = useState(loadSceneLinkSettings);
  useEffect(() => {
    const refresh = () => setSettings(loadSceneLinkSettings());
    const onStorage = (e: StorageEvent) => e.key === KEY && refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return settings;
}
