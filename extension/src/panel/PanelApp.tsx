// The Owlbear side panel for "Open LK Page" and scene-text links. It shows
// LegendKeeper's public view of the page, framed, or, for the GM, the page as
// read from LegendKeeper's API (hidden pages, secrets and DM notes included).
// The full app (and so editing) refuses to be framed (X-Frame-Options: DENY),
// so it opens in a tab.

import { ArrowLeft, ChevronLeft, ChevronRight, EyeOff, House, PenLine, SquareArrowOutUpRight, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Role } from "../lib/pageLists";
import { savePanelWidth } from "../lib/panelWidth";
import { openPicker } from "../lib/open";
import { askToOpenForEveryone, openForEveryone } from "../lib/share";
import { appPageUrl, publicPageUrl, tabUrl } from "../lib/urls";
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
  // The framed public view moved to a page the panel can't name (it's another site).
  const [frameAway, setFrameAway] = useState(false);
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

  // The GM's link opens the full app, with DM notes; players' the public view.
  const fullPageUrl = tabUrl(role ?? "PLAYER", projectId, current.resourceId, isPublic);
  // Everyone may try the editor: LegendKeeper lets in project members who may edit.
  const appUrl = appPageUrl(projectId, current.resourceId);

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
  } else body = <LkFrame onAwayChange={setFrameAway} />;

  return (
    <div className="app">
      <ResizeHandle platform={platform} />
      <AppHeader title={<span title={current.name}>{current.name}</span>} sub="LegendKeeper">
        {trail.length > 0 && (
          <IconButton label="Back" onClick={() => setTrail((t) => t.slice(0, -1))}>
            <ArrowLeft />
          </IconButton>
        )}
        <a className="btn btn-sm btn-collapse" href={appUrl} target="_blank" rel="noopener noreferrer" aria-label="Edit in LegendKeeper" title={role === "GM" ? "Open the page in LegendKeeper's editor, in a new tab" : "Open the page in LegendKeeper's editor, in a new tab (needs edit access to the project)"}>
          <PenLine /> <span className="btn-label">Edit in LegendKeeper</span>
        </a>
        {role !== "GM" && (
          <a className="btn btn-sm btn-collapse" href={fullPageUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in LegendKeeper" title="Open in a new tab">
            <SquareArrowOutUpRight /> <span className="btn-label">Open in LegendKeeper</span>
          </a>
        )}
        <button
          type="button"
          className="btn btn-sm btn-collapse"
          aria-label="Open for everyone"
          disabled={role === null || currentHidden}
          title={
            currentHidden
              ? "This page is hidden from players in LegendKeeper"
              : role === "GM"
                ? "Open this page for everyone in the room"
                : "Ask the GM to open this page for everyone"
          }
          onClick={() => {
            if (effective === "public" && frameAway) {
              void openPicker(platform, "", "", "share");
              return;
            }
            const page = { projectId, resourceId: current.resourceId, name: current.name };
            const share = role === "GM" ? openForEveryone : askToOpenForEveryone;
            void share(platform, page).catch((err: unknown) => platform.notify(`Couldn't share the page: ${String(err)}`, "ERROR"));
          }}
        >
          <Users /> <span className="btn-label">Open for everyone</span>
        </button>
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

/**
 * A grip along the panel's left edge: drag it to make the panel wider or
 * narrower. The panel is pinned to the right, so it grows to the left. The
 * width is remembered in this browser for the next page opened.
 */
function ResizeHandle({ platform }: { platform: Platform }) {
  const drag = useRef<{ startX: number; startWidth: number; width: number; frame: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // screenX doesn't move with the panel as it resizes, unlike clientX.
    drag.current = { startX: e.screenX, startWidth: window.innerWidth, width: window.innerWidth, frame: 0 };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.width = d.startWidth - (e.screenX - d.startX);
    if (d.frame) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      void platform.resizeSidePanel(PANEL_POPOVER_ID, d.width).catch(() => undefined);
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.frame) cancelAnimationFrame(d.frame);
    void platform
      .resizeSidePanel(PANEL_POPOVER_ID, d.width)
      .then(savePanelWidth)
      .catch(() => undefined);
  };

  return (
    <>
      <div
        className="panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the panel"
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {/* Keeps the framed LegendKeeper page from swallowing the pointer mid-drag. */}
      {dragging && <div className="panel-resize-shield" />}
    </>
  );
}

/**
 * The framed public view, with back, home and forward floating over
 * LegendKeeper's top bar. It reports whether the frame has left the page it
 * opened on: the frame is another site, so which page it moved to is unknown.
 */
function LkFrame({ onAwayChange }: { onAwayChange: (away: boolean) => void }) {
  const home = publicPageUrl(projectId, resourceId);
  const frame = useRef<HTMLIFrameElement>(null);
  const [nav, setNav] = useState(INITIAL_FRAME_HISTORY);
  // Per history entry the frame added (index = nav.pos): true where it is the home page.
  const entries = useRef<boolean[]>([true]);
  const lastLength = useRef(0);
  const homePending = useRef(false);

  useEffect(() => {
    if (nav.base === null) return;
    if (nav.length !== lastLength.current) {
      // A new entry: the home button's, or a link followed inside the frame.
      if (lastLength.current !== 0) {
        entries.current = entries.current.slice(0, nav.pos);
        entries.current[nav.pos] = homePending.current;
        homePending.current = false;
      }
      lastLength.current = nav.length;
    }
    onAwayChange(entries.current[nav.pos] !== true);
  }, [nav, onAwayChange]);

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
    homePending.current = true;
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
