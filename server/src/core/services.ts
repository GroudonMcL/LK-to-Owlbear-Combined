import type {
  PageContent,
  PageDetails,
  ListedResource,
  ProjectsResponse,
  ResourceChunk,
  ProjectSummary,
  SearchHit,
  SearchResponse,
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
        UNAUTHENTICATED: "LegendKeeper didn't accept your API key: it may be mistyped, revoked or expired.",
        PAID_PLAN_REQUIRED: "LegendKeeper API keys need the project owner to be on a paid plan.",
        SUBSCRIPTION_LAPSED: "The LegendKeeper project owner's plan has lapsed.",
        WRONG_PROJECT: "Your API key belongs to a different LegendKeeper project.",
        FORBIDDEN: "Your API key can't open that LegendKeeper project.",
        INSUFFICIENT_SCOPE: "Your LegendKeeper API key lacks a required scope.",
      };
      return new HttpError(502, "UPSTREAM_AUTH", reasons[err.code] ?? `LegendKeeper refused your API key (${err.code}).`, ids);
    }
    if (err.status >= 500) {
      return new HttpError(502, "UPSTREAM_UNAVAILABLE", "LegendKeeper had a temporary problem. Try again.", { retryable: true, ...ids });
    }
    return new HttpError(502, "INTERNAL", `LegendKeeper rejected the request (${err.code}).`, ids);
  }
  return new HttpError(500, "INTERNAL", "Unexpected server error.");
}

/**
 * Whoever is calling: a LegendKeeper client holding the API key the
 * extension sent, and a short digest of that key. Every cache is keyed by
 * the digest, so one key's results (hidden pages, say) never answer another.
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
        if (!found) throw new HttpError(502, "UPSTREAM_AUTH", "Your API key doesn't open any LegendKeeper project.");
        return { id: found.id, name: found.name ?? found.id, isPublic: found.isPublic ?? false };
      } catch (err) {
        throw mapUpstreamError(err, new HttpError(502, "UPSTREAM_AUTH", "Your API key doesn't open any LegendKeeper project."));
      }
    });
    this.cache.set(caller.keyId, project);
    return project;
  }

  async list(caller: Caller, fresh = false): Promise<ProjectsResponse> {
    return { projects: [await this.projectOf(caller, fresh)] };
  }

  /** The caller's project, which must be `projectId`: a key opens only its own project. */
  async require(caller: Caller, projectId: string): Promise<ProjectSummary> {
    const project = await this.projectOf(caller);
    if (project.id !== projectId) {
      throw new HttpError(403, "WRONG_PROJECT", "Your API key belongs to a different LegendKeeper project. Choose it again in Settings.");
    }
    return project;
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
  pageListTtlMs?: number;
  /** LegendKeeper list calls (100 resources each) per chunk. */
  listRequestsPerChunk?: number;
  maxSourceImageBytes: number;
  assetHostAllowlist: string[] | null;
  allowInsecureAssetFetch: boolean;
  fetchImage: ImageFetcher;
}

const MAX_PAGE_DOCUMENTS = 8;
/** Board tabs read for images; each is one more LegendKeeper call. */
const MAX_BOARD_DOCUMENTS = 4;
/**
 * listResources calls (100 resources each) per chunk. With the project lookup
 * this stays well under Cloudflare's 50 outbound calls per request, and a
 * chunk answers in a few seconds.
 */
const LIST_REQUESTS_PER_CHUNK = 15;

export class PageService {
  private readonly pages: TtlCache<string, CachedPage>;
  private readonly searches: TtlCache<string, SearchResponse>;
  private readonly chunks: TtlCache<string, ResourceChunk>;
  private readonly chunkFlight = new InFlight<string, ResourceChunk>();
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
    this.chunks = new TtlCache({ ttlMs: options.pageListTtlMs ?? 5 * 60_000, maxEntries: 60 });
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

  /**
   * One slice of the caller's project's resource listing, hidden ones
   * included, starting at `cursor` ("" for the start). The browser follows
   * `nextCursor` and builds the page list itself: a big project needs more
   * LegendKeeper calls than one Worker request may make (50 on Cloudflare's
   * free plan) and more time than one browser request should wait.
   */
  async resourceChunk(caller: Caller, projectId: string, cursor: string, fresh = false): Promise<ResourceChunk> {
    const key = `gm/${caller.keyId}/${projectId}/${cursor}`;
    if (!fresh) {
      const cached = this.chunks.get(key);
      if (cached) return cached;
    }
    const chunk = await this.chunkFlight.run(key, async () => {
      const project = await this.projects.require(caller, projectId);
      try {
        const { resources, nextCursor } = await this.listResources(caller.client, projectId, cursor);
        return { project: { id: project.id, name: project.name, isPublic: project.isPublic ?? false }, resources, nextCursor };
      } catch (err) {
        throw mapUpstreamError(err, new HttpError(404, "PROJECT_NOT_CONFIGURED", "Project not found."));
      }
    });
    this.chunks.set(key, chunk);
    return chunk;
  }

  /**
   * A slice of a project's public pages, for players, fetched from
   * LegendKeeper without a key: exactly what an anonymous visitor can see. A
   * project that refuses anonymous visitors (a private one) gives an empty,
   * non-public slice.
   */
  async publicResourceChunk(projectId: string, cursor: string): Promise<ResourceChunk> {
    const key = `public/${projectId}/${cursor}`;
    const cached = this.chunks.get(key);
    if (cached) return cached;
    const chunk = await this.chunkFlight.run(key, async () => {
      // Anonymous visitors can't read the project's name; the extension shows the room's.
      const project = { id: projectId, name: projectId, isPublic: true };
      try {
        const { resources, nextCursor } = await this.listResources(this.anonymous, projectId, cursor);
        return { project, resources, nextCursor };
      } catch (err) {
        if (err instanceof LkApiError && [401, 403, 404].includes(err.status)) {
          return { project: { ...project, isPublic: false }, resources: [], nextCursor: null };
        }
        throw mapUpstreamError(err, new HttpError(404, "PROJECT_NOT_CONFIGURED", "Project not found."));
      }
    });
    this.chunks.set(key, chunk);
    return chunk;
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

  private async load(caller: Caller, projectId: string, resourceId: string): Promise<CachedPage> {
    await this.projects.require(caller, projectId);
    const client = caller.client;
    const base = `/api/v3/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`;
    const notFound = new HttpError(404, "PAGE_NOT_FOUND", "This page no longer exists or your API key cannot see it.");
    let resource: LkResource;
    try {
      resource = await client.get<LkResource>(base);
    } catch (err) {
      throw mapUpstreamError(err, notFound);
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
          return { doc, blocks: content.blocks as LkNode[] };
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

  async getPage(caller: Caller, projectId: string, resourceId: string, fresh = false): Promise<CachedPage> {
    const key = `${caller.keyId}/${projectId}/${resourceId}`;
    if (!fresh) {
      const cached = this.pages.get(key);
      if (cached) return cached;
    }
    const page = await this.pageFlight.run(key, () => this.load(caller, projectId, resourceId));
    this.pages.set(key, page);
    return page;
  }

  /** Image bytes for an image that belongs to the given page. */
  async getImage(caller: Caller, projectId: string, resourceId: string, imageId: string): Promise<FetchedImage> {
    let page = await this.getPage(caller, projectId, resourceId);
    let image = page.images.get(imageId);
    if (!image) {
      // The page may have changed since it was cached.
      page = await this.getPage(caller, projectId, resourceId, true);
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
