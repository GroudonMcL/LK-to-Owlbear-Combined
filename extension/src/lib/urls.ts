const ORIGIN = "https://www.legendkeeper.com";

/** The read-only public view. It can be framed, and hides hidden pages and documents. */
export function publicPageUrl(projectId: string, resourceId: string): string {
  return `${ORIGIN}/p/${projectId}/${resourceId}/`;
}

/** The logged-in app, with DM documents. It refuses to be framed, so it only opens in a tab. */
export function appPageUrl(projectId: string, resourceId: string): string {
  return `${ORIGIN}/a/${projectId}/${resourceId}/`;
}

/**
 * The URL to open in a new tab: the GM always gets the app; players get the
 * public view, except in a private project, which has no public view.
 */
export function tabUrl(
  role: "GM" | "PLAYER",
  projectId: string,
  resourceId: string,
  isPublic: boolean,
): string {
  return role === "GM" || !isPublic
    ? appPageUrl(projectId, resourceId)
    : publicPageUrl(projectId, resourceId);
}
