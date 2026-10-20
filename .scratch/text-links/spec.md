# Spec: Scene text links, and the API key in Settings

Status: ready-for-human

Link the words in Owlbear notes and Text items to LegendKeeper pages, and move the
LegendKeeper API key out of the repository's secrets and into the extension's Settings.

## What it does (version 1)

1. **Detect after typing.** The GM and players write notes and text with Owlbear's own
   tools. The extension reads the text of every note (an image on the Note layer) and
   Text item in the open scene, and finds page names and aliases in it.
   - Case-insensitive, whole words, longest phrase first ("Red Dragon" over "Dragon").
     Punctuation is a word boundary, so "the dragon's hoard" matches *Dragon*. Names of
     one letter, and names without letters, are ignored.
   - Re-checked automatically whenever items change (added, edited, deleted), when the
     scene changes, and when the page list is refreshed.
2. **Where matches show.**
   - Right-click a note or Text item that names a page: **LegendKeeper pages** lists the
     pages (a context menu embed). Items without matches don't get the entry.
   - The toolbar popover: **In this scene** (GM) / **Named in this scene** (players)
     lists every match, grouped by item. Clicking an item's name selects it on the map.
3. **Opening a match.** The GM gets the side panel showing the page as read from
   LegendKeeper's API (`/api/projects/:p/pages/:r/content`): hidden pages, secrets and
   sidebar included, images through the page-scoped proxy, mentions open in place. A
   switch shows the public view instead when the project is public.
4. **Settings.** The GM pastes their LegendKeeper API key. It is kept in the browser's
   localStorage only, never in room or scene metadata. A key opens exactly one project,
   which is selected automatically. **Refresh page list** reloads the list everywhere
   (popover, background, context-menu embed).
5. **Players.** Matched against the project's public page list (fetched without a key),
   so hidden pages never match. A player's link opens only LegendKeeper's public view;
   in a private project it explains that pages can't be shown to players.

## Decisions

- **The Worker stays, the key moves.** LegendKeeper's API refuses browser pages (no CORS),
  so the Worker relays requests. It no longer holds `LK_API_KEYS` or an access password:
  the extension sends the GM's key as `Authorization: Bearer` on each request, the Worker
  uses it for that request, and every cache is keyed by a digest of the key, so one key's
  answers (hidden pages, say) never answer another. Token uploads also need a key
  LegendKeeper accepts.
- **Players' list without keys.** The Worker lists a project's resources anonymously.
  A project that refuses anonymous visitors gives an empty, non-public list.
- **Menu filter.** Context-menu filters can't call into the extension, so the background
  page re-creates the menu with an `id == a || id == b …` filter whenever the set of items
  with matches changes. Each person's menu is local and built from their own page list.
- **One SDK subscription per frame.** The SDK's unsubscribe stops events for the whole
  frame, so the platform layer shares one `items.onChange` / `onReadyChange` subscription
  among a frame's listeners.

## Not in version 1

- Highlighting matched words on the map itself (Owlbear has no API for styling part of a
  text item).
- Matching inside token labels (tokens already have Open LK Page).
