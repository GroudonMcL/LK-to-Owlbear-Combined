// Page lists: every page of a project with just what token matching needs
// (names, aliases, tags, folders). The GM's list comes from the Worker's API
// key; players get the public list, fetched from LegendKeeper without a key.

/** One LegendKeeper page (a "resource" in the API) in a page list. */
export interface PageEntry {
  id: string;
  name: string;
  aliases: string[];
  tags: string[];
  /** Names of the folders above this page, outermost first. */
  path: string[];
  /** The page or a folder above it is hidden in LegendKeeper. */
  hidden: boolean;
  /** The page's colour in LegendKeeper (`#RRGGBB`), if set. */
  iconColor?: string | null;
}

export type PageListAudience = "public" | "gm";

export interface PageList {
  projectId: string;
  projectName: string;
  isPublic: boolean;
  generatedAt: string;
  /** "public" lists are what an anonymous visitor sees; "gm" lists include hidden pages. */
  audience: PageListAudience;
  pages: PageEntry[];
  /** True when the project had more pages than the server lists. */
  truncated: boolean;
}
