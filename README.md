# LegendKeeper for Owlbear

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension for campaigns kept in
[LegendKeeper](https://www.legendkeeper.com). It combines two earlier extensions:

- **Page links** (from *LegendKeeper Link*): right-click any token and choose **Open LK Page**
  to read its LegendKeeper page in a panel inside Owlbear or in a new tab. Works for the GM
  and for players.
- **Token importer** (from *LegendKeeper Token Importer*): search a page, pick an image,
  crop and frame it, and the token lands in the scene with the page's title, its creature
  size and a link back to the page.
- **Scene text links**: write a page's name in an Owlbear note or Text item and the
  extension links it. Right-click the note for **LegendKeeper pages**, or see every page
  the scene mentions in the toolbar popover, and click to read the page inside Owlbear.

They share one LegendKeeper connection, one page list, one side panel and one look.

**Nothing runs on your computer.** The extension and its small companion service are
deployed together as one free Cloudflare Worker, straight from GitHub. You add one URL to
Owlbear Rodeo and type one password.

## One API key, in one place

Your LegendKeeper API key lives in exactly one place: the Worker's encrypted `LK_API_KEYS`
secret, set by the deploy workflow from the GitHub secret of the same name. No browser
ever holds it. The GM's browser holds only the extension's own access password
(`LKOB_ACCESS_TOKENS`), and players need nothing at all.

| Feature | How it reaches LegendKeeper |
| --- | --- |
| Importer: search, page details, images | Worker, with `LK_API_KEYS` |
| GM's page list (Open/Link LK Page, scene text, hidden pages included) | Built by the Worker with `LK_API_KEYS`, stored in KV |
| GM's page reading through the API (hidden pages, **Full page (GM)**) | Worker, with `LK_API_KEYS` |
| Players' page list (public pages only) | Built by the Worker **without** a key, as an anonymous visitor would see it, stored in KV |

### Page lists are ready when you join

A big project takes a while to list (LegendKeeper hands out 100 pages per call, so about
130 calls for 13,000 pages). The Worker does that work once and keeps the result, so
nobody waits for it when they open the room:

- **Every deploy** builds both lists (the GM's and the players' public one) right after
  the Worker goes live. The workflow's summary says how many pages each has.
- **Refresh page list** in the GM's Settings has the Worker list LegendKeeper again, for
  new or renamed pages. The old list stays in use until the new one is complete, and
  every browser in the room is told to fetch it.
- **Everyone else** downloads the stored list once and keeps it in the browser. Every
  5 minutes the extension asks whether there's a newer one, which costs almost nothing
  when there isn't.

Settings (and the players' popover) show the list's state, e.g. *D&D - Greyhawk:
building the page list… 4,500 pages so far*, then *D&D - Greyhawk: 13,154 pages, updated
2 hours ago*, where "updated" is when the Worker last built it. If the Worker has no list
yet (say the deploy couldn't reach LegendKeeper), the GM's browser builds one the first
time it connects.

## What it does

### Page links (everyone)

- **Open LK Page** on a token (an image on the Character, Mount or Prop layer) opens its
  page. It uses, in order: the link saved on the token (every imported token has one); for a
  player, their own link; exactly one page whose name or alias equals the token's label; then
  one that equals the token's name. Otherwise it asks you to choose.
- **Link LK Page…** sets or changes a token's page. The GM's choice is saved on the token
  for everyone, in the same link format an import uses. A player's choice stays in their own
  browser, and a GM's link always wins.
- **Where pages open** is each person's choice in the toolbar popover:
  - **Owlbear panel**: a full-height panel on the right showing LegendKeeper's read-only
    public view, with **back**, **home** and **forward** buttons floating over its top bar
    for following links between pages. Drag its left edge to make it wider or narrower;
    it remembers the width. The GM gets an **Edit in LegendKeeper** button that
    opens the page in the full app; players get **Open in LegendKeeper** (the public view
    in a tab).
  - **New tab**: the full app for the GM, where pages can be edited and DM notes read;
    the public view for players.
- **Editing pages.** LegendKeeper's app sends `X-Frame-Options: DENY`, so it can't be
  shown inside Owlbear, only in its own tab. A GM who wants edit mode by default should
  set **Open pages in** to **New tab**.
- **Visibility.** The GM searches every page, with hidden ones flagged, and reads hidden
  pages in the panel through the API. Players search only public pages, and a GM link to
  a hidden page tells players it isn't public. A private project has no public view, so
  its pages open in a new tab, which works for LegendKeeper members of the project.

### Scene text links (everyone)

- **Detect after typing.** Write in Owlbear as usual, with notes and the Text tool. The
  extension reads the text of every note and Text item in the open scene and finds the
  names and aliases of your LegendKeeper pages in it: "Dragon" finds your *Dragon* page.
  - Matching ignores case and works on whole words, so "dragonfly" never matches
    *Dragon*, but "the dragon's hoard" does.
  - The longest name wins: "Red Dragon" opens *Red Dragon*, not *Dragon*.
  - Text is checked again whenever items are added or their text changes.
- **Right-click** a note or Text item that names a page: **LegendKeeper pages** lists
  them. Items that name no page don't get the entry.
- **Toolbar popover:** the GM's **In this scene** tab (players: **Named in this scene**)
  lists every page the scene mentions, grouped by the note or text it was found in.
  Clicking the note's name shows it on the map.
- **Clicking a page** opens it exactly as **Open LK Page** opens a token's page: the
  LegendKeeper page itself, in the Owlbear panel or a new tab as each person chose.
  - The **GM** can switch the panel to **Full page (GM)**, the page as LegendKeeper's API
    returns it: secrets and the sidebar included. Hidden pages, which the public view
    can't show, open that way.
  - **Players** match only against public pages, so hidden pages never show up for
    them, and get only LegendKeeper's public view. In a private project, their links
    explain that pages can't be shown to players.

### Links on the map (everyone)

Page names in notes and Text items are underlined and clickable right on the map. It is
on by default; **Settings → Opening pages** (players: their popover) turns it off.

- **Underlines** are written into the notes' own text by the GM's browser, so everyone
  sees them. Only public pages are underlined, so players never learn a hidden page's
  name. Turning the setting off takes these underlines off again and leaves ones you
  typed alone. Notes the GM has selected (being edited) are left until they're done.
- **Click a linked word** to open its page, as the In this scene tab would. An almost
  invisible box sits over each linked word; Owlbear doesn't say where it draws each word,
  so the extension works out the layout from the font, size, padding, alignment and
  wrap width. Each person clicks through to the pages they can open. Rotated notes and
  text keep the right-click menu only.

### Open for everyone

**Open for everyone**, next to **Edit in LegendKeeper** in the page panel, opens the page
in every browser in the room, each in that person's chosen place (panel or tab). Players
only see public pages, as always. When a player clicks it, the GM is asked to approve
first. LegendKeeper's public view is another site in a frame, so the extension can't
read or set where it is scrolled: everyone opens the page at the top.

### Token importer (GM)

- **Search & images.** Search your LegendKeeper project, open a page, and see every image
  on it: sidebar images and image blocks (including those inside infoboxes, layouts,
  tables and secrets) on every page tab, images on board tabs, plus the page image and
  the banner. **Open page** shows the page
  itself.
- **Linked tokens, no accidental duplicates.** Each token remembers its page by id.
  Opening a page that already has a token offers **Use existing**, **Create another** or
  **Cancel**. Unlinked tokens in the scene whose name or label looks like the page's title
  or an alias (for example "Tiamat" for *Tiamat (God Template clip)*) are listed too, and
  **Use existing** links one to the page instead of importing a new token. Copies, renamed pages, deleted tokens, tokens in other scenes, broken link
  data and failed lookups are all handled explicitly.
- **Token editor.** A large live preview with drag, wheel or pinch zoom around the
  cursor, rotation, flip, fit/fill/reset, and a dimmed view of the art outside the frame.
  There are five shapes and eleven procedural frames (including hammered *Forged steel*
  and gold-to-copper *Ember gold*, both with a drop shadow) with colour, thickness, spacing,
  backing and opacity, plus brightness/contrast/saturation and flat-background removal.
  The export comes from the same renderer as the preview.
- **Automatic size.** A `Size` field, a `Size: Large` line, or a statblock line such as
  `Large dragon, chaotic evil` sets the footprint: Tiny ½, Small/Medium 1, Large 2,
  Huge 3, Gargantuan 4 (configurable). You can always override it.
- **Name label.** Every new token is labelled with its name, in a serif face at size 18.
- **Placement.** Drop at the centre of your view, or click to place with a live preview.
  Right-click a linked token → **LK Token Art** to jump back to its page in the importer.
- **Owlbear storage.** With this hosting choice, *Create token* opens Owlbear's upload
  dialog to save the token in your Owlbear storage. Owlbear doesn't tell extensions where
  it saved the image, so the token isn't placed for you: drag it from Owlbear's **Assets**
  panel onto the map, and the extension links it to its page as it lands. Choose
  **Extension server** hosting to have tokens placed straight away.

### One look

Every page of the extension (popover, editor, link picker, side panel) uses the same
components and design tokens. Surfaces and text follow **Owlbear's live theme**, light or
dark, so the panels sit natively in Owlbear. Brand and typography follow **LegendKeeper**:
its gold accent for primary actions and selection, and a serif for page titles.

## Set it up (about 10 minutes, all in the browser)

You need a LegendKeeper project on a **paid plan** (API keys require it), a free
[Cloudflare](https://dash.cloudflare.com/sign-up) account, and this repository on GitHub.

1. **LegendKeeper key.** In your project: *Project Settings → Developers → API Keys →*
   create a key. With the *Admin* role the GM can also find and read hidden pages; with
   *Member*, hidden pages are left out.
2. **Cloudflare.**
   - Your account already has a `workers.dev` subdomain: it's shown as *Your subdomain*
     on the *Workers & Pages* page (with a *Change* link). You don't need to note it; the
     deploy finds it and prints your extension URL.
   - Copy your **Account ID** (shown on the *Workers & Pages* overview, or in the URL of
     the dashboard).
   - *My Profile → API Tokens → Create Token →* use the **Edit Cloudflare Workers**
     template, then copy the token.
3. **Choose an access password** for the extension. Any length works. Whoever has it can
   search and read your project through the extension (hidden pages too, with an *Admin*
   key) and upload token images, so pick something longer if that matters to you.
4. **GitHub secrets.** In this repository: *Settings → Secrets and variables → Actions →
   New repository secret*. Add:

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | the Cloudflare API token |
   | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID |
   | `LK_API_KEYS` | the LegendKeeper API key (comma-separate several, one per project) |
   | `LKOB_ACCESS_TOKENS` | your access password |

   A secret named `LK_API_KEY` (the name LegendKeeper Link used) is accepted in place of
   `LK_API_KEYS`.
5. **Deploy.** *Actions → Deploy to Cloudflare → Run workflow.* When it finishes, its
   summary shows your extension URL, e.g.
   `https://lk-to-owlbear.<your-subdomain>.workers.dev/manifest.json`, and how many pages
   it listed.
6. **Owlbear Rodeo.** Open your [profile](https://owlbear.app/profile), click **Add
   Extension** and paste that URL. Enable the extension for a room, open it from the
   room's top-left toolbar, and enter your access password in **Settings**. Your project
   is selected automatically (with several keys, you choose one), and the room remembers
   it so players' browsers know which project to read. Enter the password once per
   browser you GM from; **Forget password** removes it.

For the Owlbear panel's public view and for players, the LegendKeeper project must be
**public** in LegendKeeper. To update later, run the workflow again (it also runs on every
push to `main`). Hosted tokens are kept across deploys.

### Upgrading from a version that took the API key in Settings

A version from October 2026 had the GM paste the LegendKeeper key into the extension's
Settings. The key is a repository secret again:

- Add the `LK_API_KEYS` and `LKOB_ACCESS_TOKENS` repository secrets (step 4 above) and run
  the deploy.
- In Owlbear, enter the access password in **Settings**. The extension deletes the API
  key it had kept in your browser the first time it loads.

### Moving from the two separate extensions

- Remove *LegendKeeper Link* and *LegendKeeper Token Importer* from your Owlbear profile and
  add this one.
- Its token metadata lives under a new namespace (`io.github.groudonmcl.lk-to-owlbear`), so
  tokens linked or imported with the old extensions need linking again (**Link LK Page…**).
- The GitHub Pages site and the page-list workflow of *LegendKeeper Link* are no longer
  needed: page lists come from the Worker.

### Costs and limits

The Cloudflare free plan covers normal use: 100,000 requests per day. Finished tokens
are stored in Workers KV (1 GB and 1,000 new tokens per day on the free plan) and served
from Cloudflare's cache. LegendKeeper allows 300 API requests per minute per key. A page
open in the importer or the panel uses 2–10 of them. Building the page lists uses one per
100 pages for each list (about 260 for 13,000 pages), only on a deploy or when the GM
presses **Refresh page list**, in steps of 1,500 pages to stay under the free plan's 50
outbound calls per request. A stored list holds up to about 90,000 pages. Browsers fetch
the stored list from KV (100,000 reads a day on the free plan); a rebuild writes about
two KV entries per 1,500 pages (1,000 writes a day).

## How it fits together

```
 Owlbear Rodeo (GM's and players' browsers)    Cloudflare Worker (one URL)               LegendKeeper
┌─────────────────────────────────┐          ┌─────────────────────────────────────┐ API key ┌─────────────┐
│ popover: search, scene text,    │ access   │ /*.html, /assets   extension        │───────▶ │ /api/v3/... │
│   settings (password only)      │ password │ /api/...           API (GM)         │         │             │
│ modal: token editor, link picker│─────────▶│ /api/.../images    image proxy      │───────▶ │ asset host  │
│ popover: LK page side panel     │          │ /api/.../page-list stored lists,    │ no key  │             │
│ background: context menus,      │ ─ none ─▶│ /api/public/...    players' list    │───────▶ │             │
│   text matching, placing, index │ ◀─ blob ─│ POST /api/tokens   store token      │         └─────────────┘
└─────────────────────────────────┘          │ GET /t/<sha256>    public, CORS     │ ◀── every player's browser
                                             └───────────────┬─────────────────────┘
                                                             └── Workers KV (page lists, finished tokens)
```

LegendKeeper's API refuses requests from browser pages, and its keys must stay secret,
so a server-side piece is unavoidable. The Worker is that piece, and it also hosts the
extension. Code layout:

- **`extension/`** is the Owlbear extension (Vite + React): the popover, the editor and
  picker modals, the side panel and the background page.
  - `src/lib/` holds the logic: token links, page matching (`match.ts`), finding page
    names in scene text (`textMatch.ts`), page lists, opening pages (`open.ts`), the room
    index and token creation.
  - `src/platform/` wraps the Owlbear SDK; a mock backs local development.
  - `src/ui/` holds the shared components and the one stylesheet.
- **`server/src/core/`** is the runtime-agnostic API: Web `Request` → `Response`, Web
  Crypto and `fetch`.
- **`server/src/worker.ts`** is the Cloudflare entry, with the KV token store.
  **`server/src/node/`** is an optional self-hosting entry with a DNS-pinned fetcher and
  a file store (see `server/Dockerfile`).
- **`shared/`** holds the wire types (including page lists and page content) and the
  size-detection rules.
- **`deploy/`** holds the GitHub Actions helpers, and **`e2e/`** the Owlbear host
  emulator and end-to-end run.

## Security

- LegendKeeper keys live only in the Worker's encrypted secrets, set by the deploy
  workflow from GitHub secrets. They never reach a browser, the room, the scene or any
  item. The extension holds the separate **access password**, stored in the GM's browser
  (local storage of the extension's origin), and it opens only this Worker's narrow API.
  **Forget password** removes it.
- The players' page list is the one LegendKeeper-derived route the Worker serves without
  the password. It is listed from LegendKeeper **without a key**, so it holds only what
  LegendKeeper already shows anonymous visitors, and only for projects the Worker has a
  key for. Building it, like every other LegendKeeper call, needs the password. Reading it
  is rate-limited per address.
- Page content shown to the GM (secrets included) only goes to browsers holding the
  password. Players' links open LegendKeeper's public view, which hides hidden pages and
  secrets.
- The image proxy is **page-scoped**. The browser asks for `(project, page, imageId)`,
  where `imageId` is a hash of a URL the Worker itself extracted from that page. It is
  never an open proxy. Every hop must be `https:`, and private-IP literals and local names
  are refused. Bodies are size-capped and sniffed. Set `LK_ASSET_HOSTS` (a Worker variable)
  to pin LegendKeeper's asset host.
- Private page art reaches the editor as `blob:` URLs and never gets a public URL.
- The **finished token** is the one image made public: every player's browser has to load
  it. It is published only when the GM presses *Create token* (which needs the access
  password), stored under the SHA-256 of its bytes (unguessable,
  de-duplicated) and served with CORS. If you'd rather not, choose **Owlbear storage** in
  Settings. Owlbear then saves the token to your own Owlbear storage, and you drag it onto
  the map from Owlbear's Assets panel.
- Token metadata (`io.github.groudonmcl.lk-to-owlbear/link`) holds only the version,
  project and page ids, the last-known title, the link time and an import id. Room metadata
  holds the selected project's id and name, and a small index of which scenes hold linked
  tokens. Scene-text matches are worked out in each person's browser and never stored.

## Token links

| Situation | Behaviour |
| --- | --- |
| First import | Token created with link metadata, selected and framed |
| Link LK Page… (GM) | The same link metadata, without importing art |
| Open LK Page on a linked token | Opens its page directly |
| Page opened again in the importer | "A token for this page already exists": *Use existing* / *Create another* / *Cancel* |
| Token deleted | Live scene lookup finds nothing; importing is open again |
| Token copied in Owlbear | Shown as multiple matches, each selectable |
| Page renamed | The link holds (by id); "Name differs" offers a one-click rename |
| Page deleted or hidden | "Page unavailable", with *Unlink tokens* |
| Token in another scene | Reported from a small room index; Owlbear has no API to switch scenes |
| Link metadata corrupted | Settings → Scene links → *Remove link data* |
| Lookup failed | Explicit warning; the picker stays closed until *Retry* or *Continue anyway* |
| Create clicked twice | One token (in-flight guard plus a per-session import id) |

## Development

```sh
npm install
npm test                 # 341 unit/integration tests
npm run typecheck
npm run build:cloudflare && npm run e2e   # end-to-end in the Workers runtime (needs Chromium)
```

- `npm test` covers size parsing, page extraction, page lists, token matching, client
  retries, both image fetchers' SSRF rules, and the full HTTP API run against **both** the
  Node stack and the real Worker entry. It also validates the mock LegendKeeper against the
  **official OpenAPI schemas** and checks that the client only calls endpoints the spec
  defines. The rest is link and room-index logic, crop geometry, pixel-level renderer checks
  and the deploy helpers.
- `npm run e2e` runs the production bundle with the real `@owlbear-rodeo/sdk`, served by
  `wrangler dev` (workerd), inside an **Owlbear host emulator** that speaks the SDK's
  message protocol from another origin. 104 checks cover the GM's import, page-link and
  scene-text workflows and a player's. Screenshots go to `e2e/output/`. Set `CHROMIUM_PATH` to use a
  locally installed Chromium.
- UI work without Owlbear: `npm run demo` (mock LegendKeeper + API on :8787) and
  `npm run dev:extension`, then open `http://localhost:5173/?mock` (add `&theme=light` or
  `&role=player`), and enter the access password the demo prints. The player view uses
  the server URL you connected with as GM in the same browser, or `VITE_BACKEND_URL`.

See [docs/MILESTONES.md](docs/MILESTONES.md) for per-milestone status and
[docs/API-RESEARCH.md](docs/API-RESEARCH.md) for the verified API facts behind the design.
