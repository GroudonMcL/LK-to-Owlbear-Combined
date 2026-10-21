// Where the server keeps built page lists: Workers KV on Cloudflare, memory
// when self-hosted. Values are JSON text; a build's parts are temporary.

export interface PageListStore {
  get(key: string): Promise<string | null>;
  /** `ttlSeconds` marks a temporary value (a build's parts). */
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;
}

/** In-process store: lists last until the server restarts, then are built again. */
export class MemoryPageListStore implements PageListStore {
  private readonly values = new Map<string, { value: string; expires: number }>();

  async get(key: string): Promise<string | null> {
    const hit = this.values.get(key);
    if (!hit) return null;
    if (hit.expires <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return hit.value;
  }

  async put(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      // Drop expired parts so abandoned builds don't pile up.
      for (const [k, v] of this.values) if (v.expires <= Date.now()) this.values.delete(k);
    }
    this.values.set(key, { value, expires: ttlSeconds === undefined ? Infinity : Date.now() + ttlSeconds * 1000 });
  }
}
