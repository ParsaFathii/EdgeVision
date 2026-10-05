// EdgeVision — engine orchestration service
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import { isoNow, openDatabase, startRetentionSweeper } from "./db";
import { loadSettings } from "./settings";
import { seedModels } from "./seed";
import { SessionManager, engineBinaryExists } from "./sessions";
import { createInternalHandler } from "./http";

const PORT = 3003;

function log(...args: unknown[]): void {
  console.log("[engine-service]", ...args);
}

// --- boot: database, settings, seeds, retention ---
const db = openDatabase();
const settings = loadSettings();
seedModels(db);
const retentionTimer = startRetentionSweeper(db);
log(`database open (WAL): ${db.filename ?? "custom.db"}`);

// Reconcile phantom sessions left behind by a crash/hot-reload: no child
// process is tracking them anymore, so mark them honestly as ERROR.
{
  const stale = db
    .prepare(
      "SELECT id, stream_id FROM sessions WHERE state IN ('STARTING','RUNNING','DEGRADED')",
    )
    .all() as Array<{ id: string; stream_id: string }>;
  for (const s of stale) {
    db.prepare(
      "UPDATE sessions SET state = 'ERROR', reason = 'service_restarted', ended_at = ? WHERE id = ?",
    ).run(isoNow(), s.id);
    db.prepare("UPDATE streams SET status = 'ERROR', updated_at = ? WHERE id = ?").run(
      isoNow(),
      s.stream_id,
    );
    log(`reconciled phantom session ${s.id} (stream ${s.stream_id}) -> ERROR/service_restarted`);
  }
}

// --- HTTP server ---
// The /internal/* handler is attached to the node:http server BEFORE
// socket.io attaches. Because socket.io MUST use path "/" (Caddy gateway
// contract), engine.io's prefix match claims every URL on this port, so we
// additionally re-order the request listeners AFTER io attaches: /internal/*
// goes to our handler, everything else goes to the io dispatcher.
let internalHandler: (req: IncomingMessage, res: ServerResponse) => void = (
  _req,
  res,
) => {
  res.statusCode = 503;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({ code: "BOOTING", message: "سرویس در حال راه‌اندازی است" }),
  );
};

const httpServer = createServer((req, res) => internalHandler(req, res));

const io = new Server(httpServer, {
  // DO NOT change the path — the Caddy gateway forwards on it.
  path: "/",
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const manager = new SessionManager(db, io, settings);
internalHandler = createInternalHandler({ db, manager, settings });

// Reclaim /internal/* from engine.io's catch-all "/" prefix match while
// preserving the io dispatcher (and its saved fallthrough listeners) for
// every other request.
const ioDispatcher = httpServer.listeners("request")[0] as (
  req: IncomingMessage,
  res: ServerResponse,
) => void;
httpServer.removeAllListeners("request");
httpServer.on("request", (req, res) => {
  const path = (req.url ?? "").split("?")[0];
  if (path.startsWith("/internal/")) {
    internalHandler(req, res);
  } else {
    ioDispatcher.call(httpServer, req, res);
  }
});

// --- realtime socket.io surface ---
io.on("connection", (socket) => {
  log(`socket connected: ${socket.id}`);
  socket.emit("hello", {
    version: "1.0.0",
    engineBinary: engineBinaryExists(),
    activeSessions: manager.snapshot(),
  });

  socket.on("subscribe", (data: unknown) => {
    const streams =
      typeof data === "object" && data !== null && Array.isArray((data as { streams?: unknown }).streams)
        ? (data as { streams: unknown[] }).streams
        : [];
    for (const s of streams) {
      if (typeof s === "string" && s.length > 0) {
        socket.join(`stream:${s}`);
        log(`socket ${socket.id} subscribed to stream ${s}`);
      }
    }
  });

  socket.on("unsubscribe", (data: unknown) => {
    const streams =
      typeof data === "object" && data !== null && Array.isArray((data as { streams?: unknown }).streams)
        ? (data as { streams: unknown[] }).streams
        : [];
    for (const s of streams) {
      if (typeof s === "string" && s.length > 0) {
        socket.leave(`stream:${s}`);
        log(`socket ${socket.id} unsubscribed from stream ${s}`);
      }
    }
  });

  socket.on("ping", (data: unknown, cb?: unknown) => {
    if (typeof cb === "function") cb({ ts: Date.now() });
    socket.emit("pong", { ts: Date.now(), echo: data ?? null });
  });

  socket.on("disconnect", (reason) => {
    log(`socket disconnected: ${socket.id} (${reason})`);
  });

  socket.on("error", (err) => {
    console.error(`[engine-service] socket error (${socket.id}):`, err);
  });
});

// --- graceful shutdown ---
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal}, shutting down...`);
  const forceTimer = setTimeout(() => {
    console.error("[engine-service] graceful shutdown timed out, exiting");
    process.exit(0);
  }, 15000);
  try {
    await manager.shutdownAll();
  } catch (err) {
    console.error("[engine-service] error during session shutdown:", err);
  }
  clearInterval(retentionTimer);
  try {
    db.close();
  } catch (err) {
    console.error("[engine-service] db close failed:", err);
  }
  clearTimeout(forceTimer);
  io.close(() => process.exit(0));
  httpServer.close(() => process.exit(0));
  // Absolute fallback so shutdown never hangs.
  const fallback = setTimeout(() => process.exit(0), 3000);
  if (typeof fallback.unref === "function") fallback.unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

httpServer.listen(PORT, () => {
  log(`listening on port ${PORT} (internal API + socket.io at path "/")`);
  log(
    engineBinaryExists()
      ? "engine binary present"
      : "engine binary MISSING (engine-cpp/build/edgevision-engine) — start/stop returns 503 until it is built",
  );
});
