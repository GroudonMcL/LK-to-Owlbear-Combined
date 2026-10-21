// A page shared with the room ("Open for everyone"), as it travels between browsers.

export interface SharedPage {
  projectId: string;
  resourceId: string;
  name: string;
  /** Who shared it, or asked to. */
  from: string;
}

export function parseSharedPage(data: unknown): SharedPage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
  const projectId = str(d.projectId, 200);
  const resourceId = str(d.resourceId, 200);
  const name = str(d.name, 500);
  if (!projectId || !resourceId || !name) return null;
  return { projectId, resourceId, name, from: str(d.from, 200) ?? "Someone" };
}
