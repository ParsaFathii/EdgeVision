// EdgeVision — engine orchestration service
// Copyright © 2026 Parsa Fathi — Apache-2.0

import type { Line, Roi, StreamInput } from "./validate";

/** Engine stdout NDJSON line types (frozen contract). */
export type EngineLineType =
  | "ready"
  | "session_started"
  | "state"
  | "frame"
  | "event"
  | "metrics"
  | "settings_applied"
  | "pong"
  | "session_stopped"
  | "error";

export interface EngineObject {
  oid: number;
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EngineDetection {
  trackId: number;
  label: string;
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EngineEvent {
  type: string;
  ts: number;
  trackId?: number;
  label?: string;
  payload?: Record<string, unknown>;
}

export interface EngineSessionSummary {
  framesProcessed: number;
  framesDropped: number;
  detectionsTotal: number;
  eventsTotal: number;
  uptimeMs: number;
}

export type EngineLine =
  | { type: "ready"; ts?: number }
  | { type: "session_started"; ts?: number }
  | { type: "state"; state?: string; reason?: string; ts?: number }
  | {
      type: "frame";
      frameIndex?: number;
      ts?: number;
      latencyMs?: number;
      objects?: EngineObject[];
      detections?: EngineDetection[];
    }
  | { type: "event"; ev?: EngineEvent }
  | {
      type: "metrics";
      ts?: number;
      sourceFps?: number;
      processedFps?: number;
      latency?: Record<string, number>;
      queueDepth?: number;
      queueCapacity?: number;
      droppedTotal?: number;
      cpuPercent?: number;
      memoryMb?: number;
      framesProcessed?: number;
      detectionsTotal?: number;
      uptimeMs?: number;
    }
  | { type: "settings_applied"; [k: string]: unknown }
  | { type: "pong"; ts?: number }
  | {
      type: "session_stopped";
      reason?: string;
      ts?: number;
      summary?: Partial<EngineSessionSummary>;
    }
  | { type: "error"; message?: string; code?: string | number; ts?: number };

/**
 * Parse one NDJSON line from the engine. Returns null for blank lines,
 * non-JSON lines, or lines without a string `type` field (logged+skipped by
 * the caller — never fatal).
 */
export function parseEngineLine(line: string): EngineLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (
    typeof obj !== "object" ||
    obj === null ||
    typeof (obj as { type?: unknown }).type !== "string"
  )
    return null;
  return obj as EngineLine;
}

/** FNV-1a 32-bit stable hash of an id — used as the deterministic seed. */
export function stableSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const signed = h | 0;
  return Math.abs(signed) || 1;
}

/**
 * Build the native engine CLI args from a Stream row + session id, exactly
 * per the frozen contract.
 */
export function buildEngineArgs(
  sessionId: string,
  streamId: string,
  stream: StreamInput,
): string[] {
  const args: string[] = [
    "--session-id",
    sessionId,
    "--stream-id",
    streamId,
    "--seed",
    String(stableSeed(streamId)),
    "--scene",
    stream.scene,
    "--width",
    String(stream.width),
    "--height",
    String(stream.height),
    "--target-fps",
    String(stream.targetFps),
    "--objects",
    String(stream.objectCount),
    "--queue-capacity",
    String(stream.queueCapacity),
    "--confidence",
    String(stream.confidenceThreshold),
  ];
  if (stream.classFilter.length > 0)
    args.push("--class-filter", stream.classFilter.join(","));
  if (stream.roi) {
    const r = stream.roi as Roi;
    args.push("--roi", `${r.x},${r.y},${r.w},${r.h}`);
  }
  if (stream.line) {
    const l = stream.line as Line;
    args.push("--line", `${l.x1},${l.y1},${l.x2},${l.y2}`);
  }
  args.push(
    "--grid",
    `${stream.gridCols}x${stream.gridRows}`,
    "--metrics-interval",
    "1000",
    "--emit-stride",
    String(stream.emitStride),
  );
  return args;
}
