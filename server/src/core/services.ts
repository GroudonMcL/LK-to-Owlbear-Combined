import type {
  PageContent,
  PageDetails,
  ListedResource,
  PageListAudience,
  PageListBuildResult,
  PageListBuildStep,
  ProjectsResponse,
  ProjectSummary,
  SearchHit,
  SearchResponse,
  StoredPageList,
} from "@lkob/shared";
import { InFlight, TtlCache } from "./cache.js";
import { HttpError } from "./errors.js";
import { sniffImageMime, type RasterMime } from "./imageSniff.js";
import { LkApiError, LkClient, LkNetworkError } from "./lk/client.js";
import { toContent } from "./lk/content.js";
import { extractPage, type ExtractedImage } from "./lk/extract.js";
import type {
  LkBoardContent,
  LkDocumentBlocks,
  LkList,
  LkNode,
  LkProject,
  LkResource,
  LkResourceListItem,
  LkSearchResult,
} from "./lk/types.js";
import { SafeFetchError, type ImageFetcher } from "./imageFetch.js";
import type { PageListStore } from "./pageListStore.js";

/** Translates a LegendKeeper failure into a response the extension can act on. */
export function mapUpstreamError(err: unknown, notFound: HttpError): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof LkNetworkError) {
    return new HttpError(502, "UPSTREAM_UNAVAILABLE", "LegendKeeper could not be reached. Try again.", { retryable: true });
  }
  if (err instanceof LkApiError) {
    const ids = { upstreamRequestId: err.requestId };
    if (err.status === 404) return notFound;
    if (err.status === 429) {
      return new HttpError(429, "RATE_LIMITED", "LegendKeeper rate limit reached. Wait a moment and retry.", {
        retryable: true,
        retryAfter: err.retryAfter ?? 30,
        ...ids,
      });
    }
    if (err.status === 401 || err.status === 402 || err.status === 403) {
      const reasons: Record<string, string> = {
        UNAUTHENTICATED:
          "LegendKeeper didn't accept the server's API key: it may be mistyped, revoked or expired. Update the LK_API_KEYS secret and deploy again.",
        PAID_PLAN_REQUIRED: "LegendKeeper API keys need the project owner to be on a paid plan.",
        SUBSCRIPTION_LAPSED: "The LegendKeeper project owner's plan has lapsed.",
        WRONG_PROJECT: "The server's API key belongs to a different LegendKeeper project.",
        FORBIDDEN: "The server's API key can't open that LegendKeeper project.",
        INSUFFICIENT_SCOPE: "The server's LegendKeeper API key lacks a required scope.",
      };
      return new HttpError(502, "UPSTREAM_AUTH", reasons[err.code] ?? `LegendKeeper refused the server's API key (${err.code}).`, ids);
    }
    if (err.status >= 500) {
      return new HttpError(502, "UPSTREAM_UNAVAILABLE", "LegendKeeper had a temporary problem. Try again.", { retryable: true, ...ids });
    }
    return new HttpError(502, "INTERNAL", `LegendKeeper rejected the request (${err.code}).`, ids);
  }
  return new HttpError(500, "INTERNAL", "Unexpected server error.");
}

/**
 * One of the server's LegendKeeper API keys (from LK_API_KEYS): a client
 * holding it, and a short name for it. Caches are keyed by the name, so one
 * key's results never answer for another.
 */
export interface Caller {
  keyId: string;
  client: LkClient;
}

/** The one project each API key opens, remembered for a while per key. */
export class ProjectResolver {
  private readonly cache = new TtlCache<string, ProjectSummary>({ ttlMs: 10 * 60_000, maxEntries: 500 });
  private readonly inflight = new InFlight<string, ProjectSummary>();

  async projectOf(caller: Caller, fresh = false): Promise<ProjectSummary> {
    if (!fresh) {
      const cached = this.cache.get(caller.keyId);
      if (cached) return cached;
    }
    const project = await this.inflight.run(caller.keyId, async () => {
      try {
        const list = await caller.client.get<LkList<LkProject>>("/api/v3/projects", { limit: 1 });
        const found = list.data?.[0];
        if (!found) throw new HttpError(502, "UPSTREAM_AUTH", "The server's API key doesn't open any LegendKeeper project.");
        return { id: found.id, name: found.name ?? found.id, isPublic: found.isPublic ?? false };
      } catch (err) {
        throw mapUpstreamError(err, new HttpError(502, "UPSTREAM_AUTH", "The server's API key doesn't open any LegendKeeper project."));
      }
    });
    this.cache.set(caller.keyId, project);
    return project;
  }

  /** The caller's project, which must be `projectId`: a key opens only its own project. */
  async require(caller: Caller, projectId: string): Promise<ProjectSummary> {
    const project = await this.projectOf(caller);
    if (project.id !== projectId) throw notConfigured();
    return project;
  }
}

function notConfigured(): HttpError {
  return new HttpError(
    404,
    "PROJECT_NOT_CONFIGURED",
    "This server has no API key for that LegendKeeper project. Add one to the LK_API_KEYS secret and deploy again, or choose another project in Settings.",
  );
}

/** The server's API keys, one per project, and which project each opens. */
export class ServerKeys {
  constructor(
    readonly callers: Caller[],
    private readonly projects: ProjectResolver,
  ) {}

  /** Every project the keys open. A key LegendKeeper refuses is left out, unless all are. */
  async list(fresh = false): Promise<ProjectsResponse> {
    const results = await Promise.allSettled(this.callers.map((c) => this.projects.projectOf(c, fresh)));
    const projects = new Map<string, ProjectSummary>();
    for (const r of results) if (r.status === "fulfilled" && !projects.has(r.value.id)) projects.set(r.value.id, r.value);
    if (projects.size === 0) {
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
    }
    return { projects: [...projects.values()] };
  }

  /** The key that opens `projectId`. */
  async callerFor(projectId: string): Promise<Caller> {
    const results = await Promise.allSettled(this.callers.map((c) => this.projects.projectOf(c)));
    const index = results.findIndex((r) => r.status === "fulfilled" && r.value.id === projectId);
    if (index >= 0) return this.callers[index];
    // With one key, LegendKeeper's reason (a revoked key, say) says more than "not configured".
    if (results.length === 1 && results[0].status === "rejected") throw results[0].reason;
    throw notConfigured();
  }
}

const SNIPPET_RADIUS = 70;

export function toSearchHits(results: LkSearchResult[]): SearchHit[] {
  const byId = new Map<string, SearchHit>();
  for (const result of results) {
    const r = result.resource;
    if (!r?.id || byId.has(r.id)) continue;
    let match: SearchHit["match"] = null;
    const highlight = result.document?.highlights?.[0];
    if (result.document && highlight) {
      const from = Math.max(0, highlight.matchStart - SNIPPET_RADIUS);
      const to = Math.min(highlight.segment.length, highlight.matchEnd + SNIPPET_RADIUS);
      const prefix = from > 0 ? "…" : "";
      const suffix = to < highlight.segment.length ? "…" : "";
      match = {
        documentName: result.document.name,
        snippet: prefix + highlight.segment.slice(from, to) + suffix,
        start: highlight.matchStart - from + prefix.length,
        end: highlight.matchEnd - from + prefix.length,
      };
    }
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      path: (r.path ?? []).map((p) => p.name),
      tags: r.tags ?? [],
      iconGlyph: r.iconGlyph ?? null,
      iconColor: r.iconColor ?? null,
      match,
    });
  }
  return [...byId.values()];
}

interface CachedPage {
  details: PageDetails;
  content: PageContent;
  images: Map<string, ExtractedImage>;
}

export interface FetchedImage {
  body: Uint8Array;
  mime: RasterMime;
}

export interface PageServiceOptions {
  /** LegendKeeper's origin, for keyless (public) requests. */
  lkBaseUrl: string;
  /** Test hook for keyless requests. */
  lkFetch?: typeof fetch;
  pageTtlMs?: number;
  searchTtlMs?: number;
  /** Where built page lists are kept. */
  pageLists: PageListStore;
  /** LegendKeeper list calls (100 resources each) per build step. */
  listRequestsPerChunk?: number;
  maxSourceImageBytes: number;
  assetHostAllowlist: string[] | null;
  allowInsecureAssetFetch: boolean;
  fetchImage: ImageFetcher;
}

/** Drops hidden nodes (`isHidden`) and secret blocks, at any depth. */
export function publicOnly<T>(value: T, depth = 0): T {
  if (depth > 64) return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => !(v && typeof v === "object" && ((v as LkNode).kind === "secret" || (v as LkNode).isHidden === true)))
      .map((v) => publicOnly(v, depth + 1)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = publicOnly(v, depth + 1);
    return out as T;
  }
  return value;
}

function listKey(audience: PageListAudience, projectId: string): string {
  return `page-list/${audience}/${projectId}`;
}

function versionKey(audience: PageListAudience, projectId: string): string {
  return `page-list-version/${audience}/${projectId}`;
}

const MAX_PAGE_DOCUMENTS = 8;
/** Board tabs read for images; each is one more LegendKeeper call. */
const MAX_BOARD_DOCUMENTS = 4;
/**
 * listResources calls (100 resources each) per build step. With the project
 * lookup this stays well under Cloudflare's 50 outbound calls per request,
 * and a step answers in a few seconds.
 */
const LIST_REQUESTS_PER_CHUNK = 15;
/** Build steps per list: about 90,000 pages, keeping a stored list well under KV's 25 MB per value. */
const MAX_LIST_PARTS = 60;
/** A build's parts are only needed until it finishes. */
const PART_TTL_SECONDS = 60 * 60;
const BUILD_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export class PageService {
  private readonly pages: TtlCache<string, CachedPage>;
  private readonly searches: TtlCache<string, SearchResponse>;
  private readonly pageLists: PageListStore;
  private readonly publicIds = new Map<string, { version: string; ids: Set<string> }>();
  private readonly listRequestsPerChunk: number;
  private readonly images: TtlCache<string, FetchedImage>;
  private readonly pageFlight = new InFlight<string, CachedPage>();
  private readonly imageFlight = new InFlight<string, FetchedImage>();
  private readonly fetchImage: ImageFetcher;
  private readonly anonymous: LkClient;

  constructor(
    private readonly projects: ProjectResolver,
    private readonly options: PageServiceOptions,
  ) {
    this.pages = new TtlCache({ ttlMs: options.pageTtlMs ?? 60_000, maxEntries: 200 });
    this.searches = new TtlCache({ ttlMs: options.searchTtlMs ?? 30_000, maxEntries: 200 });
    this.pageLists = options.pageLists;
    this.listRequestsPerChunk = options.listRequestsPerChunk ?? LIST_REQUESTS_PER_CHUNK;
    this.images = new TtlCache({
      ttlMs: 10 * 60_000,
      maxEntries: 300,
      maxWeight: 128 * 1024 * 1024,
      weigh: (img) => img.body.length,
    });
    this.fetchImage = options.fetchImage;
    this.anonymous = new LkClient({ baseUrl: options.lkBaseUrl, fetch: options.lkFetch });
  }

  async search(caller: Caller, projectId: string, query: string, limit: number): Promise<SearchResponse> {
    const key = `${caller.keyId}\u0000${projectId}\u0000${limit}\u0000${query.toLowerCase()}`;
    const cached = this.searches.get(key);
    if (cached) return cached;
    await this.projects.require(caller, projectId);
    const client = caller.client;
    try {
      const list = await client.get<LkList<LkSearchResult>>(`/api/v3/projects/${encodeURIComponent(projectId)}/search`, {
        q: query,
        limit,
      });
      const results = toSearchHits(list.data ?? []);
      const response: SearchResponse = { query, results, limited: (list.data ?? []).length >= limit };
      this.searches.set(key, response);
      return response;
    } catch (err) {
      throw mapUpstreamError(err, new HttpError(404, "PROJECT_NOT_CONFIGURED", "Project not found."));
    }
  }

  /** A stored page list as JSON text, or null before its first build. */
  storedPageList(audience: PageListAudience, projectId: string): Promise<string | null> {
    return this.pageLists.get(listKey(audience, projectId));
  }

  /**
   * Whether a page is in the project's stored public list: what LegendKeeper
   * shows anonymous visitors, so hidden pages and pages under hidden folders
   * are never in it.
   */
  async isPublicPage(projectId: string, resourceId: string): Promise<boolean> {
    const version = await this.pageListVersion("public", projectId);
    if (!version) return false;
    let cached = this.publicIds.get(projectId);
    if (cached?.version !== version) {
      const raw = await this.storedPageList("public", projectId);
      if (!raw) return false;
      const list = JSON.parse(raw) as StoredPageList;
      cached = { version, ids: new Set(list.resources.map((r) => r.id)) };
      this.publicIds.set(projectId, cached);
    }
    return cached.ids.has(resourceId);
  }

  /** The stored list's `generatedAt`, which is cheap to check before downloading it. */
  pageListVersion(audience: PageListAudience, projectId: string): Promise<string | null> {
    return this.pageLists.get(versionKey(audience, projectId));
  }

  /**
   * One step of rebuilding a project's stored page list (see
   * PageListBuildStep). The GM's list is read with the server's key, hidden
   * pages included; the public list without a key, so it holds exactly what
   * an anonymous visitor can see, and nothing for a private project.
   */
  async buildPageListStep(caller: Caller, projectId: string, step: PageListBuildStep): Promise<PageListBuildResult> {
    if (step.audience !== "gm" && step.audience !== "public") throw new HttpError(400, "BAD_REQUEST", "Unknown page list.");
    if (!BUILD_ID_PATTERN.test(step.buildId)) throw new HttpError(400, "BAD_REQUEST", "Invalid build id.");
    if (!Number.isInteger(step.part) || step.part < 0 || step.part >= MAX_LIST_PARTS) throw new HttpError(400, "BAD_REQUEST", "Invalid build step.");
    if (typeof step.cursor !== "string" || step.cursor.length > 2048 || (step.part === 0) !== (step.cursor === "")) {
      throw new HttpError(400, "BAD_REQUEST", "Invalid cursor.");
    }
    const project = await this.projects.require(caller, projectId);
    // The public list is public exactly when LegendKeeper lists it to anonymous visitors.
    let isPublic = step.audience === "public" ? true : (project.isPublic ?? false);
    let listed: { resources: ListedResource[]; nextCursor: string | null };
    try {
      listed = await this.listResources(step.audience === "gm" ? caller.client : this.anonymous, projectId, step.cursor);
    } catch (err) {
      // A project that refuses anonymous visitors (a private one) has no public pages.
      if (step.audience === "public" && err instanceof LkApiError && [401, 403, 404].includes(err.status)) {
        listed = { resources: [], nextCursor: null };
        isPublic = false;
      } else {
        throw mapUpstreamError(err, notConfigured());
      }
    }

    const part = (n: number) => `page-list-part/${step.audience}/${projectId}/${step.buildId}/${n}`;
    const last = step.part === MAX_LIST_PARTS - 1;
    if (listed.nextCursor && !last) {
      await this.pageLists.put(part(step.part), JSON.stringify(listed.resources), PART_TTL_SECONDS);
      return { done: false, nextCursor: listed.nextCursor, added: listed.resources.length };
    }

    const resources: ListedResource[] = [];
    for (let n = 0; n < step.part; n++) {
      const raw = await this.pageLists.get(part(n));
      if (raw === null) throw new HttpError(409, "BAD_REQUEST", "Part of this page-list build expired. Refresh the page list again.");
      resources.push(...(JSON.parse(raw) as ListedResource[]));
    }
    resources.push(...listed.resources);
    const generatedAt = new Date().toISOString();
    const list: StoredPageList = {
      project: { id: project.id, name: project.name, isPublic },
      audience: step.audience,
      generatedAt,
      truncated: Boolean(listed.nextCursor),
      resources,
    };
    await this.pageLists.put(listKey(step.audience, projectId), JSON.stringify(list));
    await this.pageLists.put(versionKey(step.audience, projectId), generatedAt);
    return { done: true, nextCursor: null, added: listed.resources.length, total: resources.length, generatedAt };
  }

  private async listResources(client: LkClient, projectId: string, cursor: string): Promise<{ resources: ListedResource[]; nextCursor: string | null }> {
    const resources: ListedResource[] = [];
    let next: string | undefined = cursor || undefined;
    for (let request = 0; request < this.listRequestsPerChunk; request++) {
      const page = await client.get<LkList<LkResourceListItem>>(`/api/v3/projects/${encodeURIComponent(projectId)}/resources`, {
        limit: 100,
        cursor: next,
      });
      for (const r of page.data ?? []) {
        resources.push({
          id: r.id,
          name: r.name,
          parentId: r.parentId ?? null,
          tags: r.tags ?? [],
          aliases: r.aliases ?? [],
          isHidden: Boolean(r.isHidden),
          iconColor: r.iconColor ?? null,
        });
      }
      next = page.nextCursor ?? undefined;
      if (!next) return { resources, nextCursor: null };
    }
    return { resources, nextCursor: next ?? null };
  }

  private async load(caller: Caller, projectId: string, resourceId: string, audience: PageListAudience): Promise<CachedPage> {
    await this.projects.require(caller, projectId);
    const client = caller.client;
    const base = `/api/v3/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`;
    const notFound = new HttpError(404, "PAGE_NOT_FOUND", "This page no longer exists or the server's API key cannot see it.");
    let resource: LkResource;
    try {
      resource = await client.get<LkResource>(base);
    } catch (err) {
      throw mapUpstreamError(err, notFound);
    }
    if (audience === "public") {
      // What a player may see: no hidden page, tab or sidebar field, and no secret block.
      if (resource.isHidden) throw notFound;
      resource = { ...resource, documents: (resource.documents ?? []).filter((d) => !d.isHidden), properties: publicOnly(resource.properties ?? []) };
    }

    const pageDocs = (resource.documents ?? [])
      .filter((d) => d.type === "page" && !d.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    const warnings: string[] = [];
    if (pageDocs.length > MAX_PAGE_DOCUMENTS) {
      warnings.push(`Only the first ${MAX_PAGE_DOCUMENTS} of ${pageDocs.length} documents were scanned for images.`);
    }

    const documents = await Promise.all(
      pageDocs.slice(0, MAX_PAGE_DOCUMENTS).map(async (doc) => {
        try {
          const content = await client.get<LkDocumentBlocks>(`${base}/docs/${encodeURIComponent(doc.id)}/blocks`);
          const blocks = content.blocks as LkNode[];
          return { doc, blocks: audience === "public" ? publicOnly(blocks) : blocks };
        } catch (err) {
          const mapped = mapUpstreamError(err, notFound);
          // Auth failures affect the whole page; surface them instead of a partial result.
          if (mapped.code === "UPSTREAM_AUTH" || mapped.code === "RATE_LIMITED") throw mapped;
          warnings.push(`The document "${doc.name}" could not be read, so its images and stats are missing.`);
          return { doc, blocks: null };
        }
      }),
    );

    const boardDocs = (resource.documents ?? [])
      .filter((d) => d.type === "board" && !d.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    if (boardDocs.length > MAX_BOARD_DOCUMENTS) {
      warnings.push(`Only the first ${MAX_BOARD_DOCUMENTS} of ${boardDocs.length} boards were scanned for images.`);
    }
    const boards = await Promise.all(
      boardDocs.slice(0, MAX_BOARD_DOCUMENTS).map(async (doc) => {
        try {
          const content = await client.get<LkBoardContent>(`${base}/docs/${encodeURIComponent(doc.id)}/board`);
          return { doc, content };
        } catch (err) {
          const mapped = mapUpstreamError(err, notFound);
          if (mapped.code === "UPSTREAM_AUTH" || mapped.code === "RATE_LIMITED") throw mapped;
          warnings.push(`The board "${doc.name}" could not be read, so its images are missing.`);
          return { doc, content: null };
        }
      }),
    );

    const extracted = await extractPage({ resource, documents, boards });
    const details: PageDetails = {
      projectId,
      id: resource.id,
      name: resource.name,
      tags: resource.tags ?? [],
      aliases: resource.aliases ?? [],
      updatedAt: resource.updatedAt ?? null,
      documents: (resource.documents ?? [])
        .filter((d) => !d.deletedAt)
        .map((d) => ({ id: d.id, name: d.name, type: d.type })),
      images: extracted.images.map(({ url: _url, ...image }) => image),
      size: extracted.size,
      warnings,
      fetchedAt: new Date().toISOString(),
    };
    const content: PageContent = {
      projectId,
      id: resource.id,
      name: resource.name,
      aliases: resource.aliases ?? [],
      tags: resource.tags ?? [],
      sidebar: await toContent(resource.properties ?? []),
      documents: await Promise.all(
        documents.map(async ({ doc, blocks }) => ({
          id: doc.id,
          name: doc.name,
          blocks: blocks ? await toContent(blocks) : [],
          ...(blocks ? {} : { failed: true }),
        })),
      ),
      otherDocuments: (resource.documents ?? [])
        .filter((d) => !d.deletedAt && d.type !== "page" && d.type !== "blank")
        .map((d) => d.name),
      warnings,
      fetchedAt: details.fetchedAt,
    };
    return { details, content, images: new Map(extracted.images.map((img) => [img.id, img])) };
  }

  /** A page as the GM sees it, or ("public") as a player may: hidden parts left out. */
  async getPage(caller: Caller, projectId: string, resourceId: string, fresh = false, audience: PageListAudience = "gm"): Promise<CachedPage> {
    const key = `${caller.keyId}/${audience}/${projectId}/${resourceId}`;
    if (!fresh) {
      const cached = this.pages.get(key);
      if (cached) return cached;
    }
    const page = await this.pageFlight.run(key, () => this.load(caller, projectId, resourceId, audience));
    this.pages.set(key, page);
    return page;
  }

  /** Image bytes for an image that belongs to the given page. */
  async getImage(caller: Caller, projectId: string, resourceId: string, imageId: string, audience: PageListAudience = "gm"): Promise<FetchedImage> {
    let page = await this.getPage(caller, projectId, resourceId, false, audience);
    let image = page.images.get(imageId);
    if (!image) {
      // The page may have changed since it was cached.
      page = await this.getPage(caller, projectId, resourceId, true, audience);
      image = page.images.get(imageId);
    }
    if (!image) throw new HttpError(404, "IMAGE_NOT_FOUND", "That image is no longer on this page.");

    const url = image.url;
    const cached = this.images.get(url);
    if (cached) return cached;
    const fetched = await this.imageFlight.run(url, async () => {
      try {
        const result = await this.fetchImage(url, {
          maxBytes: this.options.maxSourceImageBytes,
          allowHosts: this.options.assetHostAllowlist,
          allowInsecure: this.options.allowInsecureAssetFetch,
        });
        const mime = sniffImageMime(result.body);
        if (!mime) throw new HttpError(415, "UNSUPPORTED_IMAGE", "This image is not a PNG, JPEG, GIF, WebP or AVIF file.");
        return { body: result.body, mime };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof SafeFetchError) {
          if (err.reason === "too_large") {
            throw new HttpError(413, "PAYLOAD_TOO_LARGE", "This image is too large to import.");
          }
          if (err.reason === "blocked") throw new HttpError(403, "IMAGE_UNAVAILABLE", `This image's host is not allowed: ${err.message}`);
          const retryable = err.reason !== "http_status" || (err.status ?? 0) >= 500;
          throw new HttpError(502, "IMAGE_UNAVAILABLE", `The image could not be downloaded (${err.message}).`, { retryable });
        }
        throw new HttpError(502, "IMAGE_UNAVAILABLE", "The image could not be downloaded.", { retryable: true });
      }
    });
    this.images.set(url, fetched);
    return fetched;
  }
}
