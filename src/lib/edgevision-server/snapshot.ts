// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { internalFetch } from "./internal";

export interface ActiveSessionInfo {
  streamId: string;
  sessionId: string;
  state: string;
  startedAt: string;
  framesProcessed: number;
  detectionsTotal: number;
}

const CACHE_TTL_MS = 2000;

const globalForSnapshot = globalThis as unknown as {
  __evSnapshotCache?: { at: number; sessions: ActiveSessionInfo[] };
};

/**
 * Active-session snapshot from the engine-service with a 2s in-memory
 * cache. Falls back to an empty list when the service is unreachable.
 */
export async function getSnapshot(
  force = false,
): Promise<ActiveSessionInfo[]> {
  const cache = globalForSnapshot.__evSnapshotCache;
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.sessions;
  }
  const res = await internalFetch("/internal/snapshot", undefined, 2000);
  const sessions =
    res.ok && Array.isArray(res.data.sessions)
      ? (res.data.sessions as ActiveSessionInfo[]).filter(
          (s) => typeof s?.streamId === "string",
        )
      : [];
  globalForSnapshot.__evSnapshotCache = { at: Date.now(), sessions };
  return sessions;
}

/** Active-session info for one stream (null when none is running). */
export async function activeSessionFor(
  streamId: string,
): Promise<ActiveSessionInfo | null> {
  const sessions = await getSnapshot();
  return sessions.find((s) => s.streamId === streamId) ?? null;
}
