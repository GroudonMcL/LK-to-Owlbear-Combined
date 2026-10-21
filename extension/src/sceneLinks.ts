// Page names in notes and Text items, underlined and clickable on the map
// itself. Runs in the background page; Settings turns it off.
//
// - Underlines (GM's browser): the underline mark written into the note's rich
//   text, so everyone sees it. Public pages only, since players see it too.
// - Clicking a word (everyone): an almost invisible local rectangle over each
//   linked word. Clicking it selects it; the extension notices the selection,
//   clears it and opens the page. Local items are only in this browser, so
//   each person clicks through to the pages they can open.
//
// Owlbear doesn't say where it draws each word, so textLayout.ts recreates
// the layout; the click areas are attached to their item so they follow moves.

import OBR, { buildShape, type Image, type Item, type Layer, type Text } from "@owlbear-rodeo/sdk";
import type { PageEntry } from "@lkob/shared";
import { NAMESPACE } from "./lib/links";
import { describeOpenError, openTextMatch } from "./lib/open";
import { addUnderlines, stripUnderlines, UNDERLINED_KEY } from "./lib/richUnderline";
import { LAYOUT, loadSceneLinkSettings } from "./lib/sceneLinkSettings";
import { blockText, layoutRanges, textBlocks, type FontSpec, type LayoutBox, type LayoutStyle } from "./lib/textLayout";
import { textSource, type PageMatcher } from "./lib/textMatch";
import { obrPlatform } from "./platform/obr";

/** Metadata on this extension's local click areas. */
const OVERLAY_KEY = `${NAMESPACE}/scene-link`;

/**
 * A note's image has a transparent margin (its shadow) around the card, and
 * the text starts at the card, not the image's edge: this much of the image's
 * width and height on each side.
 */
export const NOTE_MARGIN = 0.087;

type Role = "GM" | "PLAYER";

interface TextItem extends Item {
  text: { type?: string; plainText?: unknown; richText?: unknown; style: Partial<LayoutStyle>; width: number | "AUTO"; height: number | "AUTO" };
}

// Fonts -------------------------------------------------------------------

const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
const fontLoads = new Map<string, Promise<void>>();

/** Loads a font (from Google Fonts, where Owlbear's own fonts come from) so it can be measured. */
function ensureFont(family: string): Promise<void> {
  if (GENERIC_FONTS.has(family.toLowerCase())) return Promise.resolve();
  let load = fontLoads.get(family);
  if (!load) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=block`;
    document.head.appendChild(link);
    const loaded = new Promise<void>((resolve) => {
      link.onload = () => resolve();
      link.onerror = () => resolve();
    }).then(() =>
      Promise.all(["400", "700", "italic 400", "italic 700"].map((v) => document.fonts.load(`${v} 16px "${family}"`))).then(() => undefined),
    );
    // A font that never arrives is measured with the fallback.
    load = Promise.race([loaded, new Promise<void>((resolve) => setTimeout(resolve, 3000))]).catch(() => undefined);
    fontLoads.set(family, load);
  }
  return load;
}

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

function measure(text: string, font: FontSpec): number {
  if (!ctx) return text.length * font.size * 0.5;
  ctx.font = `${font.italic ? "italic " : ""}${font.weight} ${font.size}px "${font.family}", sans-serif`;
  return ctx.measureText(text).width;
}

function styleOf(item: TextItem): LayoutStyle {
  const s = item.text.style ?? {};
  return {
    fontFamily: s.fontFamily || "Roboto",
    fontSize: s.fontSize || 16,
    fontWeight: s.fontWeight || 400,
    lineHeight: s.lineHeight || 1.5,
    padding: s.padding ?? 0,
    textAlign: s.textAlign ?? "LEFT",
    textAlignVertical: s.textAlignVertical ?? "TOP",
  };
}

// The module --------------------------------------------------------------

export class SceneLinks {
  /** Per source item: what its click areas were drawn from, and their ids. */
  private drawn = new Map<string, { signature: string; ids: string[] }>();
  /** Click area id → the page it opens. */
  private targets = new Map<string, { itemId: string; page: PageEntry }>();
  private running: Promise<void> = Promise.resolve();

  constructor() {
    OBR.player.onChange((player) => void this.onSelection(player.selection ?? []));
  }

  /** Brings the click areas (and, for the GM, the underlines) up to date. Calls run one at a time. */
  update(items: Item[], matcher: PageMatcher | null, role: Role): Promise<void> {
    this.running = this.running.then(() => this.run(items, matcher, role)).catch((err) => console.warn("[LegendKeeper] scene links", err));
    return this.running;
  }

  /** Forgets what was drawn, without deleting it: a new scene starts with no local items. */
  reset(): void {
    this.drawn.clear();
    this.targets.clear();
  }

  /** Removes the click areas: no scene, or no page list. */
  clear(): Promise<void> {
    return this.update([], null, "PLAYER");
  }

  private async run(items: Item[], matcher: PageMatcher | null, role: Role): Promise<void> {
    const { enabled } = loadSceneLinkSettings();
    if (role === "GM") await this.syncUnderlines(items, enabled ? matcher : null);

    const wanted = new Map<string, TextItem>();
    if (enabled && matcher) {
      for (const item of items) {
        const source = textSource(item);
        if (source && matcher.find(source.text).length) wanted.set(item.id, item as TextItem);
      }
    }

    // Click areas of items that are gone or no longer name a page.
    for (const id of [...this.drawn.keys()].filter((id) => !wanted.has(id))) await this.remove(id);

    for (const item of wanted.values()) {
      try {
        await this.draw(item, matcher!);
      } catch (err) {
        console.warn("[LegendKeeper] couldn't draw links for", item.id, err);
      }
    }
  }

  private async remove(itemId: string): Promise<void> {
    const entry = this.drawn.get(itemId);
    this.drawn.delete(itemId);
    if (!entry) return;
    for (const id of entry.ids) this.targets.delete(id);
    if (entry.ids.length) await OBR.scene.local.deleteItems(entry.ids).catch(() => undefined);
  }

  private async draw(item: TextItem, matcher: PageMatcher): Promise<void> {
    const blocks = textBlocks(item.text);
    const ranges = blocks.map((block) => matcher.findRanges(blockText(block)));
    // Rotated text would need the layout rotated too; it keeps the right-click menu only.
    const rotated = Math.round(item.rotation) % 360 !== 0;
    const bounds = await OBR.scene.items.getItemBounds([item.id]);
    const signature = JSON.stringify([
      item.text,
      item.layer,
      item.zIndex,
      item.scale,
      rotated,
      bounds.min,
      bounds.max,
      ranges.map((rs) => rs.map((r) => [r.start, r.end, r.pages[0].id])),
    ]);
    if (this.drawn.get(item.id)?.signature === signature) return;
    await this.remove(item.id);
    if (rotated) {
      this.drawn.set(item.id, { signature, ids: [] });
      return;
    }

    const image = item.type === "IMAGE" ? (item as unknown as Image).image : null;
    // Scene units per text unit: a note's text is set in its image's pixels.
    const k = image ? bounds.width / image.width : Math.abs(item.scale.x) || 1;
    let origin = bounds.min;
    let box: LayoutBox;
    if (image) {
      const mx = image.width * NOTE_MARGIN;
      const my = image.height * NOTE_MARGIN;
      origin = { x: bounds.min.x + mx * k, y: bounds.min.y + my * k };
      box = { width: image.width - 2 * mx, height: image.height - 2 * my, wrap: true };
    } else {
      box = {
        width: typeof item.text.width === "number" ? item.text.width : bounds.width / k,
        height: typeof item.text.height === "number" ? item.text.height : bounds.height / k,
        wrap: typeof item.text.width === "number",
      };
    }
    const style = styleOf(item);
    await ensureFont(style.fontFamily);
    const placed = layoutRanges(blocks, ranges, style, box, LAYOUT, measure);

    const layer: Layer = item.layer === "NOTE" ? "NOTE" : "TEXT";
    const parts: Item[] = [];
    const newTargets: [string, PageEntry][] = [];
    placed.forEach((blockRects, b) =>
      blockRects.forEach((rects, r) => {
        const page = ranges[b][r].pages[0];
        for (const rect of rects) {
          const hit = buildShape()
            .shapeType("RECTANGLE")
            .width(rect.width * k)
            .height(rect.height * k)
            .position({ x: origin.x + rect.x * k, y: origin.y + rect.y * k })
            .fillColor("#000000")
            // Nearly invisible rather than invisible, so it still takes clicks.
            .fillOpacity(0.01)
            .strokeWidth(0)
            .strokeOpacity(0)
            .zIndex(item.zIndex + 1)
            .name(page.name)
            .metadata({ [OVERLAY_KEY]: { itemId: item.id } })
            .build();
          parts.push({
            ...hit,
            layer,
            attachedTo: item.id,
            disableAutoZIndex: true,
            disableAttachmentBehavior: ["COPY"],
          } as Item);
          newTargets.push([hit.id, page]);
        }
      }),
    );

    if (parts.length) await OBR.scene.local.addItems(parts);
    this.drawn.set(item.id, { signature, ids: parts.map((p) => p.id) });
    for (const [id, page] of newTargets) this.targets.set(id, { itemId: item.id, page });
  }

  // Clicks -----------------------------------------------------------------

  private handling = false;

  private async onSelection(selection: string[]): Promise<void> {
    // Only a single click on one of ours; a box selection passes through.
    if (selection.length !== 1 || this.handling) return;
    const id = selection[0];
    const target = this.targets.get(id);
    if (!target) return;
    this.handling = true;
    try {
      await OBR.player.deselect([id]).catch(() => undefined);
      // Redraw this item's click areas in case the click nudged one.
      const entry = this.drawn.get(target.itemId);
      if (entry) entry.signature = "";
      await openTextMatch(obrPlatform, { resourceId: target.page.id, name: target.page.name });
    } catch (err) {
      await OBR.notification.show(describeOpenError(err), "ERROR").catch(() => undefined);
    } finally {
      this.handling = false;
    }
  }

  // Underlines (GM) ----------------------------------------------------------

  /** Underlines public page names in rich text; with no matcher, takes this extension's underlines off. */
  private async syncUnderlines(items: Item[], matcher: PageMatcher | null): Promise<void> {
    // Leave alone what the GM is editing: a write would fight their typing.
    const selected = new Set((await OBR.player.getSelection().catch(() => undefined)) ?? []);
    const updates = new Map<string, { richText: unknown[]; phrases: string[] }>();
    for (const item of items) {
      if (selected.has(item.id) || !textSource(item)) continue;
      const text = (item as TextItem).text;
      if (text.type !== "RICH" || !Array.isArray(text.richText)) continue;
      const recorded = Array.isArray(item.metadata[UNDERLINED_KEY]) ? (item.metadata[UNDERLINED_KEY] as string[]) : [];
      if (!matcher && recorded.length === 0) continue;
      const stripped = stripUnderlines(text.richText, new Set(recorded));
      // Hidden pages are left out: players see these underlines too.
      const result = matcher
        ? addUnderlines(stripped, (t) => matcher.findRanges(t).filter((r) => r.pages.some((p) => !p.hidden)))
        : { nodes: stripped, phrases: [] };
      const changed = JSON.stringify(result.nodes) !== JSON.stringify(text.richText) || result.phrases.join("\n") !== recorded.join("\n");
      if (changed) updates.set(item.id, { richText: result.nodes, phrases: result.phrases });
    }
    if (updates.size === 0) return;
    await OBR.scene.items.updateItems([...updates.keys()], (drafts) => {
      for (const draft of drafts) {
        const update = updates.get(draft.id);
        if (!update) continue;
        (draft as unknown as Text).text.richText = update.richText as Text["text"]["richText"];
        if (update.phrases.length) draft.metadata[UNDERLINED_KEY] = update.phrases;
        else delete draft.metadata[UNDERLINED_KEY];
      }
    });
  }
}
