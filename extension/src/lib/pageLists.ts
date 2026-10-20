// Loads the page list that tokens and scene text are matched against: the
// GM's list (hidden pages included) through their API key, or, for players,
// the room project's public pages.
//
// A big project (thousands of pages) takes a while to list, so:
// - the server hands the listing out in chunks and this builds the list;
// - the list is kept in this browser's storage, shared by every frame of the
//   extension (popover, background, menus, panel), and reused for 10 minutes;
//   an older list is still used at once while a fresh one loads;
// - only one frame loads at a time; the others wait for its result;
// - progress is published as a status ("loading pages…", "13,154 pages").

import { buildPageList, type ListedResource, type PageList, type ResourceChunk } from "@lkob/shared";
import { useEffect, useState } from "react";
import type { Platform } from "../platform/types";
import { ApiClient, describeError } from "./api";
import { getRoomProject } from "./project";
import { isConfigured, loadSettings } from "./settings";

export type Role = "GM" | "PLAYER";

/** A page list couldn't be had; the message says what to do. */
export class PageListError extends Error {}

/** A list younger than this is used without asking the server. */
const FRESH_MS = 10 * 60_000;
/** Another frame that hasn't reported progress for this long is assumed gone. */
const STALE_LOADER_MS = 75_000;
/** Chunks of ~1,500 resources; this caps a list at about 300,000. */
const MAX_CHUNKS = 200;

const LIST_KEY = "lkob.page-list.v2";
const STATUS_KEY = "lkob.page-list-status.v1";
const STATUS_EVENT = "lkob-page-list-status";
export const PAGE_LIST_STATUS_KEY = STATUS_KEY;

export interface PageListStatus {
  /** Which list: "gm/<project>" or "public/<project>". */
  key: string;
  projectName: string;
  state: "loading" | "ready" | "error";
  /** Pages so far while loading; pages in the list once ready. */
  count: number;
  /** When the list was completed (ready), or when loading started. */
  at: number;
  /** Last sign of life from the loading frame. */
  heartbeat: number;
  message?: string;
}

interface Source {
  key: string;
  projectName: string;
  audience: "gm" | "public";
  fetchChunk: (cursor: string, fresh: boolean) => Promise<ResourceChunk>;
}

/** Stored compactly: [id, name, parentId, aliases, tags, hidden, iconColor]. */
type Row = [string, string, string, string[] | 0, string[] | 0, 0 | 1, string];

interface StoredList {
  key: string;
  at: number;
  project: ResourceChunk["project"];
  truncated: boolean;
  rows: Row[];
}

let memory: { key: string; at: number; list: PageList } | null = null;
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
  const list = buildPageList(stored.project, resources, source.audience, stored.truncated, new Date(stored.at));
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

async function sourceFor(platform: Platform, role: Role): Promise<Source> {
  const settings = loadSettings();
  if (role === "GM") {
    if (!isConfigured(settings)) {
      throw new PageListError("Connect LegendKeeper first: open the extension from the toolbar and paste your API key in Settings.");
    }
    const api = new ApiClient(settings);
    return {
      key: `gm/${settings.projectId}`,
      projectName: settings.projectName,
      audience: "gm",
      fetchChunk: (cursor, fresh) => api.resourceChunk(settings.projectId, cursor, fresh),
    };
  }
  const project = await getRoomProject(platform);
  if (!project) throw new PageListError("Your GM hasn't connected LegendKeeper in this room yet.");
  if (!settings.backendUrl) throw new PageListError("This extension's server address is unknown.");
  const api = new ApiClient({ backendUrl: settings.backendUrl, apiKey: "" });
  return {
    key: `public/${project.id}`,
    // Anonymous visitors can't read the project's name; the room knows it.
    projectName: project.name,
    audience: "public",
    fetchChunk: (cursor) => api.publicResourceChunk(project.id, cursor),
  };
}

/** Lists every chunk from the server, reporting progress in the shared status. */
async function fetchAll(source: Source, fresh: boolean): Promise<PageList> {
  const started = Date.now();
  const status: PageListStatus = { key: source.key, projectName: source.projectName, state: "loading", count: 0, at: started, heartbeat: started };
  writeStatus(status);
  try {
    const resources: ListedResource[] = [];
    let project: ResourceChunk["project"] | null = null;
    let cursor = "";
    let truncated = true;
    for (let n = 0; n < MAX_CHUNKS; n++) {
      const chunk = await source.fetchChunk(cursor, fresh);
      project = chunk.project;
      resources.push(...chunk.resources);
      writeStatus({ ...status, count: resources.length, heartbeat: Date.now() });
      if (!chunk.nextCursor) {
        truncated = false;
        break;
      }
      cursor = chunk.nextCursor;
    }
    const stored: StoredList = { key: source.key, at: Date.now(), project: project!, truncated, rows: toRows(resources) };
    writeJson(LIST_KEY, stored);
    const list = fromStored(stored, source);
    memory = { key: source.key, at: stored.at, list };
    writeStatus({ ...status, state: "ready", count: list.pages.length, at: stored.at, heartbeat: Date.now() });
    return list;
  } catch (err) {
    const message = `Couldn't load LegendKeeper's page list: ${describeError(err)}`;
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
      return stored?.key === source.key && stored.at >= status.at ? fromStored(stored, source) : null;
    }
    if (Date.now() - status.heartbeat > STALE_LOADER_MS) return null;
  }
}

function load(source: Source, fresh: boolean): Promise<PageList> {
  if (inflight?.key === source.key) return inflight.promise;
  const promise = (async () => {
    const status = readStatus();
    const otherLoading = status?.key === source.key && status.state === "loading" && Date.now() - status.heartbeat < STALE_LOADER_MS;
    if (otherLoading && !fresh) {
      const shared = await waitForOtherFrame(source);
      if (shared) {
        memory = { key: source.key, at: Date.now(), list: shared };
        return shared;
      }
    }
    return fetchAll(source, fresh);
  })().finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { key: source.key, promise };
  return promise;
}

/**
 * The page list for this person. `fresh` asks LegendKeeper again now (the
 * Refresh button); otherwise a recent list is reused, and an older one is
 * returned at once while a new one loads.
 */
export async function loadPageList(platform: Platform, role: Role, fresh = false): Promise<PageList> {
  const source = await sourceFor(platform, role);
  if (fresh) return load(source, true);

  const status = readStatus();
  // Another frame may have finished a newer list since this one was kept.
  const newerElsewhere = status?.key === source.key && status.state === "ready" && memory !== null && status.at > memory.at;
  if (memory?.key === source.key && Date.now() - memory.at < FRESH_MS && !newerElsewhere) return memory.list;
  const stored = readJson<StoredList>(LIST_KEY);
  if (stored?.key === source.key) {
    const list = fromStored(stored, source);
    memory = { key: source.key, at: stored.at, list };
    // Out of date: use it now, and bring it up to date in the background.
    if (Date.now() - stored.at >= FRESH_MS) void load(source, false).catch(() => undefined);
    return list;
  }
  return load(source, false);
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
  if (status.state === "loading") {
    return status.count ? `${name}: loading pages… ${status.count.toLocaleString()} so far` : `${name}: loading pages…`;
  }
  if (status.state === "error") return `${name}: ${status.message ?? "couldn't load pages."}`;
  return `${name}: ${status.count.toLocaleString()} page${status.count === 1 ? "" : "s"}, updated ${timeAgo(status.at, now)}`;
}
