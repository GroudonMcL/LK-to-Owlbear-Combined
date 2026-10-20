// Loads the page list that tokens and scene text are matched against: the
// GM's list (hidden pages included) through their API key, or, for players,
// the room project's public pages.

import type { PageList } from "@lkob/shared";
import type { Platform } from "../platform/types";
import { ApiClient, describeError } from "./api";
import { getRoomProject } from "./project";
import { isConfigured, loadSettings } from "./settings";

export type Role = "GM" | "PLAYER";

/** A page list couldn't be had; the message says what to do. */
export class PageListError extends Error {}

const CACHE_MS = 60_000;
let cache: { key: string; at: number; list: PageList } | null = null;
let inflight: { key: string; promise: Promise<PageList> } | null = null;

export async function loadPageList(platform: Platform, role: Role, fresh = false): Promise<PageList> {
  const settings = loadSettings();
  let key: string;
  let fetchList: () => Promise<PageList>;
  if (role === "GM") {
    if (!isConfigured(settings)) {
      throw new PageListError("Connect LegendKeeper first: open the extension from the toolbar and paste your API key in Settings.");
    }
    const api = new ApiClient(settings);
    key = `gm/${settings.projectId}`;
    fetchList = () => api.pageList(settings.projectId, fresh);
  } else {
    const project = await getRoomProject(platform);
    if (!project) throw new PageListError("Your GM hasn't connected LegendKeeper in this room yet.");
    if (!settings.backendUrl) throw new PageListError("This extension's server address is unknown.");
    const api = new ApiClient({ backendUrl: settings.backendUrl, apiKey: "" });
    key = `public/${project.id}`;
    // Anonymous visitors can't read the project's name; the room knows it.
    fetchList = async () => ({ ...(await api.publicPageList(project.id)), projectName: project.name });
  }
  if (!fresh && cache?.key === key && Date.now() - cache.at < CACHE_MS) return cache.list;
  if (!fresh && inflight?.key === key) return inflight.promise;
  const promise = fetchList().then(
    (list) => {
      cache = { key, at: Date.now(), list };
      return list;
    },
    (err: unknown) => {
      throw new PageListError(`Couldn't load LegendKeeper's page list: ${describeError(err)}`);
    },
  );
  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}
