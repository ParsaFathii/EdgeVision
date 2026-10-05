// EdgeVision — engine orchestration service
// Copyright © 2026 Parsa Fathi — Apache-2.0

import type { Database } from "bun:sqlite";
import type { Server } from "socket.io";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isoNow } from "./db";
import type { ServiceSettings } from "./settings";
import {
  buildEngineArgs,
  parseEngineLine,
  type EngineDetection,
  type EngineObject,
  type EngineSessionSummary,
} from "./protocol";
import { rowToStreamInput } from "./validate";

/** Resolve the native engine binary (ENGINE_BIN env override is for tests). */
export const ENGINE_BIN =
  process.env.ENGINE_BIN && process.env.ENGINE_BIN.length > 0
    ? resolve(process.env.ENGINE_BIN)
    : resolve(import.meta.dir, "..", "..", "engine-cpp", "build", "edgevision-engine");

/** True when the native engine binary exists on disk. */
export function engineBinaryExists(): boolean {
  try {
    return existsSync(ENGINE_BIN) && statSync(ENGINE_BIN).isFile();
  } catch {
    return false;
  }
}

/** Minimal structural type for the spawned child process. */
interface ChildProc {
  stdin: {
    write(data: string): unknown;
    flush(): unknown;
    end(): unknown;
  };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: string | number): unknown;
  pid: number;
}

export interface SessionInfo {
  streamId: string;
  sessionId: string;
  state: string;
  startedAt: string;
  framesProcessed: number;
  detectionsTotal: number;
}

export interface SessionRecord extends SessionInfo {
  reason: string | null;
  endedAt: string | null;
  framesDropped: number;
  eventsTotal: number;
}

export type ManagerResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

interface DetectionRow {
  sessionId: string;
  streamId: string;
  frameIndex: number;
  ts: string;
  label: string;
  confidence: number;
  trackId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ActiveSession {
  streamId: string;
  sessionId: string;
  state: string;
  startedAt: string;
  proc: ChildProc;
  detectionBuffer: DetectionRow[];
  flushTimer: ReturnType<typeof setInterval>;
  metricsSeen: number;
  framesProcessed: number;
  detectionsTotal: number;
  finalized: boolean;
  stopRequested: boolean;
  transitionWaiters: Array<(state: string) => void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function sessionRowToApi(row: Record<string, unknown> | null): SessionRecord | null {
  if (!row) return null;
  return {
    streamId: String(row.stream_id),
    sessionId: String(row.id),
    state: String(row.state),
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    startedAt: String(row.started_at),
    endedAt:
      row.ended_at === null || row.ended_at === undefined
        ? null
        : String(row.ended_at),
    framesProcessed: num(row.frames_processed, 0),
    framesDropped: num(row.frames_dropped, 0),
    detectionsTotal: num(row.detections_total, 0),
    eventsTotal: num(row.events_total, 0),
  };
}

/**
 * Owns the lifecycle of native engine child processes: spawn, protocol
 * routing, detection batching, metric persistence, realtime broadcasts,
 * and graceful/forced shutdown escalation.
 */
export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private readonly stmts;
  private readonly insertDetectionsTx;

  constructor(
    private readonly db: Database,
    private readonly io: Server,
    private readonly settings: ServiceSettings,
  ) {
    this.stmts = {
      insertSession: db.prepare(
        `INSERT INTO sessions (id, stream_id, state, reason, started_at, ended_at,
           frames_processed, frames_dropped, detections_total, events_total)
         VALUES (?, ?, 'STARTING', NULL, ?, NULL, 0, 0, 0, 0)`,
      ),
      getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
      updateSessionState: db.prepare("UPDATE sessions SET state = ? WHERE id = ?"),
      updateSessionCounters: db.prepare(
        "UPDATE sessions SET frames_processed = ?, detections_total = ? WHERE id = ?",
      ),
      bumpEventsTotal: db.prepare(
        "UPDATE sessions SET events_total = events_total + 1 WHERE id = ?",
      ),
      finalizeSession: db.prepare(
        `UPDATE sessions SET state = ?, reason = ?, ended_at = ?,
           frames_processed = ?, frames_dropped = ?, detections_total = ?, events_total = ?
         WHERE id = ?`,
      ),
      getStream: db.prepare("SELECT * FROM streams WHERE id = ?"),
      setStreamStatus: db.prepare(
        "UPDATE streams SET status = ?, updated_at = ? WHERE id = ?",
      ),
      insertDetection: db.prepare(
        `INSERT INTO detections (session_id, stream_id, frame_index, ts, label,
           confidence, track_id, x, y, w, h)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      insertMetric: db.prepare(
        `INSERT INTO metrics (session_id, stream_id, ts, source_fps, processed_fps,
           latency_avg_ms, latency_min_ms, latency_max_ms, latency_p50_ms, latency_p95_ms,
           queue_depth, dropped_total, cpu_percent, memory_mb, frames_processed, detections_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      insertEvent: db.prepare(
        `INSERT INTO events (session_id, stream_id, type, track_id, label, payload_json, ts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
    };
    this.insertDetectionsTx = db.transaction((rows: DetectionRow[]) => {
      for (const r of rows) {
        this.stmts.insertDetection.run(
          r.sessionId,
          r.streamId,
          r.frameIndex,
          r.ts,
          r.label,
          r.confidence,
          r.trackId,
          r.x,
          r.y,
          r.w,
          r.h,
        );
      }
    });
  }

  /** Live snapshot of all active sessions. */
  snapshot(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      streamId: s.streamId,
      sessionId: s.sessionId,
      state: s.state,
      startedAt: s.startedAt,
      framesProcessed: s.framesProcessed,
      detectionsTotal: s.detectionsTotal,
    }));
  }

  /** Spawn an engine child for the given stream. */
  async start(streamId: string): Promise<ManagerResult<SessionInfo>> {
    if (this.sessions.has(streamId)) {
      return {
        ok: false,
        status: 409,
        code: "SESSION_ACTIVE",
        message: "نشست دیگری برای این استریم در حال اجراست",
      };
    }
    const streamRow = this.stmts.getStream.get(streamId) as
      | Record<string, unknown>
      | null;
    if (!streamRow) {
      return {
        ok: false,
        status: 404,
        code: "STREAM_NOT_FOUND",
        message: "استریم مورد نظر یافت نشد",
      };
    }
    if (!engineBinaryExists()) {
      return {
        ok: false,
        status: 503,
        code: "ENGINE_BINARY_MISSING",
        message:
          "موتور بومی ساخته نشده است. اسکریپت scripts/build-engine.sh را اجرا کنید.",
      };
    }

    const stream = rowToStreamInput(streamRow);
    const sessionId = crypto.randomUUID();
    const startedAt = isoNow();
    this.stmts.insertSession.run(sessionId, streamId, startedAt);
    this.stmts.setStreamStatus.run("STARTING", isoNow(), streamId);

    let proc: ChildProc;
    try {
      proc = Bun.spawn({
        cmd: [ENGINE_BIN, ...buildEngineArgs(sessionId, streamId, stream)],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      }) as unknown as ChildProc;
    } catch (err) {
      console.error("[engine-service] engine spawn failed:", err);
      this.stmts.finalizeSession.run(
        "ERROR",
        "engine_spawn_failed",
        isoNow(),
        0,
        0,
        0,
        0,
        sessionId,
      );
      this.stmts.setStreamStatus.run("ERROR", isoNow(), streamId);
      return {
        ok: false,
        status: 500,
        code: "ENGINE_SPAWN_FAILED",
        message: "راه‌اندازی فرایند موتور ناموفق بود",
      };
    }

    const session: ActiveSession = {
      streamId,
      sessionId,
      state: "STARTING",
      startedAt,
      proc,
      detectionBuffer: [],
      flushTimer: setInterval(() => this.flushDetections(session), 1000),
      metricsSeen: 0,
      framesProcessed: 0,
      detectionsTotal: 0,
      finalized: false,
      stopRequested: false,
      transitionWaiters: [],
    };
    this.sessions.set(streamId, session);
    console.log(
      `[engine-service] session ${sessionId} spawned for stream ${streamId} (pid ${proc.pid})`,
    );

    this.broadcast(session, "session", {
      streamId,
      sessionId,
      state: "STARTING",
      startedAt,
    });

    this.pumpStdout(session);
    this.pumpStderr(session);
    this.watchExit(session);

    // Give the engine a short window to confirm start (or fail fast).
    const state = await Promise.race([
      new Promise<string>((resolve) => session.transitionWaiters.push(resolve)),
      sleep(2500).then(() => session.state),
    ]);
    return { ok: true, value: this.infoOf(session, state) };
  }

  /** Stop a running session with graceful escalation (stop → SIGTERM → SIGKILL). */
  async stop(streamId: string): Promise<ManagerResult<SessionRecord>> {
    const session = this.sessions.get(streamId);
    if (!session) {
      return {
        ok: false,
        status: 404,
        code: "NO_ACTIVE_SESSION",
        message: "نشست فعالی برای این استریم یافت نشد",
      };
    }
    session.stopRequested = true;
    try {
      session.proc.stdin.write("stop\n");
      session.proc.stdin.flush();
    } catch (err) {
      console.error("[engine-service] failed to write stop command:", err);
    }
    let exited = await this.raceExited(session.proc, 5000);
    if (!exited) {
      console.log(
        `[engine-service] session ${session.sessionId}: graceful stop timed out, sending SIGTERM`,
      );
      try {
        session.proc.kill("SIGTERM");
      } catch {
        /* already dead */
      }
      exited = await this.raceExited(session.proc, 2000);
      if (!exited) {
        console.log(
          `[engine-service] session ${session.sessionId}: SIGTERM timed out, sending SIGKILL`,
        );
        try {
          session.proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
        await session.proc.exited.catch(() => undefined);
      }
    }
    const row = this.stmts.getSession.get(session.sessionId) as
      | Record<string, unknown>
      | null;
    const record = sessionRowToApi(row);
    if (!record) {
      return {
        ok: false,
        status: 500,
        code: "INTERNAL",
        message: "خطای داخلی سرور",
      };
    }
    return { ok: true, value: record };
  }

  /** Stop every active session (used on service shutdown). */
  async shutdownAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    for (const streamId of ids) {
      try {
        await this.stop(streamId);
      } catch (err) {
        console.error(
          `[engine-service] shutdown of session for stream ${streamId} failed:`,
          err,
        );
      }
    }
  }

  private infoOf(s: ActiveSession, state?: string): SessionInfo {
    return {
      streamId: s.streamId,
      sessionId: s.sessionId,
      state: state ?? s.state,
      startedAt: s.startedAt,
      framesProcessed: s.framesProcessed,
      detectionsTotal: s.detectionsTotal,
    };
  }

  private async raceExited(proc: ChildProc, ms: number): Promise<boolean> {
    return Promise.race([
      proc.exited.then(
        () => true,
        () => true,
      ),
      sleep(ms).then(() => false),
    ]);
  }

  private broadcast(s: ActiveSession, event: string, payload: unknown): void {
    this.io.to(`stream:${s.streamId}`).emit(event, payload);
  }

  private setStreamStatus(streamId: string, status: string): void {
    this.stmts.setStreamStatus.run(status, isoNow(), streamId);
  }

  /** Continuously drain the child's stdout, dispatching NDJSON lines. */
  private pumpStdout(s: ActiveSession): void {
    void pumpLines(s.proc.stdout, (line) => this.handleLine(s, line));
  }

  /** Continuously drain the child's stderr into the service log. */
  private pumpStderr(s: ActiveSession): void {
    void pumpLines(s.proc.stderr, (line) => {
      const trimmed = line.trim();
      if (trimmed)
        console.log(`[engine] (stream ${s.streamId}) ${trimmed}`);
    });
  }

  private watchExit(s: ActiveSession): void {
    void s.proc.exited.then(
      (code) => {
        if (s.finalized) return;
        console.log(
          `[engine-service] session ${s.sessionId} exited with code ${code} without session_stopped`,
        );
        if (s.stopRequested) {
          this.finalize(s, { state: "STOPPED", reason: "user_stop" });
        } else if (code !== 0) {
          this.finalize(s, {
            state: "ERROR",
            reason: `engine_crash_exit_${code ?? "signal"}`,
            errorPayload: { exitCode: code },
          });
        } else {
          this.finalize(s, { state: "STOPPED", reason: "exit_without_summary" });
        }
      },
      (err) => {
        console.error("[engine-service] engine exit watcher failed:", err);
        if (!s.finalized)
          this.finalize(s, {
            state: "ERROR",
            reason: "engine_exit_watch_failed",
          });
      },
    );
  }

  private handleLine(s: ActiveSession, rawLine: string): void {
    if (s.finalized) return;
    const line = parseEngineLine(rawLine);
    if (!line) {
      console.log(
        `[engine-service] skipping unparsable engine line (stream ${s.streamId}): ${rawLine.slice(0, 200)}`,
      );
      return;
    }
    switch (line.type) {
      case "ready":
        console.log(
          `[engine-service] session ${s.sessionId}: engine ready`,
        );
        break;
      case "session_started":
        this.transition(s, "RUNNING");
        break;
      case "state": {
        const st = line.state;
        if (st === "RUNNING" || st === "DEGRADED") this.transition(s, st, line.reason);
        else
          console.log(
            `[engine-service] session ${s.sessionId}: ignored state '${String(st)}'`,
          );
        break;
      }
      case "frame":
        this.handleFrame(s, line);
        break;
      case "metrics":
        this.handleMetrics(s, line);
        break;
      case "event":
        this.handleEvent(s, line.ev);
        break;
      case "session_stopped":
        this.finalize(s, {
          state: "STOPPED",
          reason:
            typeof line.reason === "string" && line.reason.length > 0
              ? line.reason
              : "stopped",
          summary: line.summary,
        });
        break;
      case "error":
        this.finalize(s, {
          state: "ERROR",
          reason:
            typeof line.message === "string" && line.message.length > 0
              ? `engine_error: ${line.message}`
              : "engine_error",
          errorPayload: {
            message: line.message ?? null,
            code: line.code ?? null,
          },
        });
        break;
      case "settings_applied":
      case "pong":
        console.log(
          `[engine-service] session ${s.sessionId}: ${line.type}`,
        );
        break;
      default:
        console.log(
          `[engine-service] session ${s.sessionId}: unknown line type '${String((line as { type: string }).type)}'`,
        );
    }
  }

  private transition(
    s: ActiveSession,
    state: "RUNNING" | "DEGRADED",
    reason?: string,
  ): void {
    s.state = state;
    this.stmts.updateSessionState.run(state, s.sessionId);
    if (state === "RUNNING") this.setStreamStatus(s.streamId, "RUNNING");
    console.log(
      `[engine-service] session ${s.sessionId} -> ${state}${reason ? ` (${reason})` : ""}`,
    );
    this.broadcast(s, "session", {
      streamId: s.streamId,
      sessionId: s.sessionId,
      state,
      reason: reason ?? null,
      startedAt: s.startedAt,
    });
    for (const w of s.transitionWaiters.splice(0)) w(state);
  }

  private handleFrame(
    s: ActiveSession,
    line: {
      frameIndex?: number;
      ts?: number;
      latencyMs?: number;
      objects?: EngineObject[];
      detections?: EngineDetection[];
    },
  ): void {
    const ts = num(line.ts, Date.now());
    const frameIndex = num(line.frameIndex, 0);
    const detections = Array.isArray(line.detections) ? line.detections : [];
    const objects = Array.isArray(line.objects) ? line.objects : [];
    for (const d of detections) {
      if (typeof d.label !== "string") continue;
      s.detectionBuffer.push({
        sessionId: s.sessionId,
        streamId: s.streamId,
        frameIndex,
        ts: isoNow(ts),
        label: d.label,
        confidence: num(d.conf, 0),
        trackId: num(d.trackId, 0),
        x: num(d.x, 0),
        y: num(d.y, 0),
        w: num(d.w, 0),
        h: num(d.h, 0),
      });
    }
    this.broadcast(s, "frame", {
      streamId: s.streamId,
      sessionId: s.sessionId,
      frameIndex,
      ts,
      latencyMs: num(line.latencyMs, 0),
      objects,
      detections,
    });
  }

  private handleMetrics(
    s: ActiveSession,
    line: {
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
    },
  ): void {
    s.metricsSeen++;
    const lat = line.latency ?? {};
    const payload = {
      ts: num(line.ts, Date.now()),
      sourceFps: num(line.sourceFps, 0),
      processedFps: num(line.processedFps, 0),
      latency: {
        avgMs: num(lat.avgMs, 0),
        minMs: num(lat.minMs, 0),
        maxMs: num(lat.maxMs, 0),
        p50Ms: num(lat.p50Ms, 0),
        p95Ms: num(lat.p95Ms, 0),
      },
      queueDepth: num(line.queueDepth, 0),
      queueCapacity: num(line.queueCapacity, 0),
      droppedTotal: num(line.droppedTotal, 0),
      cpuPercent: num(line.cpuPercent, 0),
      memoryMb: num(line.memoryMb, 0),
      framesProcessed: num(line.framesProcessed, 0),
      detectionsTotal: num(line.detectionsTotal, 0),
      uptimeMs: num(line.uptimeMs, 0),
    };
    this.broadcast(s, "metrics", {
      streamId: s.streamId,
      sessionId: s.sessionId,
      ...payload,
    });
    if (s.metricsSeen % Math.max(1, this.settings.metricsPersistEvery) === 0) {
      this.stmts.insertMetric.run(
        s.sessionId,
        s.streamId,
        isoNow(payload.ts),
        payload.sourceFps,
        payload.processedFps,
        payload.latency.avgMs,
        payload.latency.minMs,
        payload.latency.maxMs,
        payload.latency.p50Ms,
        payload.latency.p95Ms,
        Math.trunc(payload.queueDepth),
        Math.trunc(payload.droppedTotal),
        payload.cpuPercent,
        payload.memoryMb,
        Math.trunc(payload.framesProcessed),
        Math.trunc(payload.detectionsTotal),
      );
    }
    s.framesProcessed = payload.framesProcessed;
    s.detectionsTotal = payload.detectionsTotal;
    this.stmts.updateSessionCounters.run(
      s.framesProcessed,
      s.detectionsTotal,
      s.sessionId,
    );
  }

  private handleEvent(
    s: ActiveSession,
    ev: { type?: string; ts?: number; trackId?: number; label?: string; payload?: Record<string, unknown> } | undefined,
  ): void {
    if (!ev || typeof ev.type !== "string") {
      console.log(
        `[engine-service] session ${s.sessionId}: malformed event line skipped`,
      );
      return;
    }
    if (ev.type === "SESSION_END") return; // persisted from session_stopped
    const ts = num(ev.ts, Date.now());
    this.stmts.insertEvent.run(
      s.sessionId,
      s.streamId,
      ev.type,
      ev.trackId ?? null,
      ev.label ?? null,
      JSON.stringify(ev.payload ?? {}),
      isoNow(ts),
      isoNow(),
    );
    this.stmts.bumpEventsTotal.run(s.sessionId);
    this.broadcast(s, "event", {
      streamId: s.streamId,
      sessionId: s.sessionId,
      ...ev,
    });
  }

  private flushDetections(s: ActiveSession): void {
    if (s.detectionBuffer.length === 0) return;
    const rows = s.detectionBuffer.splice(0, s.detectionBuffer.length);
    try {
      this.insertDetectionsTx(rows);
    } catch (err) {
      console.error(
        `[engine-service] detection batch insert failed (${rows.length} rows):`,
        err,
      );
    }
  }

  private finalize(
    s: ActiveSession,
    opts: {
      state: "STOPPED" | "ERROR";
      reason: string;
      summary?: Partial<EngineSessionSummary>;
      errorPayload?: Record<string, unknown>;
    },
  ): void {
    if (s.finalized) return;
    s.finalized = true;
    clearInterval(s.flushTimer);
    this.flushDetections(s);

    const current = this.stmts.getSession.get(s.sessionId) as
      | Record<string, unknown>
      | null;
    const summary = opts.summary ?? {};
    const framesProcessed = num(
      summary.framesProcessed,
      num(current?.frames_processed, s.framesProcessed),
    );
    const framesDropped = num(summary.framesDropped, num(current?.frames_dropped, 0));
    const detectionsTotal = num(
      summary.detectionsTotal,
      num(current?.detections_total, s.detectionsTotal),
    );
    const eventsTotal = num(summary.eventsTotal, num(current?.events_total, 0));
    const endedAt = isoNow();

    this.stmts.finalizeSession.run(
      opts.state,
      opts.reason,
      endedAt,
      Math.trunc(framesProcessed),
      Math.trunc(framesDropped),
      Math.trunc(detectionsTotal),
      Math.trunc(eventsTotal),
      s.sessionId,
    );
    this.setStreamStatus(s.streamId, opts.state === "ERROR" ? "ERROR" : "IDLE");

    // Terminal event: SESSION_END for normal stops, ERROR for failures.
    const terminalType = opts.state === "ERROR" ? "ERROR" : "SESSION_END";
    const terminalPayload =
      opts.state === "ERROR"
        ? { reason: opts.reason, ...(opts.errorPayload ?? {}) }
        : {
            reason: opts.reason,
            framesProcessed,
            framesDropped,
            detectionsTotal,
            eventsTotal,
            uptimeMs: num(summary.uptimeMs, 0),
          };
    this.stmts.insertEvent.run(
      s.sessionId,
      s.streamId,
      terminalType,
      null,
      null,
      JSON.stringify(terminalPayload),
      endedAt,
      isoNow(),
    );
    this.stmts.bumpEventsTotal.run(s.sessionId);

    console.log(
      `[engine-service] session ${s.sessionId} finalized: ${opts.state} (${opts.reason}) — frames=${framesProcessed} detections=${detectionsTotal} events=${eventsTotal}`,
    );
    this.broadcast(s, "session", {
      streamId: s.streamId,
      sessionId: s.sessionId,
      state: opts.state,
      reason: opts.reason,
      endedAt,
    });
    this.broadcast(s, "event", {
      streamId: s.streamId,
      sessionId: s.sessionId,
      type: terminalType,
      ts: Date.parse(endedAt),
      payload: terminalPayload,
    });

    this.sessions.delete(s.streamId);
    for (const w of s.transitionWaiters.splice(0)) w(opts.state);
  }
}

/**
 * Read a stream line-by-line, invoking `onLine` for every non-empty line.
 * Reading continuously prevents the child's stdout pipe from filling up.
 */
async function pumpLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim().length > 0) onLine(line.replace(/\r$/, ""));
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) onLine(buffer.replace(/\r$/, ""));
  } catch (err) {
    console.error("[engine-service] stdout/stderr pump failed:", err);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* stream already closed */
    }
  }
}
