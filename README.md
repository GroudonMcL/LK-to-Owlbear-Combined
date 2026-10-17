# LegendKeeper for Owlbear

An [Owlbear Rodeo](https://www.owlbear.rodeo) extension for campaigns kept in
[LegendKeeper](https://www.legendkeeper.com). It combines two earlier extensions:

- **Page links** (from *LegendKeeper Link*): right-click any token and choose **Open LK Page**
  to read its LegendKeeper page in a panel inside Owlbear or in a new tab. Works for the GM
  and for players.
- **Token importer** (from *LegendKeeper Token Importer*): search a page, pick an image,
  crop and frame it, and the token lands in the scene with the page's title, its creature
  size and a link back to the page.

Both halves share one LegendKeeper connection, one kind of token link and one look.

**Nothing runs on your computer.** The extension and its small companion service are
deployed together as one free Cloudflare Worker, straight from GitHub. You add one URL to
Owlbear Rodeo and type one password.

## One API key, in one place

Your LegendKeeper API key lives in exactly one place: the Worker's encrypted `LK_API_KEYS`
secret, set by the deploy workflow from the GitHub secret of the same name. Every feature
reads LegendKeeper through the Worker:

| Feature | How it reaches LegendKeeper |
| --- | --- |
| Importer: search, page details, images | Worker, with `LK_API_KEYS` |
| GM's page list (Open/Link LK Page, hidden pages included) | Worker, with `LK_API_KEYS` |
| Players' page list (public pages only) | Worker, **without** a key, as an anonymous visitor would |

No browser ever holds the key. The GM's browser holds only the extension's own access
password, and players need nothing at all. Page lists are fetched live (cached for a
minute), so new and renamed pages show up without redeploying.

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
    public view. The GM gets an **Edit in LegendKeeper** button that opens the page in
    the full app; players get **Open in LegendKeeper** (the public view in a tab).
  - **New tab**: the full app for the GM, where pages can be edited and DM notes read;
    the public view for players.
- **Editing pages.** LegendKeeper's app sends `X-Frame-Options: DENY`, so it can't be
  shown inside Owlbear, only in its own tab. A GM who wants edit mode by default should
  set **Open pages in** to **New tab**.
- **Visibility.** The GM searches every page, with hidden ones flagged. Players search only
  public pages, and a GM link to a hidden page tells players it isn't public. A private
  project has no public view, so its pages open in a new tab, which works for LegendKeeper
  members of the project.

### Token importer (GM)

- **Search & images.** Search your LegendKeeper project, open a page, and see every image
  on it: sidebar images and image blocks (including those inside infoboxes, layouts,
  tables and secrets), plus the page image and the banner. **Open page** shows the page
  itself.
- **Linked tokens, no accidental duplicates.** Each token remembers its page by id.
  Opening a page that already has a token offers **Use existing**, **Create another** or
  **Cancel**. Copies, renamed pages, deleted tokens, tokens in other scenes, broken link
  data and failed lookups are all handled explicitly.
- **Token editor.** A large live preview with drag, wheel or pinch zoom around the
  cursor, rotation, flip, fit/fill/reset, and a dimmed view of the art outside the frame.
  There are five shapes and nine procedural frames with colour, thickness, spacing,
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
   create a key. With the *Admin* role the GM can also find and open hidden pages; with
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
   `https://lk-to-owlbear.<your-subdomain>.workers.dev/manifest.json`.
6. **Owlbear Rodeo.** Open your [profile](https://owlbear.app/profile), click **Add
   Extension** and paste that URL. Enable the extension for a room, open it from the
   room's top-left toolbar, and enter your access password. Your project is selected
   automatically, and the room remembers it so players' browsers know which project to
   read.

For the Owlbear panel and for players, the LegendKeeper project must be **public** in
LegendKeeper. To update later, run the workflow again (it also
runs on every push to `main`). Hosted tokens are kept across deploys.

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
open in the importer uses 1–9 of them; a page list uses one per 100 pages, at most once a
minute per Worker instance. Page lists stop at 5,000 pages.

## How it fits together

```
 Owlbear Rodeo (GM's and players' browsers)    Cloudflare Worker (one URL)               LegendKeeper
┌─────────────────────────────────┐          ┌─────────────────────────────────────┐ API key ┌─────────────┐
│ popover: search, page, settings │ access   │ /*.html, /assets   extension        │───────▶ │ /api/v3/... │
│   (players: where pages open)   │ password │ /api/...           API (GM)         │         │             │
│ modal: token editor, link picker│─────────▶│ /api/.../images    image proxy      │───────▶ │ asset host  │
│ popover: LK page side panel     │          │ /api/public/...    players' page    │ no key  │             │
│ background: context menus,      │ ─ none ─▶│                    list             │───────▶ │             │
│   click-to-place, index         │ ◀─ blob ─│ POST /api/tokens   store token      │         └─────────────┘
└─────────────────────────────────┘          │ GET /t/<sha256>    public, CORS     │ ◀── every player's browser
                                             └───────────────┬─────────────────────┘
                                                             └── Workers KV (finished tokens)
```

LegendKeeper's API refuses requests from browser pages, and its keys must stay secret,
so a server-side piece is unavoidable. The Worker is that piece, and it also hosts the
extension. Code layout:

- **`extension/`** is the Owlbear extension (Vite + React): the popover, the editor and
  picker modals, the side panel and the background page.
  - `src/lib/` holds the logic: token links, page matching (`match.ts`), page lists,
    opening pages (`open.ts`), the room index and token creation.
  - `src/platform/` wraps the Owlbear SDK; a mock backs local development.
  - `src/ui/` holds the shared components and the one stylesheet.
- **`server/src/core/`** is the runtime-agnostic API: Web `Request` → `Response`, Web
  Crypto and `fetch`.
- **`server/src/worker.ts`** is the Cloudflare entry, with the KV token store.
  **`server/src/node/`** is an optional self-hosting entry with a DNS-pinned fetcher and
  a file store (see `server/Dockerfile`).
- **`shared/`** holds the wire types (including page lists) and the size-detection rules.
- **`deploy/`** holds the GitHub Actions helpers, and **`e2e/`** the Owlbear host
  emulator and end-to-end run.

## Security

- LegendKeeper keys live only in the Worker's encrypted secrets, set by the deploy
  workflow from GitHub secrets. The extension holds the separate **access password**,
  stored in the GM's browser, and it grants only this Worker's narrow API.
- The players' page list is the one LegendKeeper route the Worker serves without the
  password. It is fetched from LegendKeeper **without a key**, so it holds only what
  LegendKeeper already shows anonymous visitors, and only for projects the Worker has a key
  for. (LegendKeeper Link published its GM page list as a public file; that list now needs
  the password.)
- The image proxy is **page-scoped**. The browser asks for `(project, page, imageId)`,
  where `imageId` is a hash of a URL the Worker itself extracted from that page. It is
  never an open proxy. Every hop must be `https:`, and private-IP literals and local names
  are refused. Bodies are size-capped and sniffed. Set `LK_ASSET_HOSTS` (a Worker variable)
  to pin LegendKeeper's asset host.
- Private page art reaches the editor as `blob:` URLs and never gets a public URL.
- The **finished token** is the one image made public: every player's browser has to load
  it. It is published only when the GM presses *Create token*, stored under the SHA-256 of
  its bytes (unguessable, de-duplicated) and served with CORS. If you'd rather not, choose
  **Owlbear storage** in Settings. Owlbear then saves the token to your own Owlbear storage,
  and you drag it onto the map from Owlbear's Assets panel.
- Token metadata (`io.github.groudonmcl.lk-to-owlbear/link`) holds only the version,
  project and page ids, the last-known title, the link time and an import id. Room metadata
  holds the selected project's id and name, and a small index of which scenes hold linked
  tokens.

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
npm test                 # 253 unit/integration tests
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
  message protocol from another origin. 59 checks cover the GM's import and page-link
  workflows and a player's. Screenshots go to `e2e/output/`. Set `CHROMIUM_PATH` to use a
  locally installed Chromium.
- UI work without Owlbear: `npm run demo` (mock LegendKeeper + API on :8787) and
  `npm run dev:extension`, then open `http://localhost:5173/?mock` (add `&theme=light` or
  `&role=player`). The player view uses the server URL you connected with as GM in the same
browser, or `VITE_BACKEND_URL`.

See [docs/MILESTONES.md](docs/MILESTONES.md) for per-milestone status and
[docs/API-RESEARCH.md](docs/API-RESEARCH.md) for the verified API facts behind the design.
