// A player's "Make tokens" section: ask the GM, then search the public pages
// and pick one to make a token from.

import type { PageList } from "@lkob/shared";
import { Hand, Search, Wand2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { searchPages } from "../lib/match";
import { requestAccess, type PlayerAccess } from "../lib/playerAccess";
import type { Platform } from "../platform/types";
import { Banner, Button, IconButton, Spinner } from "../ui/components";
import { PageRow } from "../ui/PageRow";
import type { PageRef } from "./SearchView";

function timeLeft(expiresAt: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000));
  return minutes >= 90 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
}

export function PlayerTokens({
  platform,
  access,
  list,
  onOpen,
}: {
  platform: Platform;
  access: PlayerAccess;
  list: PageList | null;
  onOpen: (page: PageRef) => void;
}) {
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const results = useMemo(() => (list && query.trim() ? searchPages(list.pages, query, 30) : []), [list, query]);

  const ask = async () => {
    setAsking(true);
    try {
      await requestAccess(platform);
      await platform.notify("Asked the GM.", "INFO");
    } catch (err) {
      await platform.notify(`Couldn't ask the GM: ${String(err)}`, "ERROR");
    } finally {
      setAsking(false);
    }
  };

  if (access.status !== "granted") {
    return (
      <section className="card stack">
        <div className="eyebrow">Make tokens</div>
        <div className="howto">
          <Wand2 aria-hidden />
          <span>Search public pages and turn their art into tokens. Your GM needs to allow it first.</span>
        </div>
        {access.status === "pending" ? (
          <div className="row small muted">
            <Spinner /> Waiting for the GM…
          </div>
        ) : (
          <>
            {access.status === "denied" && <div className="small faint">The GM said not now.</div>}
            <Button size="sm" icon={<Hand />} loading={asking} onClick={() => void ask()}>
              Ask the GM
            </Button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="card stack">
      <div className="eyebrow">Make tokens</div>
      <div className="search">
        <Search aria-hidden />
        <input
          className="input"
          type="search"
          placeholder="Search public pages"
          aria-label="Search public pages"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <IconButton className="clear" label="Clear search" onClick={() => setQuery("")}>
            <X />
          </IconButton>
        )}
      </div>
      {!list && (
        <div className="row small muted">
          <Spinner /> Loading pages…
        </div>
      )}
      {list && query.trim() && results.length === 0 && <div className="small faint">No public page matches “{query.trim()}”.</div>}
      {results.length > 0 && (
        <div className="stack" style={{ gap: 2, maxHeight: 260, overflowY: "auto" }}>
          {results.map((p, i) => (
            <PageRow
              key={p.id}
              name={p.name}
              path={p.path}
              iconColor={p.iconColor}
              active={false}
              index={i}
              onClick={() => onOpen({ id: p.id, name: p.name, path: p.path })}
              onHover={() => undefined}
            />
          ))}
        </div>
      )}
      <Banner tone="info">
        Tokens you make are saved to your own Owlbear storage: drag them from Assets onto the map. The GM's permission lasts another{" "}
        {timeLeft(access.expiresAt)}.
      </Banner>
    </section>
  );
}
