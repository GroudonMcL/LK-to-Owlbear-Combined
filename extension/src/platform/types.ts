import type { ImageContent, Item, Layer, Metadata, Vector2 } from "@owlbear-rodeo/sdk";

export interface TokenItemSpec {
  name: string;
  image: ImageContent;
  /** Image pixels per grid square; sets the footprint. */
  dpi: number;
  position: Vector2;
  layer: Layer;
  visible: boolean;
  showLabel: boolean;
  metadata: Metadata;
}

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
  /** Opens this extension's toolbar popover. */
  openAction(): Promise<void>;
  /** Saves to the GM's Owlbear storage and lets them pick it back, returning its hosted image. */
  uploadToOwlbearStorage(file: File, name: string, dpi: number): Promise<ImageContent | null>;
  buildTokenItem(spec: TokenItemSpec): Item;
  startPlacement(request: PlacementRequest): Promise<void>;
  sendLocal(channel: string, data: unknown): Promise<void>;
  onLocal(channel: string, cb: (data: unknown) => void): () => void;
  getTheme(): Promise<ThemeInfo>;
  onThemeChange(cb: (theme: ThemeInfo) => void): () => void;
}
