import type { ImageContent, Item, Layer, Metadata, Vector2 } from "@owlbear-rodeo/sdk";

export interface TokenItemSpec {
  name: string;
  image: ImageContent;
  /** Image pixels per grid square; sets the footprint. */
  dpi: number;
  position: Vector2;
  layer: Layer;
  visible: boolean;
  metadata: Metadata;
}

/** A finished token to save in the GM's Owlbear storage, for them to drag onto the map. */
export interface TokenUploadSpec {
  file: File;
  name: string;
  /** Image pixels per grid square; sets the footprint. */
  dpi: number;
  layer: Layer;
  visible: boolean;
}

/** Every token's name label: Owlbear's label text, in a serif face. */
export const TOKEN_LABEL_FONT = { fontFamily: "serif", fontSize: 18 } as const;

/** Sent to the background page to place a token by clicking the map. */
export interface PlacementRequest {
  item: Item;
  cells: number;
  /** Hosted image to delete if placement is cancelled (only if it was newly stored). */
  cleanupHash: string | null;
}

/** Owlbear's theme colours, which the extension's surfaces and text follow. */
export interface ThemeInfo {
  mode: "DARK" | "LIGHT";
  /** Panel colour (background.paper). */
  paper?: string;
  /** Page colour behind panels (background.default). */
  background?: string;
  text?: string;
  textSecondary?: string;
}

export type NotifyVariant = "DEFAULT" | "ERROR" | "INFO" | "SUCCESS" | "WARNING";

/**
 * Everything the extension needs from Owlbear Rodeo. The real implementation
 * wraps the SDK; a mock backs local development and UI tests.
 */
export interface Platform {
  readonly kind: "owlbear" | "mock";
  whenReady(): Promise<void>;
  getRole(): Promise<"GM" | "PLAYER">;
  isSceneReady(): Promise<boolean>;
  onSceneReadyChange(cb: (ready: boolean) => void): () => void;
  getItems(): Promise<Item[]>;
  onItemsChange(cb: (items: Item[]) => void): () => void;
  addItems(items: Item[]): Promise<void>;
  updateItems(ids: string[], update: (items: Item[]) => void): Promise<void>;
  selectAndFocus(ids: string[]): Promise<void>;
  /** Ids of the items this player has selected. */
  getSelection(): Promise<string[]>;
  gridDpi(): Promise<number>;
  /** Snaps a token centre so a footprint of `cells` squares lines up with the grid. */
  snap(position: Vector2, cells: number): Promise<Vector2>;
  viewportCenter(): Promise<Vector2>;
  getSceneMetadata(): Promise<Metadata>;
  setSceneMetadata(update: Metadata): Promise<void>;
  getRoomMetadata(): Promise<Metadata>;
  setRoomMetadata(update: Metadata): Promise<void>;
  notify(message: string, variant?: NotifyVariant): Promise<void>;
  openEditor(query: URLSearchParams): Promise<void>;
  closeEditor(): Promise<void>;
  /** The room's id, for per-room browser storage. */
  roomId(): string;
  openModal(id: string, url: string, width: number, height: number): Promise<void>;
  closeModal(id: string): Promise<void>;
  /** A full-height panel pinned to the viewport's right edge that stays open on click-away; replaces one with the same id. */
  openSidePanel(id: string, url: string, maxWidth: number): Promise<void>;
  closeSidePanel(id: string): Promise<void>;
  /** Sets the side panel's width (it grows to the left), within what fits on screen; returns the width set. */
  resizeSidePanel(id: string, width: number): Promise<number>;
  /** Opens this extension's toolbar popover. */
  openAction(): Promise<void>;
  /** Opens Owlbear's dialog to save a token to the GM's storage. Owlbear reports nothing back. */
  saveToOwlbearStorage(spec: TokenUploadSpec): Promise<void>;
  buildTokenItem(spec: TokenItemSpec): Item;
  startPlacement(request: PlacementRequest): Promise<void>;
  sendLocal(channel: string, data: unknown): Promise<void>;
  /** Sends to this extension in every other browser in the room. */
  sendToRoom(channel: string, data: unknown): Promise<void>;
  /** This person's name in the room. */
  playerName(): Promise<string>;
  onLocal(channel: string, cb: (data: unknown) => void): () => void;
  getTheme(): Promise<ThemeInfo>;
  onThemeChange(cb: (theme: ThemeInfo) => void): () => void;
}
