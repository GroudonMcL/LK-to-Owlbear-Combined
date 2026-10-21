// Links on the map itself: page names in notes and Text items, underlined in
// the text and clickable. One switch per browser, in localStorage, on by
// default. For the GM it also writes the underlines; players only get the
// click areas, since the GM's underlines are in the notes everyone sees.

import { useEffect, useState } from "react";
import type { LayoutOptions } from "./textLayout";

export interface SceneLinkSettings {
  enabled: boolean;
}

export const DEFAULT_SCENE_LINK_SETTINGS: SceneLinkSettings = { enabled: true };

/** How Owlbear sets headings, lists and paragraphs, as measured against its notes and text. */
export const LAYOUT: LayoutOptions = { heading1: 1.8, heading2: 1.35, listIndent: 2.2, paragraphGap: 0.05 };

// v1 held the test settings (underline style, badges, line-up sliders); they are dropped.
const KEY = "lkob.sceneLinks.v2";
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
