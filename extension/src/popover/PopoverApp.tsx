import { Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient } from "../lib/api";
import { consumeNavigation, isConfigured, NAV_STORAGE_KEY, useSettings } from "../lib/settings";
import type { Platform } from "../platform/types";
import { getRoomProject } from "../lib/project";
import { AppHeader, IconButton, Segmented, Spinner, useTheme } from "../ui/components";
import { useTextMatches } from "../ui/useTextMatches";
import { PageView } from "./PageView";
import { PlayerView } from "./PlayerView";
import { matchSummary, SceneTextView } from "./SceneTextView";
import { SearchView, type PageRef } from "./SearchView";
import { SettingsView } from "./SettingsView";

type View = { kind: "search" } | { kind: "scene" } | { kind: "page"; page: PageRef } | { kind: "settings" };

export function PopoverApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const settings = useSettings();
  const [role, setRole] = useState<"GM" | "PLAYER" | null>(null);
  const [view, setView] = useState<View>(() => (isConfigured(settings) ? { kind: "search" } : { kind: "settings" }));
  const [query, setQuery] = useState("");
  const [roomProjectName, setRoomProjectName] = useState("");
  const textMatches = useTextMatches(platform);

  const api = useMemo(
    () => (settings.backendUrl && settings.accessToken ? new ApiClient(settings) : null),
    [settings.backendUrl, settings.accessToken],
  );

  useEffect(() => {
    void platform.getRole().then(setRole).catch(() => setRole("GM"));
  }, [platform]);

  // Players have no settings of their own: the room says which project the GM chose.
  useEffect(() => {
    if (role !== "PLAYER") return;
    void getRoomProject(platform).then((p) => setRoomProjectName(p?.name ?? "")).catch(() => undefined);
  }, [platform, role]);

  // A context menu can ask us to open a page for a linked token.
  useEffect(() => {
    const takeNav = () => {
      const nav = consumeNavigation();
      if (!nav) return;
      if (settings.projectId && nav.projectId !== settings.projectId) {
        void platform.notify("That token is linked to a different LegendKeeper project than the one selected.", "WARNING");
        return;
      }
      setView({ kind: "page", page: { id: nav.resourceId, name: nav.title || "Linked page", path: [] } });
    };
    takeNav();
    const onStorage = (e: StorageEvent) => e.key === NAV_STORAGE_KEY && e.newValue && takeNav();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [platform, settings.projectId]);

  const openPage = useCallback((page: PageRef) => setView({ kind: "page", page }), []);
  const ready = isConfigured(settings) && api;

  let body;
  if (role === null) {
    body = (
      <div className="empty">
        <Spinner large />
      </div>
    );
  } else if (role === "PLAYER") {
    body = <PlayerView platform={platform} textMatches={textMatches} />;
  } else if (view.kind === "settings" || !ready) {
    body = <SettingsView platform={platform} onDone={() => setView({ kind: "search" })} />;
  } else if (view.kind === "page") {
    body = (
      <PageView
        key={view.page.id}
        api={api}
        platform={platform}
        projectId={settings.projectId}
        page={view.page}
        onBack={() => setView({ kind: "search" })}
      />
    );
  } else {
    const count = matchSummary(textMatches);
    const tabs = (
      <Segmented
        label="Show"
        fill
        value={view.kind === "scene" ? "scene" : "search"}
        onChange={(kind) => setView({ kind })}
        options={[
          { value: "search", label: "Search" },
          { value: "scene", label: count ? `In this scene (${count})` : "In this scene" },
        ]}
      />
    );
    body =
      view.kind === "scene" ? (
        <div className="stack" style={{ height: "100%" }}>
          {tabs}
          <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
            <SceneTextView platform={platform} state={textMatches} />
          </div>
        </div>
      ) : (
        <div className="stack" style={{ height: "100%" }}>
          {tabs}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <SearchView
        api={api}
        platform={platform}
        projectId={settings.projectId}
        initialQuery={query}
        onQueryChange={setQuery}
        onOpen={openPage}
      />
          </div>
        </div>
      );
  }

  return (
    <div className="app">
      <AppHeader title="LegendKeeper" sub={(role === "PLAYER" ? roomProjectName : settings.projectName) || "for Owlbear Rodeo"}>
        {role === "GM" && view.kind !== "settings" && (
          <IconButton label="Settings" onClick={() => setView({ kind: "settings" })}>
            <SettingsIcon />
          </IconButton>
        )}
      </AppHeader>
      <main className="app-body">{body}</main>
    </div>
  );
}
