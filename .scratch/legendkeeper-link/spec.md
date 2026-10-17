# Spec: LegendKeeper Link (Owlbear Rodeo extension)

Status: wontfix

> Superseded: this is the design of the standalone Page Link extension, kept for its
> findings (CORS, framing, keyless reads). In the combined extension, page lists are no
> longer built by a GitHub Actions workflow: the Cloudflare Worker serves them live, the
> GM's through its `LK_API_KEYS` secret and players' keylessly (see README, "How it fits
> together"). Token links use the importer's metadata format.

Open the LegendKeeper page that matches a token, from the token's context menu in Owlbear Rodeo.

## Constraints discovered during design

- The LegendKeeper v3 API does not answer browser requests from other sites (no `Access-Control-Allow-Origin`), so the extension never calls it directly.
- API keys need the project owner on a paid plan, and act with their creator's role. An admin key sees hidden pages.
- A public project can be read without a key (`GET /api/v3/projects/{id}/resources/`); that view excludes hidden pages.
- The public view `https://www.legendkeeper.com/p/{projectId}/{resourceId}/` allows framing from any origin (`frame-ancestors *`) and hides hidden documents (e.g. "DM" tabs).
- The logged-in app `https://www.legendkeeper.com/a/{projectId}/{resourceId}/` sends `X-Frame-Options: DENY` and can only open in a new tab.

## Page lists

A GitHub Actions workflow (push to `main`, plus manual "Run workflow") builds the extension, fetches two page lists and deploys both to GitHub Pages:

- `lk/public.json`: fetched without a key, so public pages only. Players search this.
- `lk/gm.json`: fetched with the `LK_API_KEY` repository secret, so hidden pages are included and flagged. The GM searches this. Not encrypted (accepted: it is publicly readable).

Both carry the project ID (resolved from the key), whether the project is public, the build time, and per page: id, name, aliases, tags, folder path, hidden flag.

## Matching

On "Open LK Page", resolve the token's page in this order:

1. A GM link saved on the token's metadata (shared with everyone).
2. The player's own link, saved in their browser (players only).
3. Exactly one page whose name or alias equals the token's visible label text (case-insensitive, trimmed).
4. Exactly one page whose name or alias equals the token's name.
5. Otherwise, open the picker: results with folder paths and a "Hidden" badge, and a search box pre-filled with the label (or the name when there is no label).

"Link LK Page…" always opens the picker. A GM's choice is saved on the token; a player's choice is saved only in that player's browser. A GM link wins over a player's.

## Opening

Each user picks the open mode in Settings (the extension's toolbar panel); saved in their browser.

- **Owlbear panel**: a full-height popover pinned to the right edge, which stays open on click-away. Opening another token replaces it. It frames the public view. Its header has an "Open in LegendKeeper" button.
- **New tab**: players get the public view; the GM gets the logged-in app (DM notes included).
- Private project: the panel option is disabled and everything opens in a new tab, with a notice.
- A GM-linked hidden page opened by a player shows "This page isn't public".

## Context menu

Shown when exactly one image item on the Character, Mount or Prop layer is selected, to GM and players.

## Out of scope for v1

- Chrome side panel (needs a companion Chrome extension).
- Live API search (needs LegendKeeper to allow browser requests).
- Full-text search: the lists cover names, aliases, tags and folder paths.

## Stack and deployment

Vite, TypeScript, React, `@owlbear-rodeo/sdk`; matching logic unit-tested with Vitest. Hosted on GitHub Pages; Owlbear installs from `https://groudonmcl.github.io/LK-Owlbear/manifest.json`.

One-time setup by the repo owner: add the `LK_API_KEY` repository secret, and set Settings → Pages → Source to "GitHub Actions".
