// Players searching pages and making tokens. A player asks; the GM approves
// in a dialog; the GM's browser asks the server for a player pass and sends
// it to that player. The pass opens only public pages, with hidden tabs,
// fields and secrets left out, and lasts 12 hours. The LegendKeeper key and
// the GM's password never leave the server or the GM's browser.

import { useEffect, useState } from "react";
import { ACCESS_MODAL_ID, CH_ACCESS_ANSWER, CH_ACCESS_REQUEST, extensionUrl } from "../platform/channels";
import type { Platform } from "../platform/types";
import { ApiClient } from "./api";
import { getRoomProject } from "./project";
import { loadSettings } from "./settings";

const KEY = "lkob.player-access.v1";
const EVENT = "lkob-player-access";
/** A request the GM hasn't answered in this long is treated as unanswered. */
const PENDING_MS = 3 * 60_000;

export type PlayerAccess =
  | { status: "none" }
  | { status: "pending"; at: number }
  | { status: "denied"; at: number }
  | { status: "granted"; projectId: string; pass: string; expiresAt: string };

interface Stored {
  roomId: string;
  access: PlayerAccess;
}

export interface AccessRequest {
  playerId: string;
  name: string;
}

export type AccessAnswer = { playerId: string; granted: false } | { playerId: string; granted: true; projectId: string; pass: string; expiresAt: string };

export function readAccess(roomId: string): PlayerAccess {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
    if (!stored || stored.roomId !== roomId) return { status: "none" };
    const access = stored.access;
    if (access.status === "granted" && Date.parse(access.expiresAt) <= Date.now()) return { status: "none" };
    if (access.status === "pending" && Date.now() - access.at > PENDING_MS) return { status: "none" };
    return access;
  } catch {
    return { status: "none" };
  }
}

function writeAccess(roomId: string, access: PlayerAccess): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ roomId, access } satisfies Stored));
  } catch {
    // Storage blocked: the access lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Forgets a pass the server no longer accepts (expired, or the password changed). */
export function dropAccess(roomId: string): void {
  writeAccess(roomId, { status: "none" });
}

/** This player's access in this room, kept current across frames. */
export function usePlayerAccess(platform: Platform): PlayerAccess {
  const roomId = platform.roomId();
  const [access, setAccess] = useState(() => readAccess(roomId));
  useEffect(() => {
    const refresh = () => setAccess(readAccess(roomId));
    const onStorage = (e: StorageEvent) => e.key === KEY && refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", onStorage);
    // A pending request or a pass runs out by itself.
    const timer = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", onStorage);
      clearInterval(timer);
    };
  }, [roomId]);
  return access;
}

/** The client a player's pages and images come through. */
export function playerApi(access: PlayerAccess): ApiClient | null {
  const backendUrl = loadSettings().backendUrl;
  if (access.status !== "granted" || !backendUrl) return null;
  return new ApiClient({ backendUrl, accessToken: access.pass }, "player");
}

/** A player: asks the GM. */
export async function requestAccess(platform: Platform): Promise<void> {
  const request: AccessRequest = { playerId: await platform.playerId(), name: await platform.playerName().catch(() => "A player") };
  writeAccess(platform.roomId(), { status: "pending", at: Date.now() });
  await platform.sendToRoom(CH_ACCESS_REQUEST, request);
}

export function parseAccessRequest(data: unknown): AccessRequest | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.playerId !== "string" || !d.playerId || d.playerId.length > 200) return null;
  return { playerId: d.playerId, name: typeof d.name === "string" && d.name ? d.name.slice(0, 100) : "A player" };
}

/** The GM's browser: a player asked; show the dialog. */
export function showAccessRequest(platform: Platform, request: AccessRequest): Promise<void> {
  const url = extensionUrl("share.html", { kind: "access", player: request.playerId, from: request.name });
  return platform.openModal(ACCESS_MODAL_ID, url, 400, 220);
}

/** The GM: answers a player's request, with a pass if allowed. */
export async function answerAccess(platform: Platform, playerId: string, allow: boolean): Promise<void> {
  if (!allow) {
    await platform.sendToRoom(CH_ACCESS_ANSWER, { playerId, granted: false } satisfies AccessAnswer);
    return;
  }
  const settings = loadSettings();
  const project = await getRoomProject(platform);
  const projectId = project?.id ?? settings.projectId;
  if (!projectId || !settings.accessToken) throw new Error("Connect LegendKeeper in Settings first.");
  const { pass, expiresAt } = await new ApiClient(settings).playerPass(projectId);
  await platform.sendToRoom(CH_ACCESS_ANSWER, { playerId, granted: true, projectId, pass, expiresAt } satisfies AccessAnswer);
}

/** A player's browser: the GM answered someone; keep it if it was us. */
export async function receiveAccessAnswer(platform: Platform, data: unknown): Promise<void> {
  if (!data || typeof data !== "object") return;
  const answer = data as Partial<AccessAnswer>;
  if (answer.playerId !== (await platform.playerId())) return;
  const roomId = platform.roomId();
  if (answer.granted === true && typeof answer.pass === "string" && typeof answer.projectId === "string" && typeof answer.expiresAt === "string") {
    writeAccess(roomId, { status: "granted", projectId: answer.projectId, pass: answer.pass, expiresAt: answer.expiresAt });
    await platform.notify("The GM let you search pages and make tokens. Open LegendKeeper from the toolbar.", "SUCCESS");
  } else if (answer.granted === false) {
    writeAccess(roomId, { status: "denied", at: Date.now() });
    await platform.notify("The GM didn't allow making tokens just now.", "INFO");
  }
}
