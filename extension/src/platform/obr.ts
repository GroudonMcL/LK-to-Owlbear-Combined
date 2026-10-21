import OBR, { buildImage, buildImageUpload, type Item, type Theme } from "@owlbear-rodeo/sdk";
import { CH_PLACE, EDITOR_MODAL_ID, extensionUrl } from "./channels";
import { TOKEN_LABEL_FONT, type Platform, type PlacementRequest, type ThemeInfo, type TokenItemSpec } from "./types";

function themeInfo(theme: Theme): ThemeInfo {
  return {
    mode: theme.mode,
    paper: theme.background.paper,
    background: theme.background.default,
    text: theme.text.primary,
    textSecondary: theme.text.secondary,
  };
}

/**
 * One SDK subscription shared by every listener in this frame. The SDK's
 * unsubscribe tells Owlbear to stop sending the event to the whole frame, so
 * a component that unmounts would otherwise silence the others still listening.
 */
function shared<T>(subscribe: (cb: (value: T) => void) => () => void): (cb: (value: T) => void) => () => void {
  const listeners = new Set<(value: T) => void>();
  let off: (() => void) | null = null;
  return (cb) => {
    listeners.add(cb);
    off ??= subscribe((value) => listeners.forEach((listener) => listener(value)));
    return () => {
      listeners.delete(cb);
      if (listeners.size === 0 && off) {
        off();
        off = null;
      }
    };
  };
}

const onItemsChange = shared<Item[]>((cb) => OBR.scene.items.onChange(cb));
const onSceneReadyChange = shared<boolean>((cb) => OBR.scene.onReadyChange(cb));

const PANEL_MARGIN = 8;
const MIN_PANEL_WIDTH = 320;

export const obrPlatform: Platform = {
  kind: "owlbear",

  whenReady() {
    return new Promise((resolve) => (OBR.isReady ? resolve() : OBR.onReady(() => resolve())));
  },
  getRole: () => OBR.player.getRole(),
  isSceneReady: () => OBR.scene.isReady(),
  onSceneReadyChange,
  getItems: () => OBR.scene.items.getItems(),
  onItemsChange,
  addItems: (items) => OBR.scene.items.addItems(items),
  updateItems: (ids, update) => OBR.scene.items.updateItems(ids, (drafts) => update(drafts as Item[])),

  async selectAndFocus(ids) {
    if (ids.length === 0) return;
    await OBR.player.select(ids, true);
    const bounds = await OBR.scene.items.getItemBounds(ids);
    const pad = Math.max(bounds.width, bounds.height) * 1.5 + 150;
    await OBR.viewport.animateToBounds({
      min: { x: bounds.min.x - pad, y: bounds.min.y - pad },
      max: { x: bounds.max.x + pad, y: bounds.max.y + pad },
      width: bounds.width + pad * 2,
      height: bounds.height + pad * 2,
      center: bounds.center,
    });
  },

  getSelection: async () => (await OBR.player.getSelection()) ?? [],

  gridDpi: () => OBR.scene.grid.getDpi(),

  async snap(position, cells) {
    // Odd footprints centre on a square; even footprints centre on a grid corner.
    const even = Number.isInteger(cells) && cells % 2 === 0;
    return OBR.scene.grid.snapPosition(position, 1, even, !even);
  },

  async viewportCenter() {
    const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    return OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
  },

  getSceneMetadata: () => OBR.scene.getMetadata(),
  setSceneMetadata: (update) => OBR.scene.setMetadata(update),
  getRoomMetadata: () => OBR.room.getMetadata(),
  setRoomMetadata: (update) => OBR.room.setMetadata(update),

  async notify(message, variant = "DEFAULT") {
    await OBR.notification.show(message, variant);
  },

  openEditor: (query) =>
    OBR.modal.open({ id: EDITOR_MODAL_ID, url: `${extensionUrl("editor.html")}?${query}`, width: 1120, height: 760 }),
  closeEditor: () => OBR.modal.close(EDITOR_MODAL_ID),

  roomId: () => OBR.room.id,
  openModal: (id, url, width, height) => OBR.modal.open({ id, url, width, height }),
  closeModal: (id) => OBR.modal.close(id),

  async openSidePanel(id, url, maxWidth) {
    const margin = PANEL_MARGIN;
    const [width, height] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
    // Re-opening replaces whatever the panel was showing.
    await OBR.popover.close(id);
    await OBR.popover.open({
      id,
      url,
      width: Math.min(maxWidth, width - 2 * margin),
      height: height - 2 * margin,
      anchorReference: "POSITION",
      anchorPosition: { left: width - margin, top: margin },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      disableClickAway: true,
      marginThreshold: 0,
    });
  },
  closeSidePanel: (id) => OBR.popover.close(id),
  async resizeSidePanel(id, width) {
    const fits = Math.max(MIN_PANEL_WIDTH, (await OBR.viewport.getWidth()) - 2 * PANEL_MARGIN);
    const next = Math.round(Math.min(fits, Math.max(MIN_PANEL_WIDTH, width)));
    await OBR.popover.setWidth(id, next);
    return next;
  },
  openAction: () => OBR.action.open(),

  async saveToOwlbearStorage(spec) {
    const upload = buildImageUpload(spec.file)
      .name(spec.name)
      .dpi(spec.dpi)
      .visible(spec.visible)
      .plainText(spec.name)
      .textItemType("LABEL")
      .fontFamily(TOKEN_LABEL_FONT.fontFamily)
      .fontSize(TOKEN_LABEL_FONT.fontSize)
      .build();
    // The token layers share their names with Owlbear's asset types.
    await OBR.assets.uploadImages([upload], spec.layer === "MOUNT" || spec.layer === "PROP" ? spec.layer : "CHARACTER");
  },

  buildTokenItem(spec: TokenItemSpec) {
    return buildImage(spec.image, { dpi: spec.dpi, offset: { x: spec.image.width / 2, y: spec.image.height / 2 } })
      .name(spec.name)
      .position(spec.position)
      .layer(spec.layer)
      .visible(spec.visible)
      .metadata(spec.metadata)
      .plainText(spec.name)
      .textItemType("LABEL")
      .fontFamily(TOKEN_LABEL_FONT.fontFamily)
      .fontSize(TOKEN_LABEL_FONT.fontSize)
      .build();
  },

  startPlacement: (request: PlacementRequest) => OBR.broadcast.sendMessage(CH_PLACE, request, { destination: "LOCAL" }),
  sendLocal: (channel, data) => OBR.broadcast.sendMessage(channel, data, { destination: "LOCAL" }),
  sendToRoom: (channel, data) => OBR.broadcast.sendMessage(channel, data, { destination: "REMOTE" }),
  playerName: () => OBR.player.getName(),
  playerId: async () => OBR.player.id,
  onLocal: (channel, cb) => OBR.broadcast.onMessage(channel, (event) => cb(event.data)),

  getTheme: async () => themeInfo(await OBR.theme.getTheme()),
  onThemeChange: (cb) => OBR.theme.onChange((theme) => cb(themeInfo(theme))),
};
