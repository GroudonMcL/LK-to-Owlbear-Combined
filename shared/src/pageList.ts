// Turns LegendKeeper's resource listing into a page list. The server hands
// the listing out in chunks and the browser builds the list, so this lives in
// shared code.

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

/** A slice of a project's resource listing; follow `nextCursor` for the rest. */
export interface ResourceChunk {
  project: { id: string; name: string; isPublic: boolean };
  resources: ListedResource[];
  nextCursor: string | null;
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
