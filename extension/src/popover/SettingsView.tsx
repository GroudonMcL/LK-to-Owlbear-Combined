import type { HealthResponse, ProjectsResponse } from "@lkob/shared";
import { ArrowLeft, Check, Eye, EyeOff, PlugZap, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiClient, describeError } from "../lib/api";
import { LINK_KEY } from "../lib/links";
import { loadPageList } from "../lib/pageLists";
import { publishProject } from "../lib/project";
import { isConfigured, SAME_ORIGIN_BACKEND, saveSettings, useSettings, type Settings } from "../lib/settings";
import { CH_PAGES_REFRESHED } from "../platform/channels";
import type { Platform } from "../platform/types";
import { Banner, Button, Field, IconButton, Segmented } from "../ui/components";
import { OpenModeField } from "./OpenModeField";
import { useSceneLinks } from "./useSceneLinks";

type Connection =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; health: HealthResponse; projects: ProjectsResponse }
  | { kind: "error"; message: string };

export function SettingsView({ platform, onDone }: { platform: Platform; onDone: () => void }) {
  const settings = useSettings();
  const [url, setUrl] = useState(settings.backendUrl);
  const [key, setKey] = useState(settings.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [refresh, setRefresh] = useState<{ kind: "idle" | "busy" } | { kind: "done" | "error"; message: string }>({ kind: "idle" });
  const [connection, setConnection] = useState<Connection>({ kind: "idle" });
  const sceneLinks = useSceneLinks(platform);
  const [clearing, setClearing] = useState(false);

  const connect = async (backendUrl = url, apiKey = key) => {
    const cleanUrl = backendUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(cleanUrl)) {
      setConnection({ kind: "error", message: "Enter the server URL, starting with https://" });
      return;
    }
    setConnection({ kind: "testing" });
    const api = new ApiClient({ backendUrl: cleanUrl, apiKey: apiKey.trim() });
    try {
      const health = await api.health();
      const projects = await api.projects(true);
      saveSettings({ backendUrl: cleanUrl, apiKey: apiKey.trim() });
      setConnection({ kind: "ok", health, projects });
      // A key opens exactly one project, which is selected automatically.
      const project = projects.projects[0];
      if (project && (settings.projectId !== project.id || settings.projectName !== project.name)) selectProject(project);
      if (!health.tokenHosting && settings.hosting === "backend") saveSettings({ hosting: "owlbear" });
    } catch (err) {
      setConnection({ kind: "error", message: describeError(err) });
    }
  };

  // Re-check an existing connection when settings open.
  useEffect(() => {
    if (settings.backendUrl && settings.apiKey) void connect(settings.backendUrl, settings.apiKey);
  }, []);

  const update = (patch: Partial<Settings>) => saveSettings(patch);
  // The room learns the project too, so players can open its public pages.
  function selectProject(p: { id: string; name: string }) {
    const next = saveSettings({ projectId: p.id, projectName: p.name });
    void publishProject(platform, next).catch(() => undefined);
  }
  const selected = connection.kind === "ok" ? connection.projects.projects.find((p) => p.id === settings.projectId) : undefined;

  const forget = () => {
    saveSettings({ apiKey: "", projectId: "", projectName: "" });
    setKey("");
    setConnection({ kind: "idle" });
  };

  // Reloads the page list now (it is otherwise cached for a minute) and tells
  // the background page and other open frames to re-match against it.
  const refreshPages = async () => {
    setRefresh({ kind: "busy" });
    try {
      const list = await loadPageList(platform, "GM", true);
      await platform.sendLocal(CH_PAGES_REFRESHED, {}).catch(() => undefined);
      const count = `${list.pages.length} page${list.pages.length === 1 ? "" : "s"}`;
      setRefresh({ kind: "done", message: `${count} loaded${list.truncated ? " (the list stops at 5,000)" : ""}.` });
    } catch (err) {
      setRefresh({ kind: "error", message: describeError(err) });
    }
  };
  const hostingAvailable = connection.kind !== "ok" || connection.health.tokenHosting;
  const invalidCount = sceneLinks?.invalid.length ?? 0;
  const linkedCount = sceneLinks ? [...sceneLinks.byPage.values()].reduce((n, l) => n + l.length, 0) : 0;

  const clearInvalid = async () => {
    if (!sceneLinks) return;
    setClearing(true);
    try {
      await platform.updateItems(
        sceneLinks.invalid.map((i) => i.item.id),
        (items) => items.forEach((i) => delete i.metadata[LINK_KEY]),
      );
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="stack" style={{ height: "100%" }}>
      <div className="row">
        {isConfigured(settings) && (
          <IconButton label="Back" onClick={onDone}>
            <ArrowLeft />
          </IconButton>
        )}
        <h1 className="title" style={{ fontSize: 15 }}>
          Settings
        </h1>
      </div>

      <div className="scroll stack" style={{ flex: 1, minHeight: 0, paddingBottom: 6 }}>
        <section className="card stack">
          <div className="eyebrow">LegendKeeper connection</div>
          {(() => {
            const urlField = (
              <Field
                label="Server URL"
                htmlFor="backend-url"
                hint="This extension's server, which passes your requests on to LegendKeeper. It doesn't store your key."
              >
                <input
                  id="backend-url"
                  className="input"
                  placeholder="https://lk-to-owlbear.example.workers.dev"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                  autoComplete="url"
                />
              </Field>
            );
            if (!SAME_ORIGIN_BACKEND) return urlField;
            // The deployed extension talks to its own host; the URL only matters for unusual setups.
            return (
              <details className="small">
                <summary className="faint" style={{ cursor: "pointer" }}>
                  Server: this extension's host. Change…
                </summary>
                <div style={{ paddingTop: 8 }}>{urlField}</div>
              </details>
            );
          })()}
          <Field
            label="LegendKeeper API key"
            htmlFor="api-key"
            hint="Project Settings → Developers → API Keys in LegendKeeper. Kept only in this browser, never in the room, so players can't see it."
          >
            <div className="row">
              <input
                id="api-key"
                className="input"
                type={showKey ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste your API key"
                spellCheck={false}
                autoComplete="off"
              />
              <IconButton label={showKey ? "Hide key" : "Show key"} onClick={() => setShowKey((s) => !s)}>
                {showKey ? <EyeOff /> : <Eye />}
              </IconButton>
            </div>
          </Field>
          <div className="row">
            <Button
              variant={connection.kind === "ok" ? "default" : "primary"}
              icon={connection.kind === "ok" ? <Check /> : <PlugZap />}
              loading={connection.kind === "testing"}
              onClick={() => void connect()}
              disabled={!url.trim() || !key.trim()}
              block
            >
              {connection.kind === "ok" ? "Connected · test again" : "Connect"}
            </Button>
            {settings.apiKey && (
              <Button icon={<Trash2 />} onClick={forget}>
                Forget key
              </Button>
            )}
          </div>
          {connection.kind === "error" && <Banner tone="danger" title="Connection failed">{connection.message}</Banner>}

          {connection.kind === "ok" && selected && (
            <Field label="Project" hint="An API key opens exactly one LegendKeeper project.">
              <div className="check card" style={{ padding: "9px 11px" }}>
                <span style={{ flex: 1 }}>{selected.name}</span>
                <span className="faint small">{selected.isPublic ? "public" : "private"}</span>
              </div>
            </Field>
          )}

          {isConfigured(settings) && (
            <Field label="Page list" hint="Pages are matched against tokens and scene text. The list refreshes itself every minute.">
              <Button icon={<RefreshCw />} loading={refresh.kind === "busy"} onClick={() => void refreshPages()}>
                Refresh page list
              </Button>
              {refresh.kind === "done" && <div className="small faint" style={{ marginTop: 6 }}>{refresh.message}</div>}
              {refresh.kind === "error" && <Banner tone="danger">{refresh.message}</Banner>}
            </Field>
          )}
        </section>

        <section className="card stack">
          <div className="eyebrow">Opening pages</div>
          <OpenModeField isPublic={selected?.isPublic} />
        </section>

        <section className="card stack">
          <div className="eyebrow">Token defaults</div>
          <Field
            label="Token image hosting"
            hint={
              settings.hosting === "backend"
                ? "The finished token is stored on this extension's server and placed straight away."
                : "Owlbear asks where to save the token in your Owlbear storage. Drag it from Assets onto the map and it links to its page."
            }
          >
            <Segmented
              label="Token image hosting"
              fill
              value={settings.hosting}
              onChange={(hosting) => update({ hosting })}
              options={[
                { value: "backend", label: hostingAvailable ? "Extension server" : "Server (off)" },
                { value: "owlbear", label: "Owlbear storage" },
              ]}
            />
          </Field>
          {!hostingAvailable && settings.hosting === "backend" && (
            <Banner tone="warn">Token hosting is turned off on this server. Choose Owlbear storage.</Banner>
          )}
          <Field label="Placement">
            <Segmented
              label="Placement"
              fill
              value={settings.placement}
              onChange={(placement) => update({ placement })}
              options={[
                { value: "center", label: "Centre of view" },
                { value: "manual", label: "Click to place" },
              ]}
            />
          </Field>
          <Field label="Token resolution">
            <Segmented
              label="Token resolution"
              fill
              value={settings.exportSize}
              onChange={(exportSize) => update({ exportSize })}
              options={[
                { value: 256, label: "256 px" },
                { value: 512, label: "512 px" },
                { value: 1024, label: "1024 px" },
              ]}
            />
          </Field>
          <Field label="Gargantuan footprint" hint="Squares per side for Gargantuan creatures.">
            <Segmented
              label="Gargantuan footprint"
              fill
              value={settings.gargantuanCells}
              onChange={(gargantuanCells) => update({ gargantuanCells })}
              options={[4, 5, 6, 8].map((n) => ({ value: n, label: `${n}×${n}` }))}
            />
          </Field>
        </section>

        <section className="card stack">
          <div className="eyebrow row">
            <ShieldCheck size={12} /> Scene links
          </div>
          {sceneLinks ? (
            <div className="small muted">
              {linkedCount} linked token{linkedCount === 1 ? "" : "s"} for {sceneLinks.byPage.size} page
              {sceneLinks.byPage.size === 1 ? "" : "s"} in this scene.
            </div>
          ) : (
            <div className="small faint">Open a scene to see its links.</div>
          )}
          {invalidCount > 0 && (
            <Banner
              tone="warn"
              title={`${invalidCount} token${invalidCount > 1 ? "s have" : " has"} unreadable link data`}
              actions={
                <Button size="sm" icon={<Trash2 />} loading={clearing} onClick={clearInvalid}>
                  Remove link data
                </Button>
              }
            >
              {sceneLinks!.invalid.slice(0, 3).map((i) => `${i.item.name || "Unnamed"}: ${i.reason}`).join(" ")}
            </Banner>
          )}
        </section>
      </div>

      {isConfigured(settings) && (
        <Button variant="primary" block onClick={onDone}>
          Done
        </Button>
      )}
    </div>
  );
}
