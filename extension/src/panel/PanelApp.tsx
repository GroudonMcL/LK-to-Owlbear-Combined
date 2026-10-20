// The Owlbear side panel for "Open LK Page" and scene-text links. It shows
// LegendKeeper's public view of the page, framed, or, for the GM, the page as
// read from LegendKeeper's API (hidden pages, secrets and DM notes included).
// The full app (and so editing) refuses to be framed (X-Frame-Options: DENY),
// so it opens in a tab.

import { ArrowLeft, ChevronLeft, ChevronRight, EyeOff, House, PenLine, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Role } from "../lib/pageLists";
import { publicPageUrl, tabUrl } from "../lib/urls";
import { PANEL_POPOVER_ID } from "../platform/channels";
import type { Platform } from "../platform/types";
import { AppHeader, Empty, IconButton, Segmented, useTheme } from "../ui/components";
import { ContentView } from "./ContentView";
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
/** The project has a public view to frame. */
const isPublic = params.get("public") === "1";
/** "content": the page as read from the API (GM only); otherwise the public view. */
const requestedView = params.get("view") === "content" ? "content" : "public";

type View = "content" | "public";

export function PanelApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const [role, setRole] = useState<Role | null>(null);
  const [view, setView] = useState<View>(requestedView);
  // Pages opened from mentions inside the API view, most recent last.
  const [trail, setTrail] = useState<{ resourceId: string; name: string }[]>([]);
  useEffect(() => {
    void platform
      .getRole()
      .then(setRole)
      .catch(() => setRole("PLAYER"));
  }, [platform]);

  const current = trail.at(-1) ?? { resourceId, name };
  const currentHidden = trail.length ? false : hidden;
  // Players only ever get the public view. The GM gets the API view where the public view can't help.
  const effective: View = role === "GM" && (view === "content" || !isPublic || currentHidden) ? "content" : "public";
  const canSwitch = role === "GM" && isPublic && !currentHidden && trail.length === 0;

  // The GM's link opens the full app, with DM notes.
  const fullPageUrl = tabUrl(role ?? "PLAYER", projectId, current.resourceId, isPublic);

  let body;
  if (role === null) body = <main className="app-body" />;
  else if (effective === "content") {
    body = (
      <main className="app-body" style={{ padding: 0 }}>
        <ContentView
          key={current.resourceId}
          projectId={projectId}
          resourceId={current.resourceId}
          hidden={currentHidden}
          onMention={(id, label) => setTrail((t) => [...t, { resourceId: id, name: label }])}
        />
      </main>
    );
  } else if (hidden) {
    body = (
      <main className="app-body">
        <Empty icon={<EyeOff />} title="This page is hidden">
          LegendKeeper's public view can't show “{name}”. Open it in LegendKeeper instead.
        </Empty>
      </main>
    );
  } else body = <LkFrame />;

  return (
    <div className="app">
      <AppHeader title={<span title={current.name}>{current.name}</span>} sub="LegendKeeper">
        {trail.length > 0 && (
          <IconButton label="Back" onClick={() => setTrail((t) => t.slice(0, -1))}>
            <ArrowLeft />
          </IconButton>
        )}
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
      {canSwitch && (
        <div style={{ padding: "6px 12px 0" }}>
          <Segmented
            label="Show"
            fill
            value={effective}
            onChange={setView}
            options={[
              { value: "content", label: "Full page (GM)" },
              { value: "public", label: "Public view" },
            ]}
          />
        </div>
      )}
      {body}
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
