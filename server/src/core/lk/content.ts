// Turns LegendKeeper blocks into the display-only PageContent model (see
// shared/src/content.ts). Unknown kinds degrade to their children or to an
// "unsupported" marker; nothing upstream is passed through unchecked.

import type { ContentBlock, ContentRun } from "@lkob/shared";
import { imageIdFor } from "./extract.js";
import type { LkNode } from "./types.js";

const MAX_DEPTH = 64;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeLink(value: unknown): string | undefined {
  return typeof value === "string" && /^https?:\/\//i.test(value) && value.length <= 2048 ? value : undefined;
}

/** A run array as display runs: marks kept, mentions labelled, breaks as "\n". */
export function toRuns(runs: unknown): ContentRun[] {
  if (!Array.isArray(runs)) return [];
  const out: ContentRun[] = [];
  for (const run of runs) {
    if (!run || typeof run !== "object") continue;
    const r = run as Record<string, unknown>;
    if (r.break === true) {
      out.push({ text: "\n" });
      continue;
    }
    let text = "";
    let mention: string | undefined;
    if (typeof r.text === "string") text = r.text;
    else if (r.mention && typeof r.mention === "object") {
      const m = r.mention as Record<string, unknown>;
      text = str(m.text) || str(m.name);
      mention = str(m.resourceId) || undefined;
    }
    if (!text) continue;
    const marked: ContentRun = { text };
    for (const mark of ["bold", "italic", "underline", "strike", "code"] as const) if (r[mark] === true) marked[mark] = true;
    const link = safeLink(r.link);
    if (link) marked.link = link;
    if (mention) marked.mention = mention;
    out.push(marked);
  }
  return out;
}

/** All text below a node, flattened into runs (for table cells). */
function flatRuns(node: unknown, depth = 0): ContentRun[] {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return [];
  const n = node as LkNode;
  const out: ContentRun[] = [];
  if (Array.isArray(n.content)) out.push(...toRuns(n.content));
  if (Array.isArray(n.children)) {
    for (const child of n.children) {
      const inner = flatRuns(child, depth + 1);
      if (inner.length && out.length) out.push({ text: "\n" });
      out.push(...inner);
    }
  }
  return out;
}

const UNSUPPORTED_LABELS: Record<string, string> = {
  map: "Map",
  embed: "Embedded content",
  meter: "Meter",
  resourceCollection: "Page collection",
  resourceLink: "Linked pages",
  unsupported: "Content not available through the API",
};

/** Converts a list of LegendKeeper blocks (or sidebar properties). */
export async function toContent(nodes: unknown, depth = 0): Promise<ContentBlock[]> {
  if (!Array.isArray(nodes) || depth > MAX_DEPTH) return [];
  const out: ContentBlock[] = [];
  for (const node of nodes) out.push(...(await toBlock(node, depth)));
  return out;
}

async function toBlock(node: unknown, depth: number): Promise<ContentBlock[]> {
  if (!node || typeof node !== "object") return [];
  const n = node as LkNode;
  const children = () => toContent(n.children, depth + 1);
  const title = str(n.title).trim() || undefined;
  const titled = n.isTitleHidden === true ? undefined : title;

  switch (n.kind) {
    case "paragraph":
      return [{ kind: "paragraph", runs: toRuns(n.content) }];
    case "heading": {
      const level = typeof n.level === "number" ? Math.min(6, Math.max(1, Math.round(n.level))) : 2;
      return [{ kind: "heading", level, runs: toRuns(n.content) }];
    }
    case "quote":
      return [{ kind: "quote", children: Array.isArray(n.children) ? await children() : [{ kind: "paragraph", runs: toRuns(n.content) }] }];
    case "code":
      return [{ kind: "code", text: str(n.text) }];
    case "rule":
      return [{ kind: "rule" }];
    case "bulletList":
    case "orderedList":
    case "taskList": {
      if (n.kind === "taskList") return children();
      const items: ContentBlock[][] = [];
      for (const item of Array.isArray(n.children) ? n.children : []) {
        const it = item as LkNode;
        items.push(it?.kind === "listItem" ? await toContent(it.children, depth + 2) : await toBlock(it, depth + 1));
      }
      const start = typeof n.start === "number" && n.start !== 1 ? n.start : undefined;
      return [{ kind: "list", ordered: n.kind === "orderedList", ...(start !== undefined ? { start } : {}), items }];
    }
    case "listItem":
      return children();
    case "taskItem":
      return [{ kind: "task", checked: n.checked === true, runs: toRuns(n.content) }];
    case "table": {
      const rows: { header: boolean; text: ContentRun[] }[][] = [];
      for (const row of Array.isArray(n.children) ? n.children : []) {
        const cells = Array.isArray((row as LkNode)?.children) ? ((row as LkNode).children as LkNode[]) : [];
        rows.push(cells.map((cell) => ({ header: cell?.header === true, text: flatRuns(cell) })));
      }
      return [{ kind: "table", rows }];
    }
    case "image": {
      const url = str(n.url);
      if (!/^https?:\/\//i.test(url)) return [];
      const caption = titled && title?.toLowerCase() !== "image" ? title : str(n.alt) || undefined;
      return [{ kind: "image", imageId: await imageIdFor(url), ...(caption ? { caption } : {}) }];
    }
    case "keyValue": {
      const rows = (Array.isArray(n.rows) ? n.rows : []).flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const r = row as Record<string, unknown>;
        const runs = toRuns(r.content);
        return [{ key: str(r.key), runs: runs.length ? runs : str(r.text) ? [{ text: str(r.text) }] : [] }];
      });
      const block: ContentBlock = { kind: "keyValue", rows };
      return titled ? [{ kind: "box", tone: "field", title: titled, children: [block] }] : [block];
    }
    case "infobox":
      return [{ kind: "box", tone: "infobox", children: await toContent(n.rows, depth + 1) }];
    case "callout":
      return [{ kind: "box", tone: "callout", children: await children() }];
    case "expand":
      return [{ kind: "box", tone: "expand", ...(title ? { title } : {}), children: await children() }];
    case "secret":
      return [{ kind: "box", tone: "secret", title: "Secret", children: await children() }];
    case "textField":
      return [{ kind: "box", tone: "field", ...(titled ? { title: titled } : {}), children: await children() }];
    case "layout":
    case "layoutColumn":
    case "tableRow":
    case "tableCell":
      return children();
    default: {
      if (Array.isArray(n.children)) return children();
      const label = UNSUPPORTED_LABELS[str(n.kind)] ?? "Content not shown here";
      return [{ kind: "unsupported", label: title ? `${label}: ${title}` : label }];
    }
  }
}
