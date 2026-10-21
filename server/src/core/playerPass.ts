// Player passes: what a player's browser holds after the GM lets them search
// and make tokens. A pass is signed by this server and names one project and
// an expiry. It opens only the player routes, which serve public pages with
// their hidden parts left out; it never opens the GM's API, and the
// LegendKeeper key never leaves the server.

const PREFIX = "pp1";
/** A game evening, with room to spare. */
export const PASS_TTL_MS = 12 * 60 * 60_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export class PlayerPasses {
  private readonly key: Promise<CryptoKey>;

  /**
   * Signed with a key derived from the access passwords: changing the
   * LKOB_ACCESS_TOKENS secret withdraws every pass.
   */
  constructor(secrets: string[], private readonly now: () => number = Date.now) {
    const material = new TextEncoder().encode(`lkob-player-pass\u0000${secrets.join("\u0000")}`);
    this.key = crypto.subtle
      .digest("SHA-256", material)
      .then((raw) => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
  }

  async issue(projectId: string, ttlMs = PASS_TTL_MS): Promise<{ pass: string; expiresAt: string }> {
    const exp = this.now() + ttlMs;
    const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ p: projectId, e: exp })));
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await this.key, new TextEncoder().encode(`${PREFIX}.${payload}`)));
    return { pass: `${PREFIX}.${payload}.${toBase64Url(signature)}`, expiresAt: new Date(exp).toISOString() };
  }

  /** The project a pass opens, or null if it is forged, malformed or expired. */
  async verify(pass: string): Promise<string | null> {
    const parts = pass.split(".");
    if (parts.length !== 3 || parts[0] !== PREFIX || pass.length > 1024) return null;
    const signature = fromBase64Url(parts[2]);
    const payload = fromBase64Url(parts[1]);
    if (!signature || !payload) return null;
    const ok = await crypto.subtle.verify("HMAC", await this.key, signature, new TextEncoder().encode(`${PREFIX}.${parts[1]}`));
    if (!ok) return null;
    try {
      const body = JSON.parse(new TextDecoder().decode(payload)) as { p?: unknown; e?: unknown };
      if (typeof body.p !== "string" || typeof body.e !== "number" || body.e <= this.now()) return null;
      return body.p;
    } catch {
      return null;
    }
  }
}

export function isPlayerPass(token: string): boolean {
  return token.startsWith(`${PREFIX}.`);
}
