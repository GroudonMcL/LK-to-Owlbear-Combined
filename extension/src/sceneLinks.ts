// Page names in notes and Text items, marked and clickable on the map itself
// (the Test settings tab turns each part on or off). Runs in the background page.
//
// - Overlay underlines: thin local rectangles drawn under the words. Local
//   items are only in this browser, so each person sees their own matches.
// - Real underlines (GM only): the underline mark written into the note's rich
//   text, for public pages only, since everyone sees it.
// - Click a word (option B): an invisible local rectangle over each linked
//   word. Clicking it selects it; the extension notices the selection, clears
//   it and opens the page.
// - Badge (option C): a book on the item's corner, clicked the same way. One
//   page opens directly; several open a small list.
//
// Owlbear doesn't say where it draws each word, so textLayout.ts recreates
// the layout; the overlay is attached to its item so it follows moves.

import OBR, { buildImage, buildShape, type Image, type Item, type Layer, type Text } from "@owlbear-rodeo/sdk";
import type { PageEntry } from "@lkob/shared";
import { NAMESPACE } from "./lib/links";
import { describeOpenError, openTextMatch } from "./lib/open";
import { addUnderlines, stripUnderlines, UNDERLINED_KEY } from "./lib/richUnderline";
import { loadSceneLinkSettings, type SceneLinkSettings } from "./lib/sceneLinkSettings";
import { blockText, layoutRanges, textBlocks, type FontSpec, type LayoutBox, type LayoutStyle } from "./lib/textLayout";
import { textSource, type PageMatcher } from "./lib/textMatch";
import { extensionUrl } from "./platform/channels";
import { obrPlatform } from "./platform/obr";

/** Metadata on this extension's local overlay items. */
const OVERLAY_KEY = `${NAMESPACE}/scene-link`;
const BADGE_MENU_ID = `${NAMESPACE}/badge-menu`;

type Role = "GM" | "PLAYER";

interface Target {
  itemId: string;
  /** The word's page, for a word; every page the item names, for a badge. */
  pages: PageEntry[];
  kind: "word" | "badge";
  /** Scene position to anchor the list of pages to (badges). */
  at?: { x: number; y: number };
}

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

// Helpers -----------------------------------------------------------------

function styleOf(item: TextItem, settings: SceneLinkSettings): LayoutStyle {
  const s = item.text.style ?? {};
  return {
    fontFamily: s.fontFamily || "Roboto",
    fontSize: (s.fontSize || 16) * settings.textScale,
    fontWeight: s.fontWeight || 400,
    lineHeight: s.lineHeight || 1.5,
    padding: (s.padding ?? 0) * settings.textScale,
    textAlign: s.textAlign ?? "LEFT",
    textAlignVertical: s.textAlignVertical ?? "TOP",
  };
}

function uniquePages(ranges: { pages: PageEntry[] }[]): PageEntry[] {
  const out = new Map<string, PageEntry>();
  for (const r of ranges) for (const p of r.pages) if (!out.has(p.id)) out.set(p.id, p);
  return [...out.values()];
}

// The module --------------------------------------------------------------

export class SceneLinks {
  /** Per source item: what its overlay was drawn from, and the overlay's ids. */
  private drawn = new Map<string, { signature: string; ids: string[] }>();
  private targets = new Map<string, Target>();
  private running: Promise<void> = Promise.resolve();

  constructor() {
    OBR.player.onChange((player) => void this.onSelection(player.selection ?? []));
  }

  /** Brings the overlay (and, for the GM, real underlines) up to date. Calls run one at a time. */
  update(items: Item[], matcher: PageMatcher | null, role: Role): Promise<void> {
    this.running = this.running.then(() => this.run(items, matcher, role)).catch((err) => console.warn("[LegendKeeper] scene links", err));
    return this.running;
  }

  /** Forgets what was drawn, without deleting it: a new scene starts with no local items. */
  reset(): void {
    this.drawn.clear();
    this.targets.clear();
  }

  /** Removes the overlay: no scene, or no page list. */
  clear(): Promise<void> {
    return this.update([], null, "PLAYER");
  }

  private async run(items: Item[], matcher: PageMatcher | null, role: Role): Promise<void> {
    const settings = loadSceneLinkSettings();
    if (role === "GM") await this.syncRichUnderlines(items, matcher, settings);

    const wanted = new Map<string, TextItem>();
    if (settings.enabled && matcher) {
      for (const item of items) {
        const source = textSource(item);
        if (source && matcher.find(source.text).length) wanted.set(item.id, item as TextItem);
      }
    }

    // Overlays of items that are gone or no longer name a page.
    const stale = [...this.drawn.keys()].filter((id) => !wanted.has(id));
    for (const id of stale) await this.remove(id);

    for (const item of wanted.values()) {
      try {
        await this.draw(item, matcher!, settings);
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

  private async draw(item: TextItem, matcher: PageMatcher, settings: SceneLinkSettings): Promise<void> {
    const blocks = textBlocks(item.text);
    const ranges = blocks.map((block) => matcher.findRanges(blockText(block)));
    const pages = uniquePages(ranges.flat());
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
      settings,
      ranges.map((rs) => rs.map((r) => [r.start, r.end, r.pages.map((p) => p.id)])),
    ]);
    if (this.drawn.get(item.id)?.signature === signature) return;
    await this.remove(item.id);

    const image = item.type === "IMAGE" ? (item as unknown as Image).image : null;
    // Scene units per text unit: a note's text is set in its image's pixels.
    const k = image ? bounds.width / image.width : Math.abs(item.scale.x) || 1;
    const layer: Layer = item.layer === "NOTE" ? "NOTE" : "TEXT";
    const base = {
      layer,
      attachedTo: item.id,
      disableAutoZIndex: true,
      disableAttachmentBehavior: ["COPY" as const],
    };
    const built: Item[] = [];
    const newTargets: [string, Target][] = [];
    const style = styleOf(item, settings);

    // Rotated text would need the layout rotated too; it gets the badge only.
    const needLayout = !rotated && (settings.underline === "overlay" || settings.clickWords || settings.showBoxes);
    if (needLayout) {
      await ensureFont(style.fontFamily);
      const box: LayoutBox = image
        ? { width: image.width, height: image.height, wrap: true }
        : {
            width: typeof item.text.width === "number" ? item.text.width : bounds.width / k,
            height: typeof item.text.height === "number" ? item.text.height : bounds.height / k,
            wrap: typeof item.text.width === "number",
          };
      const placed = layoutRanges(blocks, ranges, style, box, settings, measure);
      placed.forEach((blockRects, b) =>
        blockRects.forEach((rects, r) => {
          const range = ranges[b][r];
          for (const rect of rects) {
            const x = bounds.min.x + rect.x * k;
            const y = bounds.min.y + rect.y * k;
            const w = rect.width * k;
            if (settings.underline === "overlay" && !rect.underlined) {
              const thickness = Math.max(1, settings.thickness * rect.fontSize * k);
              built.push(
                buildShape()
                  .shapeType("RECTANGLE")
                  .width(w)
                  .height(thickness)
                  .position({ x, y: bounds.min.y + (rect.baseline + settings.offset * rect.fontSize) * k })
                  .fillColor(settings.color)
                  .fillOpacity(settings.opacity)
                  .strokeWidth(0)
                  .strokeOpacity(0)
                  .zIndex(item.zIndex + 1)
                  .locked(true)
                  .disableHit(true)
                  .metadata({ [OVERLAY_KEY]: { itemId: item.id, part: "line" } })
                  .build(),
              );
            }
            if (settings.clickWords || settings.showBoxes) {
              const hit = buildShape()
                .shapeType("RECTANGLE")
                .width(w)
                .height(rect.height * k)
                .position({ x, y })
                .fillColor(settings.showBoxes ? "#4fc3f7" : "#000000")
                // Nearly invisible rather than invisible, so it still takes clicks.
                .fillOpacity(settings.showBoxes ? 0.3 : 0.01)
                .strokeColor("#4fc3f7")
                .strokeWidth(settings.showBoxes ? 1 : 0)
                .strokeOpacity(settings.showBoxes ? 0.8 : 0)
                .zIndex(item.zIndex + 2)
                .disableHit(!settings.clickWords)
                .locked(!settings.clickWords)
                .name(range.pages[0].name)
                .metadata({ [OVERLAY_KEY]: { itemId: item.id, part: "word" } })
                .build();
              built.push(hit);
              if (settings.clickWords) newTargets.push([hit.id, { itemId: item.id, pages: range.pages.slice(0, 1), kind: "word" }]);
            }
          }
        }),
      );
    }

    if (settings.badge && pages.length) {
      const dpi = await OBR.scene.grid.getDpi();
      const size = Math.min(dpi * 0.6, Math.max(dpi * 0.3, Math.min(bounds.width, bounds.height) * 0.14));
      const at = { x: bounds.max.x, y: bounds.min.y };
      const badge = buildImage(
        { url: extensionUrl("icons/badge.png"), mime: "image/png", width: 128, height: 128 },
        { dpi: 128, offset: { x: 64, y: 64 } },
      )
        .position(at)
        .scale({ x: size / dpi, y: size / dpi })
        .zIndex(item.zIndex + 3)
        .name(pages.length === 1 ? `Open ${pages[0].name}` : `${pages.length} LegendKeeper pages`)
        .metadata({ [OVERLAY_KEY]: { itemId: item.id, part: "badge" } })
        .build();
      built.push(badge);
      newTargets.push([badge.id, { itemId: item.id, pages, kind: "badge", at }]);
    }

    const parts = built.map((b) => ({ ...b, ...base }) as Item);
    if (parts.length) await OBR.scene.local.addItems(parts);
    this.drawn.set(item.id, { signature, ids: parts.map((p) => p.id) });
    for (const [id, target] of newTargets) this.targets.set(id, target);
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
      // Redraw this item's overlay in case the click nudged a part of it.
      const entry = this.drawn.get(target.itemId);
      if (entry) entry.signature = "";
      if (target.pages.length === 1) {
        const page = target.pages[0];
        await openTextMatch(obrPlatform, { resourceId: page.id, name: page.name });
      } else {
        await this.openList(target);
      }
    } catch (err) {
      await OBR.notification.show(describeOpenError(err), "ERROR").catch(() => undefined);
    } finally {
      this.handling = false;
    }
  }

  /** The pages a badge stands for, as a small list beside it. */
  private async openList(target: Target): Promise<void> {
    const at = target.at ? await OBR.viewport.transformPoint(target.at) : { x: 200, y: 200 };
    await OBR.popover.close(BADGE_MENU_ID).catch(() => undefined);
    await OBR.popover.open({
      id: BADGE_MENU_ID,
      url: extensionUrl("textmenu.html", { item: target.itemId, popover: BADGE_MENU_ID }),
      width: 260,
      height: Math.min(300, 16 + 34 * target.pages.length),
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(at.x), top: Math.round(at.y) },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    });
  }

  // Real underlines (GM) ------------------------------------------------------

  private async syncRichUnderlines(items: Item[], matcher: PageMatcher | null, settings: SceneLinkSettings): Promise<void> {
    const on = settings.enabled && settings.underline === "rich" && matcher !== null;
    // Leave alone what the GM is editing: a write would fight their typing.
    const selected = new Set((await OBR.player.getSelection().catch(() => undefined)) ?? []);
    const updates = new Map<string, { richText: unknown[]; phrases: string[] }>();
    for (const item of items) {
      if (selected.has(item.id) || !textSource(item)) continue;
      const text = (item as TextItem).text;
      if (text.type !== "RICH" || !Array.isArray(text.richText)) continue;
      const recorded = Array.isArray(item.metadata[UNDERLINED_KEY]) ? (item.metadata[UNDERLINED_KEY] as string[]) : [];
      if (!on && recorded.length === 0) continue;
      const stripped = stripUnderlines(text.richText, new Set(recorded));
      // Hidden pages are left out: players see these underlines too.
      const result = on
        ? addUnderlines(stripped, (t) => matcher!.findRanges(t).filter((r) => r.pages.some((p) => !p.hidden)))
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
