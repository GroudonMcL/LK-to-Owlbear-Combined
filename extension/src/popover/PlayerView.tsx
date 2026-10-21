// What players see in the toolbar popover. Players open token pages from the
// context menu, see the public pages named in the scene's notes and text,
// choose where pages open, and, once the GM allows it, make tokens from
// public pages.

import type { PageList } from "@lkob/shared";
import { BookOpen, Link2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadPageList, PageListError } from "../lib/pageLists";
import { playerApi, usePlayerAccess } from "../lib/playerAccess";
import { CH_PAGES_REFRESHED } from "../platform/channels";
import type { Platform } from "../platform/types";
import { getRoomProject } from "../lib/project";
import { Banner, Button, Spinner } from "../ui/components";
import { PageListStatusLine } from "../ui/PageListStatusLine";
import type { TextMatchState } from "../ui/useTextMatches";
import { OpenModeField } from "./OpenModeField";
import { PageView } from "./PageView";
import { PlayerTokens } from "./PlayerTokens";
import type { PageRef } from "./SearchView";
import { SceneLinksField } from "./SceneLinksField";
import { SceneTextView } from "./SceneTextView";

export function PlayerView({ platform, textMatches }: { platform: Platform; textMatches: TextMatchState }) {
  const [list, setList] = useState<PageList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [projectId, setProjectId] = useState("");
  const access = usePlayerAccess(platform);
  const [page, setPage] = useState<PageRef | null>(null);
  const pass = access.status === "granted" ? access.pass : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new client only for a new pass
  const api = useMemo(() => playerApi(access), [pass]);

  useEffect(() => {
    void getRoomProject(platform)
      .then((p) => setProjectId(p?.id ?? ""))
      .catch(() => undefined);
  }, [platform]);

  const load = async (fresh = false) => {
    try {
      setList(await loadPageList(platform, "PLAYER", fresh));
      setError(null);
    } catch (err) {
      setError(err instanceof PageListError ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
  }, [platform]);

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
    await platform.sendLocal(CH_PAGES_REFRESHED, {}).catch(() => undefined);
    setRefreshing(false);
  };

  if (page && api && access.status === "granted") {
    return <PageView key={page.id} api={api} platform={platform} projectId={access.projectId} page={page} role="PLAYER" onBack={() => setPage(null)} />;
  }

  return (
    <div className="scroll stack" style={{ height: "100%" }}>
      <section className="card stack">
        <div className="eyebrow">LegendKeeper pages</div>
        <div className="howto">
          <BookOpen aria-hidden />
          <span>
            Right-click a token and choose <strong>Open LK Page</strong> to read its page.
          </span>
        </div>
        <div className="howto">
          <Link2 aria-hidden />
          <span>
            <strong>Link LK Page…</strong> picks the page yourself. Your choice is kept in this browser.
          </span>
        </div>
        {!list && !error && !projectId && (
          <div className="row small muted">
            <Spinner /> Checking the room's project…
          </div>
        )}
        {projectId && <PageListStatusLine listKey={`public/${projectId}`} />}
        {error && <Banner tone="warn">{error}</Banner>}
        <Button size="sm" icon={<RefreshCw />} loading={refreshing} onClick={() => void refresh()}>
          Refresh page list
        </Button>
      </section>
      <PlayerTokens platform={platform} access={access} list={list} onOpen={setPage} />
      <section className="card stack">
        <div className="eyebrow">Named in this scene</div>
        <SceneTextView platform={platform} state={textMatches} />
      </section>
      <section className="card stack">
        <div className="eyebrow">Opening pages</div>
        <OpenModeField isPublic={list?.isPublic} />
        <SceneLinksField role="PLAYER" />
      </section>
    </div>
  );
}
