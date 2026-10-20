// What players see in the toolbar popover. Importing is for the GM; players
// open token pages from the context menu, see the public pages named in the
// scene's notes and text, and choose where pages open.

import type { PageList } from "@lkob/shared";
import { BookOpen, Link2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { loadPageList, PageListError } from "../lib/pageLists";
import { CH_PAGES_REFRESHED } from "../platform/channels";
import type { Platform } from "../platform/types";
import { Banner, Button, Spinner } from "../ui/components";
import type { TextMatchState } from "../ui/useTextMatches";
import { OpenModeField } from "./OpenModeField";
import { SceneTextView } from "./SceneTextView";

export function PlayerView({ platform, textMatches }: { platform: Platform; textMatches: TextMatchState }) {
  const [list, setList] = useState<PageList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
        {!list && !error && (
          <div className="row small muted">
            <Spinner /> Checking the room's project…
          </div>
        )}
        {list && (
          <div className="small faint">
            {list.projectName}: {list.pages.length} public page{list.pages.length === 1 ? "" : "s"}.
          </div>
        )}
        {error && <Banner tone="warn">{error}</Banner>}
        <Button size="sm" icon={<RefreshCw />} loading={refreshing} onClick={() => void refresh()}>
          Refresh page list
        </Button>
      </section>
      <section className="card stack">
        <div className="eyebrow">Named in this scene</div>
        <SceneTextView platform={platform} state={textMatches} />
      </section>
      <section className="card stack">
        <div className="eyebrow">Opening pages</div>
        <OpenModeField isPublic={list?.isPublic} />
      </section>
    </div>
  );
}
