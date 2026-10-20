// Every LegendKeeper page named in the scene's notes and Text items, grouped by
// the item it was found in. Clicking a page opens it; clicking an item's name
// shows the item on the map.

import { MapPinned, Type } from "lucide-react";
import { describeOpenError, openTextMatch } from "../lib/open";
import type { Platform } from "../platform/types";
import { Banner, Empty, Spinner } from "../ui/components";
import { TextMatchList } from "../ui/TextMatchList";
import type { TextMatchState } from "../ui/useTextMatches";

export function SceneTextView({ platform, state }: { platform: Platform; state: TextMatchState }) {
  if (state.kind === "loading") {
    return (
      <div className="row small muted">
        <Spinner /> Reading the scene's notes and text…
      </div>
    );
  }
  if (state.kind === "no-scene") {
    return (
      <Empty icon={<MapPinned />} title="No scene open">
        Open a scene to see the pages its notes and text mention.
      </Empty>
    );
  }
  if (state.kind === "error") return <Banner tone="warn">{state.message}</Banner>;
  if (state.groups.length === 0) {
    return (
      <div className="howto">
        <Type aria-hidden />
        <span>
          Write a page's name or alias in a <strong>note</strong> or <strong>text</strong> on the map and it shows up here, and
          in the item's right-click menu under <strong>LegendKeeper pages</strong>.
        </span>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <TextMatchList
        groups={state.groups}
        onOpen={(page) =>
          void openTextMatch(platform, { resourceId: page.id, name: page.name }).catch((err: unknown) =>
            platform.notify(describeOpenError(err), "ERROR"),
          )
        }
        onFocusItem={(id) => void platform.selectAndFocus([id]).catch(() => undefined)}
      />
    </div>
  );
}

/** How many different pages the scene names, for a tab label; empty when none. */
export function matchSummary(state: TextMatchState): string {
  if (state.kind !== "ready") return "";
  const pages = new Set(state.groups.flatMap((g) => g.pages.map((p) => p.id))).size;
  return pages ? String(pages) : "";
}
