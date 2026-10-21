// "Link LK Page…" and the "Open LK Page" fallback: choose a token's page from
// the page list. A GM's choice is saved on the token for everyone; a player's
// only in their browser. In "share" mode it picks the page to open for
// everyone, when the side panel's framed page has moved to one it can't name.

import type { PageEntry, PageList } from "@lkob/shared";
import { FileQuestion, Link2, Search, Unlink, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { searchPages } from "../lib/match";
import { describeOpenError, openPage, saveLink, type PickerMode } from "../lib/open";
import { askToOpenForEveryone, openForEveryone } from "../lib/share";
import { getPlayerLink, gmLinkFor, type PageLink } from "../lib/pageLinks";
import { loadPageList, type Role } from "../lib/pageLists";
import { PICKER_MODAL_ID } from "../platform/channels";
import type { Platform } from "../platform/types";
import { AppHeader, Banner, Button, Empty, IconButton, Spinner, useTheme } from "../ui/components";
import { PageRow } from "../ui/PageRow";

const params = new URLSearchParams(location.search);
const itemId = params.get("item") ?? "";
const modeParam = params.get("mode");
const mode: PickerMode = modeParam === "link" || modeParam === "share" ? modeParam : "open";

type Current = { link: PageLink; by: "gm" | "player" };

export function PickerApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [role, setRole] = useState<Role>();
  const [list, setList] = useState<PageList>();
  const [error, setError] = useState<string>();
  const [current, setCurrent] = useState<Current>();
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const r = await platform.getRole();
      setRole(r);
      const l = await loadPageList(platform, r);
      setList(l);
      const [item] = (await platform.getItems()).filter((i) => i.id === itemId);
      const gmLink = item ? gmLinkFor(item.metadata, l.projectId) : undefined;
      const playerLink = r === "PLAYER" ? getPlayerLink(platform.roomId(), itemId) : undefined;
      if (gmLink) setCurrent({ link: gmLink, by: "gm" });
      else if (playerLink) setCurrent({ link: playerLink, by: "player" });
    })().catch((err) => setError(describeOpenError(err)));
  }, [platform]);

  // A player can't change a link the GM saved on the token; their choice only opens a page.
  const gmLocked = role === "PLAYER" && current?.by === "gm";
  const results = useMemo(() => (list ? searchPages(list.pages, query) : []), [list, query]);
  useEffect(() => setActive(0), [query]);
  const close = () => void platform.closeModal(PICKER_MODAL_ID);

  const choose = async (page: PageEntry) => {
    if (!role || !list || busy) return;
    setBusy(true);
    try {
      const link = { resourceId: page.id, name: page.name };
      if (mode === "share") {
        const share = role === "GM" ? openForEveryone : askToOpenForEveryone;
        await share(platform, { projectId: list.projectId, resourceId: page.id, name: page.name });
        close();
        return;
      }
      if (!gmLocked) await saveLink(platform, role, list.projectId, itemId, link);
      await openPage(platform, list, role, link);
      close();
    } catch (err) {
      setError(describeOpenError(err));
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!role || !list) return;
    await saveLink(platform, role, list.projectId, itemId, undefined);
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && results[active]) {
      void choose(results[active]);
    } else if (e.key === "Escape") {
      close();
    }
  };

  return (
    <div className="app">
      <AppHeader
        title={mode === "link" ? "Link LK Page" : mode === "share" ? "Open for everyone" : "Choose LK Page"}
        sub={list?.projectName ?? "LegendKeeper"}
      >
        <IconButton label="Close" onClick={close}>
          <X />
        </IconButton>
      </AppHeader>
      <main className="app-body stack">
        {mode === "share" && (
          <div className="small faint">
            You moved to another page inside LegendKeeper's view, and LegendKeeper doesn't let the extension see which. Choose the page
            to open for everyone.
          </div>
        )}
        {current && mode !== "share" && (
          <div className="row linked-line">
            <Link2 size={14} aria-hidden />
            <span className="spacer small">
              Linked to <strong>{current.link.name || "a page"}</strong>
              {gmLocked ? " by the GM" : ""}
            </span>
            {!gmLocked && mode === "link" && (
              <Button size="sm" variant="ghost" icon={<Unlink />} onClick={() => void unlink()}>
                Unlink
              </Button>
            )}
          </div>
        )}

        <div className="search">
          <Search aria-hidden />
          <input
            ref={inputRef}
            className="input"
            type="search"
            placeholder="Search by name, alias, tag or folder"
            aria-label="Search LegendKeeper pages"
            value={query}
            autoFocus
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="picker-results"
          />
          {query && (
            <IconButton
              className="clear"
              label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <X />
            </IconButton>
          )}
        </div>

        {gmLocked && <div className="small faint">The GM linked this token, so your choice opens a page without changing the link.</div>}
        {role === "GM" && mode === "link" && <div className="small faint">Your choice is saved on the token for everyone.</div>}
        {role === "PLAYER" && !gmLocked && mode === "link" && <div className="small faint">Your choice is saved only in this browser.</div>}
        {list?.truncated && <div className="small faint">This project has more pages than the extension lists; some may be missing.</div>}

        <div className="scroll" style={{ flex: 1, minHeight: 0, margin: "0 -4px", padding: "0 4px" }}>
          {error && <Banner tone="danger" title="Couldn't load pages">{error}</Banner>}
          {!error && !list && (
            <div className="row muted small">
              <Spinner /> Loading pages…
            </div>
          )}
          {list && !query.trim() && (
            <Empty icon={<Search />} title={mode === "share" ? "Find the page" : "Find the token's page"}>
              Type part of a name, alias, tag or folder.
            </Empty>
          )}
          {list && query.trim() && results.length === 0 && (
            <Empty icon={<FileQuestion />} title={`No pages match “${query.trim()}”`}>
              {role === "PLAYER" ? "Only public pages can be found." : "Try a shorter name or an alias."}
            </Empty>
          )}
          {results.length > 0 && (
            <div className="results" id="picker-results" role="listbox" aria-label="Pages" aria-busy={busy || undefined}>
              {results.map((page, index) => (
                <PageRow
                  key={page.id}
                  name={page.name}
                  path={page.path}
                  iconColor={page.iconColor}
                  index={index}
                  active={index === active}
                  onHover={() => setActive(index)}
                  onClick={() => void choose(page)}
                  details={page.aliases.length > 0 && <span className="result-path">aka {page.aliases.join(", ")}</span>}
                  meta={role === "GM" && page.hidden && <span className="badge warn">Hidden</span>}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
