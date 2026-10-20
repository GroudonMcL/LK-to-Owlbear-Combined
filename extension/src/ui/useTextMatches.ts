// Live matches between the open scene's notes/Text items and this person's
// page list (the GM's, hidden pages included, or a player's public list).
// Re-checks whenever items change, the scene changes, settings change or a
// new page list arrives.

import type { PageList } from "@lkob/shared";
import type { Item } from "@owlbear-rodeo/sdk";
import { useEffect, useState } from "react";
import { loadPageList, PAGE_LIST_STATUS_KEY, PageListError, readStatus } from "../lib/pageLists";
import { SETTINGS_STORAGE_KEY } from "../lib/settings";
import { PageMatcher, toGroups, type TextMatchGroup } from "../lib/textMatch";
import { CH_PAGES_REFRESHED } from "../platform/channels";
import type { Platform } from "../platform/types";

export type TextMatchState =
  | { kind: "loading" }
  | { kind: "ready"; list: PageList; groups: TextMatchGroup[] }
  | { kind: "no-scene" }
  | { kind: "error"; message: string };

export function useTextMatches(platform: Platform): TextMatchState {
  const [state, setState] = useState<TextMatchState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    let matcher: PageMatcher | null = null;
    let run = 0;

    const update = async (items?: Item[]) => {
      const mine = ++run;
      try {
        if (!(await platform.isSceneReady())) {
          if (alive && mine === run) setState({ kind: "no-scene" });
          return;
        }
        const role = await platform.getRole();
        const [list, sceneItems] = await Promise.all([loadPageList(platform, role), items ?? platform.getItems()]);
        if (!matcher || matcher.pages !== list.pages) matcher = new PageMatcher(list.pages);
        const groups = toGroups(matcher.matchItems(sceneItems));
        if (alive && mine === run) setState({ kind: "ready", list, groups });
      } catch (err) {
        const message = err instanceof PageListError ? err.message : err instanceof Error ? err.message : String(err);
        if (alive && mine === run) setState({ kind: "error", message });
      }
    };

    void update();
    const offItems = platform.onItemsChange((items) => void update(items));
    const offReady = platform.onSceneReadyChange(() => void update());
    // Another frame loaded a new list: match against it (it is shared, so no fetch here).
    const offRefresh = platform.onLocal(CH_PAGES_REFRESHED, () => void update());
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY) void update();
      else if (e.key === PAGE_LIST_STATUS_KEY && readStatus()?.state !== "loading") void update();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      alive = false;
      offItems();
      offReady();
      offRefresh();
      window.removeEventListener("storage", onStorage);
    };
  }, [platform]);

  return state;
}
