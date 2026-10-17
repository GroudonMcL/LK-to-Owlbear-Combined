// The Owlbear side panel for "Open LK Page": LegendKeeper's public view of the
// page, framed. The full app (and so editing) refuses to be framed
// (X-Frame-Options: DENY), so it opens in a tab.

import { ChevronLeft, ChevronRight, EyeOff, House, PenLine, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Role } from "../lib/pageLists";
import { publicPageUrl, tabUrl } from "../lib/urls";
import { PANEL_POPOVER_ID } from "../platform/channels";
import type { Platform } from "../platform/types";
import { AppHeader, Empty, IconButton, useTheme } from "../ui/components";
import {
  canGoBack,
  canGoForward,
  frameLoaded,
  INITIAL_FRAME_HISTORY,
  lengthChanged,
  wentBack,
  wentForward,
} from "./frameHistory";

const params = new URLSearchParams(location.search);
const projectId = params.get("project") ?? "";
const resourceId = params.get("resource") ?? "";
const name = params.get("name") ?? "LegendKeeper page";
const hidden = params.get("hidden") === "1";

export function PanelApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const [role, setRole] = useState<Role>("PLAYER");
  useEffect(() => {
    void platform.getRole().then(setRole).catch(() => undefined);
  }, [platform]);

  // The panel only opens for public projects. The GM's link opens the full app, with DM notes.
  const fullPageUrl = tabUrl(role, projectId, resourceId, true);

  return (
    <div className="app">
      <AppHeader title={<span title={name}>{name}</span>} sub="LegendKeeper">
        {role === "GM" ? (
          <a className="btn btn-sm" href={fullPageUrl} target="_blank" rel="noopener noreferrer" title="Open the page in LegendKeeper's editor, in a new tab">
            <PenLine /> Edit in LegendKeeper
          </a>
        ) : (
          <a className="btn btn-sm" href={fullPageUrl} target="_blank" rel="noopener noreferrer" title="Open in a new tab">
            <SquareArrowOutUpRight /> Open in LegendKeeper
          </a>
        )}
        <IconButton label="Close panel" onClick={() => void platform.closeSidePanel(PANEL_POPOVER_ID)}>
          <X />
        </IconButton>
      </AppHeader>
      {hidden ? (
        <main className="app-body">
          <Empty icon={<EyeOff />} title="This page is hidden">
            LegendKeeper's public view can't show “{name}”. Open it in LegendKeeper instead.
          </Empty>
        </main>
      ) : (
        <LkFrame />
      )}
    </div>
  );
}

/** The framed public view, with back, home and forward floating over LegendKeeper's top bar. */
function LkFrame() {
  const home = publicPageUrl(projectId, resourceId);
  const frame = useRef<HTMLIFrameElement>(null);
  const [nav, setNav] = useState(INITIAL_FRAME_HISTORY);

  // Navigations inside the frame don't notify the panel; history.length does change.
  useEffect(() => {
    const timer = setInterval(() => setNav((h) => lengthChanged(h, history.length)), 250);
    return () => clearInterval(timer);
  }, []);

  const back = () => {
    if (!canGoBack(nav)) return;
    setNav(wentBack);
    history.back();
  };
  const forward = () => {
    if (!canGoForward(nav)) return;
    setNav(wentForward);
    history.forward();
  };
  // Reassigning src loads the page afresh, as a new entry after the current one.
  const goHome = () => {
    if (frame.current) frame.current.src = home;
  };

  return (
    <div className="lk-stage">
      <iframe ref={frame} className="lk-frame" title={name} src={home} onLoad={() => setNav((h) => frameLoaded(h, history.length))} />
      <nav className="lk-nav" aria-label="Page navigation">
        <IconButton label="Back" disabled={!canGoBack(nav)} onClick={back}>
          <ChevronLeft />
        </IconButton>
        <IconButton label={`Home: ${name}`} onClick={goHome}>
          <House />
        </IconButton>
        <IconButton label="Forward" disabled={!canGoForward(nav)} onClick={forward}>
          <ChevronRight />
        </IconButton>
      </nav>
    </div>
  );
}
