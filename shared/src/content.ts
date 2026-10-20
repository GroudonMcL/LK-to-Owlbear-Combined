// A page's content, for reading it inside Owlbear. The server turns
// LegendKeeper's block tree into this smaller, display-only model: text with
// marks, structure, and images by page-scoped id (never asset URLs).

export interface ContentRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  /** An http(s) link. */
  link?: string;
  /** A mention of another page in the same project. */
  mention?: string;
}

/** A line break inside a block. */
export const BREAK: ContentRun = { text: "\n" };

export type ContentBlock =
  | { kind: "paragraph"; runs: ContentRun[] }
  | { kind: "heading"; level: number; runs: ContentRun[] }
  | { kind: "quote"; children: ContentBlock[] }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "list"; ordered: boolean; start?: number; items: ContentBlock[][] }
  | { kind: "task"; checked: boolean; runs: ContentRun[] }
  | { kind: "table"; rows: { header: boolean; text: ContentRun[] }[][] }
  | { kind: "image"; imageId: string; caption?: string }
  | { kind: "keyValue"; rows: { key: string; runs: ContentRun[] }[] }
  /** A titled or tinted container: callout, expand, secret, text field, infobox. */
  | { kind: "box"; tone: "callout" | "expand" | "secret" | "field" | "infobox"; title?: string; children: ContentBlock[] }
  /** Something LegendKeeper's API can't express here (maps, embeds, boards…). */
  | { kind: "unsupported"; label: string };

export interface ContentDocument {
  id: string;
  name: string;
  blocks: ContentBlock[];
  /** True when the document could not be read. */
  failed?: boolean;
}

export interface PageContent {
  projectId: string;
  id: string;
  name: string;
  aliases: string[];
  tags: string[];
  /** The page sidebar (properties), as blocks. */
  sidebar: ContentBlock[];
  documents: ContentDocument[];
  /** Documents that aren't pages (maps, boards, timelines), by name. */
  otherDocuments: string[];
  warnings: string[];
  fetchedAt: string;
}
