export interface Config {
  host: string;
  port: number;
  /** Passwords the extension may send (LKOB_ACCESS_TOKENS). Not LegendKeeper keys. */
  accessTokens: string[];
  /** LegendKeeper API keys (LK_API_KEYS), one per project. They never leave the server. */
  lkApiKeys: string[];
  lkBaseUrl: string;
  /** Origins allowed to call /api, or "*" for any (the access password still applies). */
  allowedOrigins: string[] | "*";
  /** Public URL of this server, used to build token image URLs. */
  publicBaseUrl: string | null;
  /** Whether finished tokens may be hosted by this server (needs a store). */
  tokenHosting: boolean;
  /** Node only: directory for hosted token images. */
  tokenStoreDir: string;
  tokenStoreMaxBytes: number;
  maxTokenUploadBytes: number;
  maxSourceImageBytes: number;
  /** Optional allowlist of hosts (or parent domains) images may be fetched from. */
  assetHostAllowlist: string[] | null;
  /** Test-only: permit http:// and private addresses for image fetches. */
  allowInsecureAssetFetch: boolean;
  /** Requests per minute per access password (and per address, for public routes). */
  rateLimitPerMinute: number;
}

export class ConfigError extends Error {}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${name} must be a positive number`);
  return n;
}

export type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): Config {
  const accessTokens = list(env.LKOB_ACCESS_TOKENS);
  if (accessTokens.length === 0) {
    throw new ConfigError("LKOB_ACCESS_TOKENS is required (one password, or several separated by commas)");
  }

  // LK_API_KEY is the name LegendKeeper Link used.
  const lkApiKeys = list(env.LK_API_KEYS || env.LK_API_KEY);
  if (lkApiKeys.length === 0) throw new ConfigError("LK_API_KEYS is required (one LegendKeeper API key per project)");

  const origins = list(env.LKOB_ALLOWED_ORIGINS);
  const allowedOrigins = origins.length === 0 || origins.includes("*") ? "*" : origins.map((o) => o.replace(/\/$/, ""));

  const hosting = (env.LKOB_TOKEN_HOSTING ?? "on").toLowerCase();
  if (!["on", "off"].includes(hosting)) throw new ConfigError("LKOB_TOKEN_HOSTING must be on or off");

  const assetHosts = list(env.LK_ASSET_HOSTS).map((h) => h.toLowerCase().replace(/^\*?\./, ""));

  const publicBaseUrl = env.LKOB_PUBLIC_URL ? env.LKOB_PUBLIC_URL.replace(/\/+$/, "") : null;
  if (publicBaseUrl && !/^https?:\/\//.test(publicBaseUrl)) throw new ConfigError("LKOB_PUBLIC_URL must be an http(s) URL");

  const lkBaseUrl = (env.LK_BASE_URL || "https://www.legendkeeper.com").replace(/\/+$/, "");

  return {
    host: env.HOST || "0.0.0.0",
    port: positiveNumber(env.PORT, 8787, "PORT"),
    accessTokens,
    lkApiKeys,
    lkBaseUrl,
    allowedOrigins,
    publicBaseUrl,
    tokenHosting: hosting === "on",
    tokenStoreDir: env.LKOB_TOKEN_DIR || "./data/tokens",
    tokenStoreMaxBytes: positiveNumber(env.LKOB_TOKEN_STORE_MAX_MB, 1024, "LKOB_TOKEN_STORE_MAX_MB") * 1024 * 1024,
    maxTokenUploadBytes: 6 * 1024 * 1024,
    maxSourceImageBytes:
      positiveNumber(env.LKOB_MAX_SOURCE_IMAGE_MB, 30, "LKOB_MAX_SOURCE_IMAGE_MB") * 1024 * 1024,
    assetHostAllowlist: assetHosts.length ? assetHosts : null,
    allowInsecureAssetFetch: env.LKOB_INSECURE_ASSET_FETCH === "1",
    rateLimitPerMinute: positiveNumber(env.LKOB_RATE_LIMIT_PER_MINUTE, 240, "LKOB_RATE_LIMIT_PER_MINUTE"),
  };
}
