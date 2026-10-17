import { beforeEach, describe, expect, it } from "vitest";
import { linksForPlacedItems, loadAssetLinks, rememberAssetLink, type PlacedItem } from "../src/lib/assetLinks";
import { createLink, LINK_KEY } from "../src/lib/links";

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const link = createLink("proj", "goblin", "Goblin Boss", "imp1");
const placed = (over: Partial<PlacedItem> = {}): PlacedItem => ({
  id: "a",
  type: "IMAGE",
  name: "Goblin Boss",
  createdUserId: "gm",
  metadata: {},
  ...over,
});

describe("asset links", () => {
  beforeEach(() => store.clear());

  it("remembers a stored token's link, newest per name first", () => {
    rememberAssetLink("Goblin Boss", link, 1000);
    rememberAssetLink("Goblin Boss", { ...link, resourceId: "goblin2" }, 2000);
    const entries = loadAssetLinks(3000);
    expect(entries).toHaveLength(1);
    expect(entries[0].link.resourceId).toBe("goblin2");
  });

  it("forgets links after 30 days", () => {
    rememberAssetLink("Goblin Boss", link, 0);
    expect(loadAssetLinks(31 * 24 * 60 * 60 * 1000)).toEqual([]);
  });

  it("links an image this player placed with the asset's name", () => {
    rememberAssetLink("Goblin Boss", link, 1000);
    expect(linksForPlacedItems([placed()], loadAssetLinks(1000), "gm")).toEqual([{ id: "a", link }]);
  });

  it("leaves other players' items, other names and already-linked tokens alone", () => {
    const entries = [{ name: "Goblin Boss", link, savedAt: 0 }];
    expect(linksForPlacedItems([placed({ createdUserId: "player" })], entries, "gm")).toEqual([]);
    expect(linksForPlacedItems([placed({ name: "Orc" })], entries, "gm")).toEqual([]);
    expect(linksForPlacedItems([placed({ metadata: { [LINK_KEY]: link } })], entries, "gm")).toEqual([]);
    expect(linksForPlacedItems([placed({ type: "SHAPE" })], entries, "gm")).toEqual([]);
  });
});
