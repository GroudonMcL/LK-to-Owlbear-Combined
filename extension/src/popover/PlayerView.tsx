// What players see in the toolbar popover. Importing is for the GM; players
// open token pages from the context menu and choose where they open.

import type { PageList } from "@lkob/shared";
import { BookOpen, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { loadPageList, PageListError } from "../lib/pageLists";
import type { Platform } from "../platform/types";
import { Banner, Spinner } from "../ui/components";
import { OpenModeField } from "./OpenModeField";

export function PlayerView({ platform }: { platform: Platform }) {
  const [list, setList] = useState<PageList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPageList(platform, "PLAYER")
      .then(setList)
      .catch((err) => setError(err instanceof PageListError ? err.message : String(err)));
  }, [platform]);

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
      </section>
      <section className="card stack">
        <div className="eyebrow">Opening pages</div>
        <OpenModeField isPublic={list?.isPublic} />
      </section>
    </div>
  );
}
