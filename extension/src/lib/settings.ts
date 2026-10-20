// Per-browser settings, in localStorage only (never in the room or scene, so
// players can't read them). The connection and token defaults are the GM's;
// the open mode is everyone's. The GM's LegendKeeper API key is pasted here
// and sent, per request, to this extension's server, which relays it to
// LegendKeeper (LegendKeeper refuses calls from browser pages) without storing it.

import { useEffect, useState } from "react";

export type TokenHosting = "backend" | "owlbear";
export type Placement = "center" | "manual";
/** Where "Open LK Page" shows a page: a panel inside Owlbear, or a new browser tab. */
export type OpenMode = "panel" | "tab";

export interface Settings {
  backendUrl: string;
  /** The GM's LegendKeeper API key. */
  apiKey: string;
  projectId: string;
  projectName: string;
  hosting: TokenHosting;
  placement: Placement;
  exportSize: 256 | 512 | 1024;
  /** Squares per side for Gargantuan creatures. */
  gargantuanCells: number;
  openMode: OpenMode;
}

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: "",
  apiKey: "",
  projectId: "",
  projectName: "",
  hosting: "backend",
  placement: "center",
  exportSize: 512,
  gargantuanCells: 4,
  openMode: "panel",
};

/**
 * True in the Cloudflare build, where one Worker serves both the extension and
 * its API: the backend is simply this page's own origin.
 */
export const SAME_ORIGIN_BACKEND = import.meta.env.VITE_SAME_ORIGIN_BACKEND === "1";

/** The server players' browsers use: this extension's host, or VITE_BACKEND_URL in development. */
export function defaultBackendUrl(): string {
  return SAME_ORIGIN_BACKEND ? window.location.origin : (import.meta.env.VITE_BACKEND_URL ?? "");
}

function withDefaults(s: Settings): Settings {
  const openMode: OpenMode = s.openMode === "tab" ? "tab" : "panel";
  return { ...s, openMode, backendUrl: s.backendUrl || defaultBackendUrl() };
}

const KEY = "lkob.settings.v1";
const EVENT = "lkob-settings";
export const SETTINGS_STORAGE_KEY = KEY;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return withDefaults({ ...DEFAULT_SETTINGS });
    // Earlier versions kept an access password ("accessToken") instead of a key; it is dropped.
    const { accessToken: _password, ...parsed } = JSON.parse(raw) as Partial<Settings> & { accessToken?: unknown };
    return withDefaults({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return withDefaults({ ...DEFAULT_SETTINGS });
  }
}

export function saveSettings(update: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...update };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be blocked (private mode); settings then last for this page only.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
  return next;
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.backendUrl && s.apiKey && s.projectId);
}

/** Settings that stay current across this frame and other frames of the extension. */
export function useSettings(): Settings {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    const refresh = () => setSettings(loadSettings());
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

// Cross-frame navigation requests, e.g. a context menu asking the popover to open a page.
const NAV_KEY = "lkob.nav.v1";

export interface NavRequest {
  projectId: string;
  resourceId: string;
  title: string;
  at: number;
}

export function requestNavigation(req: Omit<NavRequest, "at">): void {
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify({ ...req, at: Date.now() }));
  } catch {
    // Ignore; the popover simply opens on its last view.
  }
}

/** Returns and clears a navigation request made in the last few seconds. */
export function consumeNavigation(maxAgeMs = 15_000): NavRequest | null {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    if (!raw) return null;
    localStorage.removeItem(NAV_KEY);
    const req = JSON.parse(raw) as NavRequest;
    return Date.now() - req.at <= maxAgeMs ? req : null;
  } catch {
    return null;
  }
}

export const NAV_STORAGE_KEY = NAV_KEY;
