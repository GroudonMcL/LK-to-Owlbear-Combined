import type {
  ApiErrorBody,
  ErrorCode,
  HealthResponse,
  PageContent,
  PageDetails,
  ProjectsResponse,
  ResourceChunk,
  SearchResponse,
  TokenUploadResponse,
} from "@lkob/shared";
import type { Settings } from "./settings";

/** A failed call. `network` means the server could not be reached at all. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "http" | "aborted",
    readonly code: ErrorCode | "NETWORK" | "ABORTED",
    readonly retryable: boolean,
    readonly status = 0,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "aborted";
}

const TIMEOUT_MS = 20_000;
/** A page-list chunk is up to 15 LegendKeeper calls made one after another. */
const CHUNK_TIMEOUT_MS = 60_000;

export class ApiClient {
  private readonly base: string;

  constructor(private readonly settings: Pick<Settings, "backendUrl" | "apiKey">) {
    this.base = settings.backendUrl.replace(/\/+$/, "");
  }

  private async request(path: string, init: RequestInit = {}, signal?: AbortSignal, auth = true, timeoutMs = TIMEOUT_MS): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? anySignal([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(this.base + path, {
        ...init,
        signal: combined,
        headers: { ...(auth ? { Authorization: `Bearer ${this.settings.apiKey}` } : {}), ...(init.headers ?? {}) },
      });
    } catch (err) {
      if (signal?.aborted) throw new ApiError("Cancelled", "aborted", "ABORTED", false);
      const timedOut = timeout.aborted;
      throw new ApiError(
        timedOut ? "The server took too long to answer." : "Could not reach the extension's server. Check the URL and your connection.",
        "network",
        "NETWORK",
        true,
      );
    }
    if (!response.ok) {
      let body: ApiErrorBody | null = null;
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        // Not our JSON: a proxy or wrong URL.
      }
      if (body?.error) {
        throw new ApiError(body.error.message, "http", body.error.code, body.error.retryable, response.status, body.error.retryAfter);
      }
      throw new ApiError(
        `The server answered ${response.status}. Is the URL pointing at this extension's server?`,
        "http",
        "INTERNAL",
        response.status >= 500,
        response.status,
      );
    }
    return response;
  }

  private async json<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
    return (await (await this.request(path, init, signal)).json()) as T;
  }

  async health(): Promise<HealthResponse> {
    // Health is public; requesting it confirms the URL, not the key.
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ApiError("Could not reach the extension's server. Check the URL.", "network", "NETWORK", true);
    }
    if (!res.ok) throw new ApiError(`The server answered ${res.status}.`, "http", "INTERNAL", false, res.status);
    const body = (await res.json().catch(() => null)) as HealthResponse | null;
    if (!body?.ok) throw new ApiError("That URL is not this extension's server.", "http", "INTERNAL", false, res.status);
    return body;
  }

  /** The project the API key opens; this is also how a key is checked. */
  projects(refresh = false): Promise<ProjectsResponse> {
    return this.json(`/api/projects${refresh ? "?refresh=1" : ""}`);
  }

  search(projectId: string, query: string, signal?: AbortSignal): Promise<SearchResponse> {
    const q = new URLSearchParams({ q: query, limit: "25" });
    return this.json(`/api/projects/${encodeURIComponent(projectId)}/search?${q}`, undefined, signal);
  }

  page(projectId: string, resourceId: string, fresh = false, signal?: AbortSignal): Promise<PageDetails> {
    return this.json(
      `/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(resourceId)}${fresh ? "?fresh=1" : ""}`,
      undefined,
      signal,
    );
  }

  /** A page's content to read, from LegendKeeper's API (hidden pages and secrets included). */
  content(projectId: string, resourceId: string, fresh = false, signal?: AbortSignal): Promise<PageContent> {
    return this.json(
      `/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(resourceId)}/content${fresh ? "?fresh=1" : ""}`,
      undefined,
      signal,
    );
  }

  /** A slice of the project's pages, hidden ones included (needs the API key). Follow `nextCursor`. */
  async resourceChunk(projectId: string, cursor: string, fresh = false): Promise<ResourceChunk> {
    const q = new URLSearchParams({ cursor, ...(fresh ? { fresh: "1" } : {}) });
    const res = await this.request(`/api/projects/${encodeURIComponent(projectId)}/resources?${q}`, {}, undefined, true, CHUNK_TIMEOUT_MS);
    return (await res.json()) as ResourceChunk;
  }

  /** A slice of the project's public pages; open to players, who have no API key. */
  async publicResourceChunk(projectId: string, cursor: string): Promise<ResourceChunk> {
    const q = new URLSearchParams({ cursor });
    const res = await this.request(`/api/public/projects/${encodeURIComponent(projectId)}/resources?${q}`, {}, undefined, false, CHUNK_TIMEOUT_MS);
    return (await res.json()) as ResourceChunk;
  }

  async imageBlob(projectId: string, resourceId: string, imageId: string, signal?: AbortSignal): Promise<Blob> {
    const res = await this.request(
      `/api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(resourceId)}/images/${encodeURIComponent(imageId)}`,
      {},
      signal,
    );
    return res.blob();
  }

  uploadToken(png: Blob): Promise<TokenUploadResponse> {
    return this.json("/api/tokens", { method: "POST", body: png, headers: { "Content-Type": png.type || "image/png" } });
  }

  async deleteToken(hash: string): Promise<void> {
    await this.request(`/api/tokens/${encodeURIComponent(hash)}`, { method: "DELETE" });
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/** Human message for any error thrown by the client. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "RATE_LIMITED" && err.retryAfter) return `${err.message} (about ${err.retryAfter}s)`;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
