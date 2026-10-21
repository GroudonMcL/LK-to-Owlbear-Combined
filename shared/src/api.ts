// Wire contract between the backend and the extension. Only data the extension
// needs crosses this boundary: never raw asset URLs, and never the
// LegendKeeper API key, which stays in the server's secrets.

import type { DetectedSize } from "./size.js";

export type ErrorCode =
  | "UNAUTHORIZED" // missing or wrong access password
  | "BAD_REQUEST"
  | "NOT_FOUND" // route or entity missing on the backend
  | "PROJECT_NOT_CONFIGURED" // LegendKeeper doesn't know the project
  | "PAGE_LIST_NOT_BUILT" // the server holds no page list for this project yet
  | "PAGE_NOT_FOUND" // LegendKeeper answered 404: deleted, hidden or no access
  | "IMAGE_NOT_FOUND" // image id is not part of this page (any more)
  | "IMAGE_UNAVAILABLE" // the image exists on the page but could not be fetched
  | "UNSUPPORTED_IMAGE" // fetched bytes are not a supported raster format
  | "PAYLOAD_TOO_LARGE"
  | "STORAGE_FULL"
  | "UPSTREAM_AUTH" // LegendKeeper rejected the server's API key (401/402/403)
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE" // network failure or 5xx talking to LegendKeeper
  | "INTERNAL";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** True when repeating the same request later may succeed. */
    retryable: boolean;
    /** Seconds to wait, when known (429). */
    retryAfter?: number;
    /** LegendKeeper request id, for support. */
    upstreamRequestId?: string;
  };
}

export interface HealthResponse {
  ok: true;
  version: string;
  tokenHosting: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  isPublic?: boolean;
}

/** The projects the server's API keys open (a key opens exactly one). */
export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface SearchHit {
  id: string;
  name: string;
  /** Ancestor names from the root down; empty for a root page. */
  path: string[];
  tags: string[];
  iconGlyph: string | null;
  iconColor: string | null;
  /** Present when the match was in a document's content rather than the title. */
  match: { documentName: string; snippet: string; start: number; end: number } | null;
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
  /** LegendKeeper search returns a single page; true when the limit was reached. */
  limited: boolean;
}

export type PageImageSource = "block" | "board" | "property" | "banner" | "resource";

export interface PageImage {
  /** Opaque, stable id for this image within the page (hash of its URL). */
  id: string;
  source: PageImageSource;
  label: string;
  alt?: string;
  documentName?: string;
}

export interface PageDocumentSummary {
  id: string;
  name: string;
  type: string;
}

export interface PageDetails {
  projectId: string;
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  updatedAt: string | null;
  documents: PageDocumentSummary[];
  images: PageImage[];
  size: DetectedSize | null;
  /** Non-fatal problems, e.g. a document whose blocks could not be read. */
  warnings: string[];
  fetchedAt: string;
}

/** A pass the GM's browser asks for and hands to a player: it opens public pages only. */
export interface PlayerPassResponse {
  pass: string;
  expiresAt: string;
}

export interface TokenUploadResponse {
  url: string;
  hash: string;
  width: number;
  height: number;
  mime: "image/png" | "image/webp";
  bytes: number;
  /** False when an identical image was already stored. */
  created: boolean;
}
