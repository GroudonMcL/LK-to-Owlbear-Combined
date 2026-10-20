// Runs for the lifetime of the room (manifest background_url). It owns the
// pieces that must outlive the popover and editor: the token context menus,
// the "LegendKeeper pages" menu on notes and text that name pages,
// click-to-place, linking tokens dragged in from Owlbear storage, keeping the
// room's cross-scene index current, and telling players' browsers which
// LegendKeeper project the room uses.

import OBR, { type Item, type Vector2 } from "@owlbear-rodeo/sdk";
import { ApiClient } from "./lib/api";
import { linksForPlacedItems, loadAssetLinks } from "./lib/assetLinks";
import { syncRoomIndex } from "./lib/existing";
import { LINK_KEY, parseLink } from "./lib/links";
import { describeOpenError, linkToken, openForToken } from "./lib/open";
import { loadPageList } from "./lib/pageLists";
import { publishProject } from "./lib/project";
import { loadSettings, requestNavigation, SETTINGS_STORAGE_KEY } from "./lib/settings";
import { PageMatcher, type ItemTextMatches } from "./lib/textMatch";
import { isToken, TOKEN_FILTER } from "./lib/token";
import {
  CH_PAGES_REFRESHED,
  CH_PLACE,
  CH_TOKEN_CREATED,
  extensionUrl,
  IMPORT_MENU_ID,
  LINK_MENU_ID,
  OPEN_MENU_ID,
  PLACE_MODE_ID,
  PLACE_TOOL_ID,
  TEXT_MENU_ID,
} from "./platform/channels";
import { obrPlatform } from "./platform/obr";
import type { PlacementRequest } from "./platform/types";

const FALLBACK_TOOL = "rodeo.owlbear.tool/move";

// Context menus -----------------------------------------------------------

/** Runs a page action for the one selected token, reporting failures as a notification. */
function forToken(action: (platform: typeof obrPlatform, item: Item) => Promise<void>) {
  return ({ items }: { items: Item[] }) => {
    const item = items[0];
    if (items.length !== 1 || !isToken(item)) return;
    action(obrPlatform, item).catch((err: unknown) => {
      console.error(err);
      void OBR.notification.show(describeOpenError(err), "ERROR");
    });
  };
}

async function setupContextMenus(): Promise<void> {
  // A token: one image on the Character, Mount or Prop layer. For everyone.
  const tokenFilter = { min: 1, max: 1, every: TOKEN_FILTER };
  await OBR.contextMenu.create({
    id: OPEN_MENU_ID,
    icons: [{ icon: extensionUrl("icons/book.svg"), label: "Open LK Page", filter: tokenFilter }],
    onClick: forToken(openForToken),
  });
  await OBR.contextMenu.create({
    id: LINK_MENU_ID,
    icons: [{ icon: extensionUrl("icons/link.svg"), label: "Link LK Page…", filter: tokenFilter }],
    onClick: forToken(linkToken),
  });
  await OBR.contextMenu.create({
    id: IMPORT_MENU_ID,
    icons: [
      {
        icon: extensionUrl("icons/scroll.svg"),
        label: "LK Token Art",
        filter: {
          roles: ["GM"],
          max: 1,
          every: [{ key: ["metadata", LINK_KEY, "resourceId"], value: undefined, operator: "!=" }],
        },
      },
    ],
    async onClick(context) {
      const parsed = parseLink(context.items[0]?.metadata);
      if (parsed?.status !== "valid") {
        await OBR.notification.show("This token's LegendKeeper link is unreadable.", "WARNING");
        return;
      }
      requestNavigation({ projectId: parsed.link.projectId, resourceId: parsed.link.resourceId, title: parsed.link.title });
      await OBR.action.open();
    },
  });
}

// Scene text -------------------------------------------------------------

// "LegendKeeper pages" appears only on the notes and Text items that name a
// page. Context menu filters can't call back into the extension, so the menu
// is re-created, listing those items' ids, whenever the set changes. Each
// person's menu is local and built from their own page list: a player's
// matches come from public pages only.

let textMatcher: PageMatcher | null = null;
let textMenuKey: string | null = null;
let textTimer: ReturnType<typeof setTimeout> | undefined;

async function setTextMenu(matches: ItemTextMatches[]): Promise<void> {
  const ids = matches.map((m) => m.source.id).sort();
  const most = Math.max(0, ...matches.map((m) => m.pages.length));
  const key = `${ids.join(",")}|${most}`;
  if (key === textMenuKey) return;
  textMenuKey = key;
  if (ids.length === 0) {
    await OBR.contextMenu.remove(TEXT_MENU_ID).catch(() => undefined);
    return;
  }
  await OBR.contextMenu.create({
    id: TEXT_MENU_ID,
    icons: [
      {
        icon: extensionUrl("icons/text-link.svg"),
        label: "LegendKeeper pages",
        filter: {
          max: 1,
          // id == a || id == b || …
          every: ids.map((id, i) => ({ key: "id", value: id, ...(i < ids.length - 1 ? { coordinator: "||" as const } : {}) })),
        },
      },
    ],
    embed: { url: extensionUrl("textmenu.html"), height: Math.min(260, 10 + 34 * most) },
  });
}

async function scanText(items?: Item[], fresh = false): Promise<void> {
  try {
    if (!(await OBR.scene.isReady())) return setTextMenu([]);
    const role = await OBR.player.getRole();
    const list = await loadPageList(obrPlatform, role, fresh);
    if (textMatcher?.pages !== list.pages) textMatcher = new PageMatcher(list.pages);
    await setTextMenu(textMatcher.matchItems(items ?? (await OBR.scene.items.getItems())));
  } catch {
    // Not connected yet, or LegendKeeper unreachable: no menu until the next change.
    await setTextMenu([]).catch(() => undefined);
  }
}

function scheduleTextScan(items?: Item[], fresh = false): void {
  clearTimeout(textTimer);
  textTimer = setTimeout(() => void scanText(items, fresh), 400);
}

// Room project ------------------------------------------------------------

async function syncRoomProject(): Promise<void> {
  try {
    if ((await OBR.player.getRole()) !== "GM") return;
    await publishProject(obrPlatform, loadSettings());
  } catch (err) {
    console.warn("[LegendKeeper] couldn't record the room's project", err);
  }
}

// Click-to-place ---------------------------------------------------------

let pending: PlacementRequest | null = null;
let ghostId: string | null = null;
let previousTool: string | null = null;

async function teardownTool(): Promise<void> {
  const restore = previousTool && previousTool !== PLACE_TOOL_ID ? previousTool : FALLBACK_TOOL;
  previousTool = null;
  try {
    await OBR.tool.activateTool(restore);
  } catch {
    await OBR.tool.activateTool(FALLBACK_TOOL).catch(() => undefined);
  }
  await OBR.tool.removeMode(PLACE_MODE_ID).catch(() => undefined);
  await OBR.tool.remove(PLACE_TOOL_ID).catch(() => undefined);
}

async function removeGhost(): Promise<void> {
  if (!ghostId) return;
  const id = ghostId;
  ghostId = null;
  await OBR.scene.local.deleteItems([id]).catch(() => undefined);
}

async function cancelPlacement(reason: string): Promise<void> {
  const request = pending;
  if (!request) return;
  pending = null;
  await removeGhost();
  await teardownTool();
  if (request.cleanupHash) {
    const settings = loadSettings();
    if (settings.backendUrl && settings.apiKey) {
      await new ApiClient(settings).deleteToken(request.cleanupHash).catch(() => undefined);
    }
  }
  await OBR.notification.show(reason, "INFO");
}

async function place(at: Vector2): Promise<void> {
  const request = pending;
  if (!request) return;
  pending = null; // before switching tools, so onDeactivate doesn't cancel
  await removeGhost();
  const position = await obrPlatform.snap(at, request.cells);
  const item = { ...request.item, position } as Item;
  try {
    await OBR.scene.items.addItems([item]);
  } catch (err) {
    await teardownTool();
    await OBR.notification.show(`Couldn't place the token: ${(err as Error).message}`, "ERROR");
    return;
  }
  await teardownTool();
  await OBR.player.select([item.id], true).catch(() => undefined);
  await OBR.notification.show(`Placed ${item.name}.`, "SUCCESS");
  await obrPlatform.sendLocal(CH_TOKEN_CREATED, {}).catch(() => undefined);
}

async function moveGhost(at: Vector2): Promise<void> {
  if (!pending) return;
  if (!ghostId) {
    ghostId = `${pending.item.id}-ghost`;
    const ghost = { ...pending.item, id: ghostId, position: at, metadata: {}, disableHit: true, locked: true } as Item;
    await OBR.scene.local.addItems([ghost]).catch(() => (ghostId = null));
    return;
  }
  const id = ghostId;
  await OBR.scene.local
    .updateItems([id], (items) => items.forEach((i) => (i.position = at)), true)
    .catch(() => undefined);
}

async function startPlacement(request: PlacementRequest): Promise<void> {
  if (pending) await cancelPlacement("Previous placement replaced.");
  pending = request;
  previousTool = await OBR.tool.getActiveTool().catch(() => null);
  const icon = extensionUrl("icons/place.svg");
  await OBR.tool.create({
    id: PLACE_TOOL_ID,
    icons: [{ icon, label: "Place LegendKeeper token", filter: { roles: ["GM"] } }],
    defaultMode: PLACE_MODE_ID,
  });
  await OBR.tool.createMode({
    id: PLACE_MODE_ID,
    icons: [{ icon, label: "Click to place", filter: { activeTools: [PLACE_TOOL_ID] } }],
    cursors: [{ cursor: "crosshair" }],
    onToolMove: (_ctx, event) => void moveGhost(event.pointerPosition),
    onToolClick: (_ctx, event) => {
      void place(event.pointerPosition);
      return false;
    },
    onKeyDown: (_ctx, event) => {
      if (event.key === "Escape") void cancelPlacement("Placement cancelled.");
    },
    onDeactivate: () => {
      if (pending) void cancelPlacement("Placement cancelled.");
    },
  });
  await OBR.tool.activateTool(PLACE_TOOL_ID);
  await OBR.notification.show(`Click on the map to place ${request.item.name}. Press Esc to cancel.`, "INFO");
}

// Tokens dragged in from Owlbear storage -----------------------------------

// Ids in the scene as last seen; null until the scene's first item list, so
// tokens already there when a scene opens are never mistaken for new ones.
let seenIds: Set<string> | null = null;

async function linkPlacedAssets(items: Item[]): Promise<void> {
  const previous = seenIds;
  seenIds = new Set(items.map((item) => item.id));
  if (!previous) return;
  const added = items.filter((item) => !previous.has(item.id));
  if (added.length === 0) return;
  const entries = loadAssetLinks();
  if (entries.length === 0) return;
  const links = linksForPlacedItems(added, entries, OBR.player.id);
  if (links.length === 0) return;
  const byId = new Map(links.map(({ id, link }) => [id, link]));
  await OBR.scene.items.updateItems([...byId.keys()], (drafts) => {
    for (const draft of drafts) draft.metadata[LINK_KEY] = { ...byId.get(draft.id)! };
  });
  await obrPlatform.sendLocal(CH_TOKEN_CREATED, {}).catch(() => undefined);
}

// Room index ------------------------------------------------------------

let syncTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleIndexSync(): void {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      if ((await OBR.player.getRole()) !== "GM" || !(await OBR.scene.isReady())) return;
      await syncRoomIndex(obrPlatform, await OBR.scene.items.getItems());
    } catch (err) {
      console.warn("[LegendKeeper] index sync failed", err);
    }
  }, 1500);
}

OBR.onReady(async () => {
  await setupContextMenus();
  void syncRoomProject();
  // The popover (another frame of this extension) saved new settings.
  window.addEventListener("storage", (e) => {
    if (e.key !== SETTINGS_STORAGE_KEY) return;
    void syncRoomProject();
    scheduleTextScan();
  });
  OBR.broadcast.onMessage(CH_PAGES_REFRESHED, () => scheduleTextScan(undefined, true));
  // A player's page list depends on the project the GM records on the room.
  OBR.room.onMetadataChange(() => scheduleTextScan());
  OBR.broadcast.onMessage(CH_PLACE, (event) => void startPlacement(event.data as PlacementRequest));
  OBR.scene.items.onChange((items) => {
    scheduleIndexSync();
    scheduleTextScan(items);
    linkPlacedAssets(items).catch((err) => console.warn("[LegendKeeper] couldn't link a placed token", err));
  });
  OBR.scene.onReadyChange((ready) => {
    seenIds = null;
    scheduleTextScan();
    if (!ready) return;
    scheduleIndexSync();
    void OBR.scene.items.getItems().then((items) => (seenIds ??= new Set(items.map((item) => item.id)))).catch(() => undefined);
  });
  scheduleTextScan();
  if (await OBR.scene.isReady()) {
    scheduleIndexSync();
    seenIds ??= new Set((await OBR.scene.items.getItems()).map((item) => item.id));
  }
});
