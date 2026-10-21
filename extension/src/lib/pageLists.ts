// Loads the page list that tokens and scene text are matched against: the
// GM's list (hidden pages included) or, for players, the room project's
// public pages.
//
// The server builds both lists and keeps them, so joining a room means one
// download, not a wait while LegendKeeper is listed:
// - the deploy builds them; the GM's "Refresh page list" rebuilds them for
//   everyone (a step at a time, as LegendKeeper lists 100 pages per call),
//   and a GM whose server has none yet builds them automatically;
// - each browser keeps its copy in storage, shared by every frame of the
//   extension (popover, background, menus, panel), and asks the server every
//   few minutes whether there is a newer one, which costs almost nothing
//   when there isn't;
// - only one frame loads at a time; the others wait for its result;
// - progress is published as a status ("building the page list…", "13,154 pages").

import { buildPageList, type ListedResource, type PageList, type StoredPageList } from "@lkob/shared";
import { useEffect, useState } from "react";
import type { Platform } from "../platform/types";
import { ApiClient, ApiError, describeError } from "./api";
import { getRoomProject } from "./project";
import { isConfigured, loadSettings } from "./settings";

export type Role = "GM" | "PLAYER";

/** A page list couldn't be had; the message says what to do. */
export class PageListError extends Error {}

/** A list checked more recently than this is used without asking the server. */
const FRESH_MS = 5 * 60_000;
/** Another frame that hasn't reported progress for this long is assumed gone. */
const STALE_LOADER_MS = 75_000;
/** Build steps of ~1,500 pages; the server stops a list at 60. */
const MAX_BUILD_STEPS = 60;

const LIST_KEY = "lkob.page-list.v3";
const STATUS_KEY = "lkob.page-list-status.v1";
const STATUS_EVENT = "lkob-page-list-status";
export const PAGE_LIST_STATUS_KEY = STATUS_KEY;

export interface PageListStatus {
  /** Which list: "gm/<project>" or "public/<project>". */
  key: string;
  projectName: string;
  state: "loading" | "ready" | "error";
  /** True while the server is listing LegendKeeper again (the GM's Refresh). */
  building?: boolean;
  /** Pages so far while building; pages in the list once ready. */
  count: number;
  /** When the server built the list (ready), or when loading started. */
  at: number;
  /** Last sign of life from the loading frame. */
  heartbeat: number;
  message?: string;
}

interface Source {
  key: string;
  projectName: string;
  audience: "gm" | "public";
  /** The stored list, or "unchanged" when it is still `since`. */
  fetchList: (since: string | null) => Promise<StoredPageList | "unchanged">;
  /** Rebuilds the server's lists (the GM only). */
  build?: (onProgress: (count: number) => void) => Promise<void>;
}

/** Stored compactly: [id, name, parentId, aliases, tags, hidden, iconColor]. */
type Row = [string, string, string, string[] | 0, string[] | 0, 0 | 1, string];

interface StoredList {
  key: string;
  /** The server's `generatedAt`: the list's version. */
  version: string;
  /** When this browser last asked the server about it. */
  checkedAt: number;
  project: StoredPageList["project"];
  truncated: boolean;
  rows: Row[];
}

let memory: { key: string; version: string; checkedAt: number; list: PageList } | null = null;
let inflight: { key: string; promise: Promise<PageList> } | null = null;

function readJson<T>(storageKey: string): T | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storageKey: string, value: unknown): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    // Blocked or full (a very large project): this frame keeps its own copy.
    return false;
  }
}

export function readStatus(): PageListStatus | null {
  return readJson<PageListStatus>(STATUS_KEY);
}

function writeStatus(status: PageListStatus): void {
  writeJson(STATUS_KEY, status);
  window.dispatchEvent(new CustomEvent(STATUS_EVENT));
}

function fromStored(stored: StoredList, source: Source): PageList {
  const resources: ListedResource[] = stored.rows.map(([id, name, parentId, aliases, tags, hidden, iconColor]) => ({
    id,
    name,
    parentId: parentId || null,
    aliases: aliases || [],
    tags: tags || [],
    isHidden: hidden === 1,
    iconColor: iconColor || null,
  }));
  const list = buildPageList(stored.project, resources, source.audience, stored.truncated, new Date(stored.version));
  return { ...list, projectName: source.projectName || list.projectName };
}

function toRows(resources: ListedResource[]): Row[] {
  return resources.map((r) => [
    r.id,
    r.name,
    r.parentId ?? "",
    r.aliases?.length ? r.aliases : 0,
    r.tags?.length ? r.tags : 0,
    r.isHidden ? 1 : 0,
    r.iconColor ?? "",
  ]);
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sourceFor(platform: Platform, role: Role): Promise<Source> {
  const settings = loadSettings();
  if (role === "GM") {
    if (!isConfigured(settings)) {
      throw new PageListError("Connect LegendKeeper first: open the extension from the toolbar and enter the access password in Settings.");
    }
    const api = new ApiClient(settings);
    const projectId = settings.projectId;
    return {
      key: `gm/${projectId}`,
      projectName: settings.projectName,
      audience: "gm",
      fetchList: (since) => api.pageList(projectId, since),
      // Both lists: players' browsers pick the public one up from the server.
      build: async (onProgress) => {
        for (const audience of ["gm", "public"] as const) {
          const buildId = randomId();
          let cursor = "";
          let count = 0;
          for (let part = 0; part < MAX_BUILD_STEPS; part++) {
            const step = await api.buildPageListStep(projectId, { audience, buildId, part, cursor });
            count += step.added;
            if (audience === "gm") onProgress(count);
            if (step.done) break;
            cursor = step.nextCursor ?? "";
          }
        }
      },
    };
  }
  const project = await getRoomProject(platform);
  if (!project) throw new PageListError("Your GM hasn't connected LegendKeeper in this room yet.");
  if (!settings.backendUrl) throw new PageListError("This extension's server address is unknown.");
  const api = new ApiClient({ backendUrl: settings.backendUrl, accessToken: "" });
  return {
    key: `public/${project.id}`,
    // The room knows the project's name as the GM chose it.
    projectName: project.name,
    audience: "public",
    fetchList: (since) => api.publicPageList(project.id, since),
  };
}

function notBuilt(err: unknown): boolean {
  return err instanceof ApiError && err.code === "PAGE_LIST_NOT_BUILT";
}

/**
 * Gets the server's list, reporting progress in the shared status. With
 * `rebuild` (the GM's Refresh) the server lists LegendKeeper again first;
 * otherwise an unchanged list is only confirmed, not downloaded.
 */
async function fetchFromServer(source: Source, rebuild: boolean): Promise<PageList> {
  const started = Date.now();
  const kept = readJson<StoredList>(LIST_KEY);
  const current = kept?.key === source.key ? kept : null;
  const status: PageListStatus = { key: source.key, projectName: source.projectName, state: "loading", count: 0, at: started, heartbeat: started };
  writeStatus(status);
  const build = async () => {
    writeStatus({ ...status, building: true, heartbeat: Date.now() });
    await source.build!((count) => writeStatus({ ...status, building: true, count, heartbeat: Date.now() }));
  };
  try {
    if (rebuild && source.build) await build();
    let answer: StoredPageList | "unchanged";
    try {
      answer = await source.fetchList(rebuild ? null : (current?.version ?? null));
    } catch (err) {
      // A server with no list yet: the GM builds it, once.
      if (!notBuilt(err) || !source.build || rebuild) throw err;
      await build();
      answer = await source.fetchList(null);
    }
    let stored: StoredList;
    if (answer === "unchanged" && current) {
      stored = { ...current, checkedAt: Date.now() };
    } else if (answer === "unchanged") {
      throw new PageListError("The server's answer didn't include the page list.");
    } else {
      stored = {
        key: source.key,
        version: answer.generatedAt,
        checkedAt: Date.now(),
        project: answer.project,
        truncated: answer.truncated,
        rows: toRows(answer.resources),
      };
    }
    writeJson(LIST_KEY, stored);
    const list = memory?.key === source.key && memory.version === stored.version ? memory.list : fromStored(stored, source);
    memory = { key: source.key, version: stored.version, checkedAt: stored.checkedAt, list };
    writeStatus({ ...status, state: "ready", count: list.pages.length, at: Date.parse(stored.version), heartbeat: Date.now() });
    return list;
  } catch (err) {
    const message = notBuilt(err) ? describeError(err) : `Couldn't load LegendKeeper's page list: ${describeError(err)}`;
    writeStatus({ ...status, state: "error", message, heartbeat: Date.now() });
    throw new PageListError(message);
  }
}

/** Waits for another frame that is loading the same list; null if it stops or fails to share it. */
async function waitForOtherFrame(source: Source): Promise<PageList | null> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const status = readStatus();
    if (!status || status.key !== source.key) return null;
    if (status.state === "error") throw new PageListError(status.message ?? "Couldn't load LegendKeeper's page list.");
    if (status.state === "ready") {
      const stored = readJson<StoredList>(LIST_KEY);
      if (stored?.key !== source.key || stored.checkedAt < status.heartbeat - 5_000) return null;
      const list = fromStored(stored, source);
      memory = { key: source.key, version: stored.version, checkedAt: stored.checkedAt, list };
      return list;
    }
    if (Date.now() - status.heartbeat > STALE_LOADER_MS) return null;
  }
}

function load(source: Source, rebuild: boolean): Promise<PageList> {
  if (inflight?.key === source.key && !rebuild) return inflight.promise;
  const promise = (async () => {
    const status = readStatus();
    const otherLoading = status?.key === source.key && status.state === "loading" && Date.now() - status.heartbeat < STALE_LOADER_MS;
    if (otherLoading && !rebuild) {
      const shared = await waitForOtherFrame(source);
      if (shared) return shared;
    }
    return fetchFromServer(source, rebuild);
  })().finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { key: source.key, promise };
  return promise;
}

/**
 * The page list for this person. A list checked in the last few minutes is
 * used as it is; an older one is returned at once while the server is asked
 * for a newer one. `fresh` asks the server now: for the GM it also rebuilds
 * the server's lists from LegendKeeper (the Refresh button), for players it
 * fetches the newest list the server has.
 */
export async function loadPageList(platform: Platform, role: Role, fresh = false): Promise<PageList> {
  const source = await sourceFor(platform, role);
  if (fresh) return load(source, role === "GM");

  const stored = readJson<StoredList>(LIST_KEY);
  const current = stored?.key === source.key ? stored : null;
  // Another frame may have fetched a newer list since this one was kept.
  if (memory?.key === source.key && current && current.version !== memory.version) memory = null;
  if (memory?.key === source.key && Date.now() - Math.max(memory.checkedAt, current?.checkedAt ?? 0) < FRESH_MS) return memory.list;
  if (current) {
    const list = memory?.key === source.key && memory.version === current.version ? memory.list : fromStored(current, source);
    memory = { key: source.key, version: current.version, checkedAt: current.checkedAt, list };
    // Not checked lately: use it now, and ask the server in the background.
    if (Date.now() - current.checkedAt >= FRESH_MS) void load(source, false).catch(() => undefined);
    return list;
  }
  return load(source, false);
}

/** Asks the server for a newer list now, e.g. when the GM says they rebuilt it. */
export async function recheckPageList(platform: Platform, role: Role): Promise<PageList> {
  return load(await sourceFor(platform, role), false);
}

/** The shared page-list status, kept current across frames. */
export function usePageListStatus(): PageListStatus | null {
  const [status, setStatus] = useState(readStatus);
  const [, tick] = useState(0);
  useEffect(() => {
    const refresh = () => setStatus(readStatus());
    const onStorage = (e: StorageEvent) => e.key === STATUS_KEY && refresh();
    window.addEventListener(STATUS_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    // Keeps "updated 3 minutes ago" current.
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      window.removeEventListener(STATUS_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
      clearInterval(timer);
    };
  }, []);
  return status;
}

/** "just now", "4 minutes ago", "2 hours ago". */
export function timeAgo(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The status line: "D&D - Greyhawk: 13,154 pages, updated just now". */
export function describeStatus(status: PageListStatus, now = Date.now()): string {
  const name = status.projectName || "LegendKeeper";
  if (status.state === "loading" && status.building) {
    return status.count
      ? `${name}: building the page list… ${status.count.toLocaleString()} pages so far`
      : `${name}: building the page list…`;
  }
  if (status.state === "loading") return `${name}: loading pages…`;
  if (status.state === "error") return `${name}: ${status.message ?? "couldn't load pages."}`;
  return `${name}: ${status.count.toLocaleString()} page${status.count === 1 ? "" : "s"}, updated ${timeAgo(status.at, now)}`;
}
