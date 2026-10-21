// Turns LegendKeeper's resource listing into a page list. The server keeps
// the listing (built a step at a time, see StoredPageList) and each browser
// builds its page list from it, so this lives in shared code.

import type { PageList, PageListAudience } from "./pages.js";

/** One resource as listed by LegendKeeper (a ResourceListItem), trimmed. */
export interface ListedResource {
  id: string;
  name: string;
  parentId?: string | null;
  tags?: string[];
  aliases?: string[];
  isHidden?: boolean;
  iconColor?: string | null;
}

/**
 * A project's whole resource listing as the server stores it, ready for
 * everyone at once: the GM's (hidden pages included) or the public one.
 */
export interface StoredPageList {
  project: { id: string; name: string; isPublic: boolean };
  audience: PageListAudience;
  /** When the listing was completed (ISO time); also its version. */
  generatedAt: string;
  truncated: boolean;
  resources: ListedResource[];
}

/**
 * One step of (re)building a stored page list. LegendKeeper hands out 100
 * resources per call and a Cloudflare request may make only 50 calls, so a
 * big project is listed over several requests: the caller starts with
 * part 0 and cursor "", then repeats with the returned `nextCursor` and
 * part + 1 until `done`. The server keeps the parts and swaps the finished
 * list in at the end, so everyone keeps the old list until then.
 */
export interface PageListBuildStep {
  audience: PageListAudience;
  /** Names this build's parts; any short random string. */
  buildId: string;
  part: number;
  cursor: string;
}

export interface PageListBuildResult {
  done: boolean;
  nextCursor: string | null;
  /** Resources listed in this step. */
  added: number;
  /** Resources in the finished list (when done). */
  total?: number;
  generatedAt?: string;
}

/** Resources under this API parent are templates, not pages to open. */
const TEMPLATES_PARENT = "templates";

export interface PageListProject {
  id: string;
  name: string;
  isPublic: boolean;
}

/**
 * A page counts as hidden when it or any folder above it is hidden.
 * Templates are left out.
 */
export function buildPageList(
  project: PageListProject,
  resources: ListedResource[],
  audience: PageListAudience,
  truncated = false,
  now = new Date(),
): PageList {
  const byId = new Map(resources.map((r) => [r.id, r]));

  const ancestors = (resource: ListedResource): ListedResource[] => {
    const chain: ListedResource[] = [];
    const seen = new Set([resource.id]);
    let parent = resource.parentId ? byId.get(resource.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      chain.unshift(parent);
      seen.add(parent.id);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return chain;
  };

  const pages = resources.flatMap((resource) => {
    const chain = ancestors(resource);
    if ((chain[0] ?? resource).parentId === TEMPLATES_PARENT) return [];
    return [
      {
        id: resource.id,
        name: resource.name,
        aliases: resource.aliases ?? [],
        tags: resource.tags ?? [],
        path: chain.map((a) => a.name),
        hidden: Boolean(resource.isHidden) || chain.some((a) => a.isHidden),
        iconColor: resource.iconColor ?? null,
      },
    ];
  });

  return {
    projectId: project.id,
    projectName: project.name,
    isPublic: project.isPublic,
    generatedAt: now.toISOString(),
    audience,
    pages,
    truncated,
  };
}
