// Pages found in the scene's notes and Text items, grouped by item. Shared by
// the toolbar popover and the right-click menu's embed.

import { BookOpen, EyeOff, StickyNote, Type } from "lucide-react";
import type { MatchedPage, TextMatchGroup } from "../lib/textMatch";

export function TextMatchList({
  groups,
  showHeads = true,
  compact = false,
  onOpen,
  onFocusItem,
}: {
  groups: TextMatchGroup[];
  showHeads?: boolean;
  /** Narrow places (the context menu): leave out the matched wording. */
  compact?: boolean;
  onOpen: (page: MatchedPage) => void;
  onFocusItem?: (itemId: string) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.itemId} className="text-group">
          {showHeads && (
            <div className="text-group-head">
              {group.kind === "note" ? <StickyNote aria-label="Note" /> : <Type aria-label="Text" />}
              {onFocusItem ? (
                <button type="button" className="grow grow-btn" title="Show it on the map" onClick={() => onFocusItem(group.itemId)}>
                  {group.label}
                </button>
              ) : (
                <span className="grow">{group.label}</span>
              )}
            </div>
          )}
          {group.pages.map((page) => (
            <button key={page.id} type="button" className="text-link" onClick={() => onOpen(page)} title={`Open “${page.name}”`}>
              <BookOpen aria-hidden />
              <span className="name">{page.name}</span>
              {page.hidden && (
                <span className="badge warn" title="Hidden from players in LegendKeeper">
                  <EyeOff />
                  {!compact && " Hidden"}
                </span>
              )}
              {!compact && page.phrase.toLowerCase() !== page.name.toLowerCase() && <span className="phrase">“{page.phrase}”</span>}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
