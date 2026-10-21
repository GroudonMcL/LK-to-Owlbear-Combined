// The right-click menu's "LegendKeeper pages" embed: the pages found in the
// selected note or Text item. Clicking one opens it. A note's badge opens the
// same list as a popover, naming the item (?item=) and the popover (?popover=).

import { useEffect, useState } from "react";
import { describeOpenError, openTextMatch } from "../lib/open";
import type { Platform } from "../platform/types";
import { Spinner, useTheme } from "../ui/components";
import { TextMatchList } from "../ui/TextMatchList";
import { useTextMatches } from "../ui/useTextMatches";

export function TextMenuApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const state = useTextMatches(platform);
  const params = new URLSearchParams(window.location.search);
  const forItem = params.get("item");
  const popoverId = params.get("popover");
  const [itemId, setItemId] = useState<string | null>(forItem);

  useEffect(() => {
    if (forItem) return;
    void platform
      .getSelection()
      .then((ids) => setItemId(ids[0] ?? null))
      .catch(() => setItemId(null));
  }, [platform, forItem]);

  let body;
  if (state.kind === "loading") {
    body = (
      <div className="row small muted" style={{ padding: 8 }}>
        <Spinner /> Finding pages…
      </div>
    );
  } else if (state.kind === "error") {
    body = <div className="small muted" style={{ padding: 8 }}>{state.message}</div>;
  } else {
    const groups = state.kind === "ready" ? state.groups.filter((g) => g.itemId === itemId) : [];
    body = groups.length ? (
      <TextMatchList
        groups={groups}
        showHeads={false}
        compact
        onOpen={(page) =>
          void openTextMatch(platform, { resourceId: page.id, name: page.name })
            .then(() => (popoverId ? platform.closeSidePanel(popoverId) : undefined))
            .catch((err: unknown) => platform.notify(describeOpenError(err), "ERROR"))
        }
      />
    ) : (
      <div className="small muted" style={{ padding: 8 }}>
        No LegendKeeper pages are named in this text.
      </div>
    );
  }
  return <div className="embed-body scroll">{body}</div>;
}
