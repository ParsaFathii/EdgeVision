// EdgeVision — engine orchestration service
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Resolve the SQLite database path robustly from the module location:
 * <project>/mini-services/engine-service/db.ts -> <project>/db/custom.db
 * (env DATABASE_URL of the form file:/abs/path wins if present).
 */
export function resolveDbPath(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl && envUrl.startsWith("file:")) {
    const p = envUrl.slice("file:".length);
    if (p && p.startsWith("/")) return p;
  }
  return resolve(import.meta.dir, "..", "..", "db", "custom.db");
}

/**
 * Open the SQLite database in WAL mode with a busy timeout so the
 * Next.js/Prisma reader process can coexist with this writer process.
 */
export function openDatabase(): Database {
  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  return db;
}

/**
 * Boot-time schema guard: the service writes with raw SQL and expects the
 * tables that `bun run db:push` (Prisma) creates. Starting before that step
 * used to fail deep inside seeding with a cryptic error — here it fails fast,
 * in Persian, with the exact command to run next.
 */
export function ensureSchema(db: Database): void {
  const required = ["streams", "sessions", "detections", "events", "metrics", "models"];
  const found = new Set(
    (
      db
        .query("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name),
  );
  const missing = required.filter((t) => !found.has(t));
  if (missing.length > 0) {
    console.error(
      "[engine-service] جدول‌های لازم در دیتابیس یافت نشد:",
      missing.join(", "),
    );
    console.error(
      "[engine-service] ابتدا در ریشهٔ مخزن دستور «bun run db:push» را اجرا کنید و سپس سرویس را دوباره راه‌اندازی کنید.",
    );
    process.exit(1);
  }
}

/** ISO-8601 UTC timestamp for an epoch-ms value (or now). */
export function isoNow(ms?: number): string {
  return new Date(ms ?? Date.now()).toISOString();
}

export const RETENTION = {
  metricsMaxAgeMs: 24 * 60 * 60 * 1000, // 24h
  detectionsCap: 100_000,
  eventsCap: 20_000,
  sweepIntervalMs: 5 * 60 * 1000, // 5 min
} as const;

/**
 * Run one retention sweep: drop metrics older than 24h and trim detections
 * (100k) / events (20k) to their caps by deleting the oldest overflow rows.
 * Executed inside a single transaction; returns honest row counts.
 */
export function sweepRetentionPolicy(db: Database): {
  metricsDeleted: number;
  detectionsDeleted: number;
  eventsDeleted: number;
} {
  const cutoff = isoNow(Date.now() - RETENTION.metricsMaxAgeMs);
  const run = db.transaction(() => {
    const m = db
      .prepare("DELETE FROM metrics WHERE ts < ?")
      .run(cutoff).changes;
    const d = db
      .prepare(
        "DELETE FROM detections WHERE id IN (SELECT id FROM detections ORDER BY id DESC LIMIT -1 OFFSET ?)",
      )
      .run(RETENTION.detectionsCap).changes;
    const e = db
      .prepare(
        "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id DESC LIMIT -1 OFFSET ?)",
      )
      .run(RETENTION.eventsCap).changes;
    return { metricsDeleted: m, detectionsDeleted: d, eventsDeleted: e };
  });
  return run();
}

/** Start the periodic retention sweeper (every 5 minutes). */
export function startRetentionSweeper(db: Database): Timer {
  const timer = setInterval(() => {
    try {
      const r = sweepRetentionPolicy(db);
      if (r.metricsDeleted || r.detectionsDeleted || r.eventsDeleted) {
        console.log(
          `[engine-service] retention sweep: -${r.metricsDeleted} metrics, -${r.detectionsDeleted} detections, -${r.eventsDeleted} events`,
        );
      }
    } catch (err) {
      console.error("[engine-service] retention sweep failed:", err);
    }
  }, RETENTION.sweepIntervalMs);
  return timer;
}
