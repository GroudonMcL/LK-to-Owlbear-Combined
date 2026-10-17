// The room's LegendKeeper project. The GM picks it in Settings and the
// extension records it in room metadata, so players' browsers know which
// project's public pages to search without any settings of their own.

import type { Platform } from "../platform/types";
import { NAMESPACE } from "./links";
import type { Settings } from "./settings";

export const ROOM_PROJECT_KEY = `${NAMESPACE}/project`;

export interface RoomProject {
  id: string;
  name: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoomProject(raw: unknown): RoomProject | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, name } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !ID.test(id)) return null;
  return { id, name: typeof name === "string" ? name.slice(0, 120) : id };
}

export async function getRoomProject(platform: Platform): Promise<RoomProject | null> {
  return parseRoomProject((await platform.getRoomMetadata())[ROOM_PROJECT_KEY]);
}

/** GM only: records the GM's selected project on the room, when it changed. */
export async function publishProject(platform: Platform, settings: Pick<Settings, "projectId" | "projectName">): Promise<void> {
  if (!settings.projectId) return;
  const current = await getRoomProject(platform);
  if (current?.id === settings.projectId && current.name === settings.projectName) return;
  await platform.setRoomMetadata({ [ROOM_PROJECT_KEY]: { id: settings.projectId, name: settings.projectName.slice(0, 120) } });
}
