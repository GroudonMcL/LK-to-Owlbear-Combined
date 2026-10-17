// Turns an edited token into an Owlbear item: export → host → build → place.
// With Owlbear storage it is saved to the GM's assets instead, to drag in.

import type { ImageContent, Item, Layer } from "@owlbear-rodeo/sdk";
import type { Platform } from "../platform/types";
import { CH_TOKEN_CREATED } from "../platform/channels";
import type { ApiClient } from "./api";
import { rememberAssetLink } from "./assetLinks";
import { asLinkable, syncRoomIndex } from "./existing";
import { createLink, LINK_KEY, parseLink } from "./links";
import type { Placement, TokenHosting } from "./settings";

export interface CreateTokenRequest {
  projectId: string;
  resourceId: string;
  pageTitle: string;
  name: string;
  png: Blob;
  pixelSize: number;
  cells: number;
  layer: Layer;
  visible: boolean;
  hosting: TokenHosting;
  placement: Placement;
  /** Stable per editor session: a retried click never makes a second token. */
  importId: string;
}

export type CreateTokenResult =
  | { status: "created"; itemId: string }
  | { status: "placing" }
  | { status: "already-created"; itemId: string }
  /** Saved to the GM's Owlbear storage, to drag onto the map from Owlbear's Assets panel. */
  | { status: "saved" };

async function existingImport(platform: Platform, importId: string): Promise<Item | null> {
  const items = await platform.getItems();
  return (
    (asLinkable(items).find((item) => {
      const parsed = parseLink(item.metadata);
      return parsed?.status === "valid" && parsed.link.importId === importId;
    }) as unknown as Item | undefined) ?? null
  );
}

export async function createToken(platform: Platform, api: ApiClient | null, req: CreateTokenRequest): Promise<CreateTokenResult> {
  // A previous attempt may have succeeded even if its response was lost.
  const earlier = await existingImport(platform, req.importId);
  if (earlier) return { status: "already-created", itemId: earlier.id };

  const link = createLink(req.projectId, req.resourceId, req.pageTitle, req.importId);

  if (req.hosting === "owlbear") {
    // Owlbear's upload dialog returns nothing to place, so the GM drags the
    // token in from Assets and the background page links it then.
    const file = new File([req.png], `${req.name.replace(/[^\w\- ]+/g, "").trim() || "token"}.png`, { type: "image/png" });
    rememberAssetLink(req.name, link);
    await platform.saveToOwlbearStorage({ file, name: req.name, dpi: req.pixelSize / req.cells, layer: req.layer, visible: req.visible });
    return { status: "saved" };
  }

  if (!api) throw new Error("Connect LegendKeeper in Settings, or switch hosting to Owlbear storage.");
  const uploaded = await api.uploadToken(req.png);
  const image: ImageContent = { url: uploaded.url, width: uploaded.width, height: uploaded.height, mime: uploaded.mime };
  const cleanupHash = uploaded.created ? uploaded.hash : null;

  const position = await platform.snap(await platform.viewportCenter(), req.cells);
  const item = platform.buildTokenItem({
    name: req.name,
    image,
    // Footprint: the image spans `cells` grid squares whatever its pixel size.
    dpi: image.width / req.cells,
    position,
    layer: req.layer,
    visible: req.visible,
    metadata: { [LINK_KEY]: link },
  });

  try {
    if (req.placement === "manual") {
      await platform.startPlacement({ item, cells: req.cells, cleanupHash });
      return { status: "placing" };
    }
    await platform.addItems([item]);
  } catch (err) {
    // Don't leave an orphaned image behind if the token never made it into the scene.
    if (cleanupHash && api) await api.deleteToken(cleanupHash).catch(() => undefined);
    throw err;
  }

  await platform.selectAndFocus([item.id]).catch(() => undefined);
  await platform.sendLocal(CH_TOKEN_CREATED, { projectId: req.projectId, resourceId: req.resourceId }).catch(() => undefined);
  try {
    await syncRoomIndex(platform, await platform.getItems());
  } catch {
    // The background page also keeps the index in sync.
  }
  return { status: "created", itemId: item.id };
}
