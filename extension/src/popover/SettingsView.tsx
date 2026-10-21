import type { HealthResponse, ProjectsResponse } from "@lkob/shared";
import { ArrowLeft, Check, Eye, EyeOff, PlugZap, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiClient, describeError } from "../lib/api";
import { LINK_KEY } from "../lib/links";
import { loadPageList } from "../lib/pageLists";
import { publishProject } from "../lib/project";
import { isConfigured, SAME_ORIGIN_BACKEND, saveSettings, useSettings, type Settings } from "../lib/settings";
import { CH_PAGE_LIST_REBUILT, CH_PAGES_REFRESHED } from "../platform/channels";
import type { Platform } from "../platform/types";
import { Banner, Button, Field, IconButton, Segmented } from "../ui/components";
import { PageListStatusLine } from "../ui/PageListStatusLine";
import { OpenModeField } from "./OpenModeField";
import { SceneLinksField } from "./SceneLinksField";
import { useSceneLinks } from "./useSceneLinks";

type Connection =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; health: HealthResponse; projects: ProjectsResponse }
  | { kind: "error"; message: string };

export function SettingsView({ platform, onDone }: { platform: Platform; onDone: () => void }) {
  const settings = useSettings();
  const [url, setUrl] = useState(settings.backendUrl);
  const [password, setPassword] = useState(settings.accessToken);
  const [showPassword, setShowPassword] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connection, setConnection] = useState<Connection>({ kind: "idle" });
  const sceneLinks = useSceneLinks(platform);
  const [clearing, setClearing] = useState(false);

  const connect = async (backendUrl = url, accessToken = password) => {
    const cleanUrl = backendUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(cleanUrl)) {
      setConnection({ kind: "error", message: "Enter the server URL, starting with https://" });
      return;
    }
    setConnection({ kind: "testing" });
    const api = new ApiClient({ backendUrl: cleanUrl, accessToken: accessToken.trim() });
    try {
      const health = await api.health();
      const projects = await api.projects(true);
      saveSettings({ backendUrl: cleanUrl, accessToken: accessToken.trim() });
      setConnection({ kind: "ok", health, projects });
      // Keep the chosen project if the server still has it; otherwise take the first.
      const project = projects.projects.find((p) => p.id === settings.projectId) ?? projects.projects[0];
      if (project && (settings.projectId !== project.id || settings.projectName !== project.name)) selectProject(project);
      // The server keeps the page list; fetching it is one download (the status line shows it).
      if (project) void loadPageList(platform, "GM").then(announce, () => undefined);
      if (!health.tokenHosting && settings.hosting === "backend") saveSettings({ hosting: "owlbear" });
    } catch (err) {
      setConnection({ kind: "error", message: describeError(err) });
    }
  };

  // Re-check an existing connection when settings open.
  useEffect(() => {
    if (settings.backendUrl && settings.accessToken) void connect(settings.backendUrl, settings.accessToken);
  }, []);

  const update = (patch: Partial<Settings>) => saveSettings(patch);
  // The room learns the project too, so players can open its public pages.
  function selectProject(p: { id: string; name: string }) {
    const next = saveSettings({ projectId: p.id, projectName: p.name });
    void publishProject(platform, next).catch(() => undefined);
  }
  const chooseProject = (p: { id: string; name: string }) => {
    selectProject(p);
    void loadPageList(platform, "GM").then(announce, () => undefined);
  };
  const selected = connection.kind === "ok" ? connection.projects.projects.find((p) => p.id === settings.projectId) : undefined;

  const forget = () => {
    saveSettings({ accessToken: "", projectId: "", projectName: "" });
    setPassword("");
    setConnection({ kind: "idle" });
  };

  // Tells the background page and other open frames to re-match against the new list.
  const announce = () => void platform.sendLocal(CH_PAGES_REFRESHED, {}).catch(() => undefined);

  // Has the server list LegendKeeper again, for everyone; other browsers in the room are told to fetch it.
  const refreshPages = async () => {
    setRefreshing(true);
    try {
      await loadPageList(platform, "GM", true);
      announce();
      void platform.sendToRoom(CH_PAGE_LIST_REBUILT, {}).catch(() => undefined);
    } catch {
      // The status line shows what went wrong.
    } finally {
      setRefreshing(false);
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
                hint="This extension's server, which holds your LegendKeeper API key and passes your requests on to LegendKeeper."
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
            label="Access password"
            htmlFor="access-password"
            hint="The LKOB_ACCESS_TOKENS secret you chose when deploying. Kept only in this browser, never in the room. Your LegendKeeper API key stays on the server."
          >
            <div className="row">
              <input
                id="access-password"
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && url.trim() && password.trim() && void connect()}
                placeholder="Enter your access password"
                spellCheck={false}
                autoComplete="current-password"
              />
              <IconButton label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((s) => !s)}>
                {showPassword ? <EyeOff /> : <Eye />}
              </IconButton>
            </div>
          </Field>
          <div className="row">
            <Button
              variant={connection.kind === "ok" ? "default" : "primary"}
              icon={connection.kind === "ok" ? <Check /> : <PlugZap />}
              loading={connection.kind === "testing"}
              onClick={() => void connect()}
              disabled={!url.trim() || !password.trim()}
              block
            >
              {connection.kind === "ok" ? "Connected · test again" : "Connect"}
            </Button>
            {settings.accessToken && (
              <Button icon={<Trash2 />} onClick={forget}>
                Forget password
              </Button>
            )}
          </div>
          {connection.kind === "error" && <Banner tone="danger" title="Connection failed">{connection.message}</Banner>}

          {connection.kind === "ok" && connection.projects.projects.length > 1 && (
            <Field label="Project" hint="The server holds an API key for each of these projects.">
              <div className="stack" role="radiogroup" aria-label="Project" style={{ gap: 4 }}>
                {connection.projects.projects.map((p) => (
                  <label key={p.id} className="check card" style={{ padding: "9px 11px", cursor: "pointer" }}>
                    <input type="radio" name="project" checked={p.id === settings.projectId} onChange={() => chooseProject(p)} />
                    <span style={{ flex: 1 }}>{p.name}</span>
                    <span className="faint small">{p.isPublic ? "public" : "private"}</span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          {connection.kind === "ok" && connection.projects.projects.length === 1 && selected && (
            <Field label="Project" hint="The project your server's LegendKeeper API key opens.">
              <div className="check card" style={{ padding: "9px 11px" }}>
                <span style={{ flex: 1 }}>{selected.name}</span>
                <span className="faint small">{selected.isPublic ? "public" : "private"}</span>
              </div>
            </Field>
          )}

          {isConfigured(settings) && (
            <Field
              label="Page list"
              hint="Tokens and scene text are matched against it. The server builds it when you deploy and shares it with everyone in the room. Refresh page list has the server list LegendKeeper again, for new or renamed pages."
            >
              <PageListStatusLine listKey={`gm/${settings.projectId}`} />
              <Button icon={<RefreshCw />} loading={refreshing} onClick={() => void refreshPages()} style={{ marginTop: 6 }}>
                Refresh page list
              </Button>
            </Field>
          )}
        </section>

        <section className="card stack">
          <div className="eyebrow">Opening pages</div>
          <OpenModeField isPublic={selected?.isPublic} />
          <SceneLinksField role="GM" />
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
