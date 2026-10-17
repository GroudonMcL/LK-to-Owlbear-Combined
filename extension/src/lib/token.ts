import { isImage } from "@owlbear-rodeo/sdk";
import type { Descendant, Item, KeyFilter } from "@owlbear-rodeo/sdk";

const TOKEN_LAYERS = ["CHARACTER", "MOUNT", "PROP"] as const;

/** Context menu filter: an image on the Character, Mount or Prop layer. */
export const TOKEN_FILTER: KeyFilter[] = [
  { key: "layer", value: "CHARACTER", coordinator: "||" },
  { key: "layer", value: "MOUNT", coordinator: "||" },
  { key: "layer", value: "PROP", coordinator: "&&" },
  { key: "type", value: "IMAGE" },
];

export function isToken(item: Item): boolean {
  return isImage(item) && (TOKEN_LAYERS as readonly string[]).includes(item.layer);
}

/** The text label shown on the token, or "" when it has none. */
export function tokenLabel(item: Item): string {
  if (!isImage(item)) return "";
  const { text } = item;
  const label = text.type === "RICH" ? richTextToPlain(text.richText) : text.plainText;
  return label.trim();
}

function richTextToPlain(nodes: Descendant[]): string {
  return nodes
    .map((node) => ("text" in node ? node.text : richTextToPlain(node.children)))
    .join(" ");
}
