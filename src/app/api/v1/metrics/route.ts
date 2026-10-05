// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/edgevision-server/errors";
import { withApi } from "@/lib/edgevision-server/handler";
import { parseTimeParam } from "@/lib/edgevision-server/schemas";
import { getSnapshot } from "@/lib/edgevision-server/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKETS = { "1s": 1, "5s": 5, "30s": 30, "1m": 60 } as const;
type BucketKey = keyof typeof BUCKETS;

interface BucketRow {
  bucketSec: bigint | number;
  samples: bigint | number;
  avgSourceFps: number | null;
  avgProcessedFps: number | null;
  avgLatencyMs: number | null;
  maxQueueDepth: bigint | number | null;
  avgDropped: number | null;
  avgCpuPercent: number | null;
  avgMemoryMb: number | null;
}

interface SummaryRow {
  samples: bigint | number;
  avgSourceFps: number | null;
  avgProcessedFps: number | null;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  maxQueueDepth: bigint | number | null;
  maxDropped: bigint | number | null;
  avgCpuPercent: number | null;
  avgMemoryMb: number | null;
  maxFramesProcessed: bigint | number | null;
  maxDetections: bigint | number | null;
}

/**
 * GET /api/v1/metrics — time-bucketed metric aggregation (SQLite strftime
 * bucketing over the ISO ts strings) plus an overall summary.
 * Query: streamId, sessionId, from, to, bucket=1s|5s|30s|1m (default 30s).
 * With ?live=1: latest Metric row per active session instead.
 */
export const GET = withApi(async (req) => {
  const q = new URL(req.url).searchParams;

  const streamId = q.get("streamId");
  const sessionId = q.get("sessionId");

  if (q.get("live") === "1") {
    const sessions = await getSnapshot(true);
    const items = await Promise.all(
      sessions.map(async (s) => ({
        ...s,
        metric: await db.metric.findFirst({
          where: { sessionId: s.sessionId },
          orderBy: { ts: "desc" },
        }),
      })),
    );
    return NextResponse.json({ live: true, sessions: items });
  }

  const bucketRaw = q.get("bucket") ?? "30s";
  if (!(bucketRaw in BUCKETS)) {
    return badRequest(["بازه‌بندی باید یکی از 1s، 5s، 30s یا 1m باشد"]);
  }
  const bucketKey = bucketRaw as BucketKey;
  const bucketSec = BUCKETS[bucketKey];

  const conds: Prisma.Sql[] = [Prisma.sql`1=1`];
  if (streamId) conds.push(Prisma.sql`stream_id = ${streamId}`);
  if (sessionId) conds.push(Prisma.sql`session_id = ${sessionId}`);
  for (const [name, op] of [
    ["from", ">="],
    ["to", "<="],
  ] as const) {
    const parsed = parseTimeParam(q.get(name));
    if (parsed === "invalid")
      return badRequest([`پارامتر ${name} باید تاریخ ISO یا میلی‌ثانیه باشد`]);
    if (parsed)
      conds.push(
        op === ">="
          ? Prisma.sql`ts >= ${parsed.toISOString()}`
          : Prisma.sql`ts <= ${parsed.toISOString()}`,
      );
  }
  const whereSql = Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;

  const [bucketRows, summaryRows] = await Promise.all([
    db.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT
        (CAST(strftime('%s', ts) AS INTEGER) / CAST(${bucketSec} AS INTEGER))
          * CAST(${bucketSec} AS INTEGER) AS bucketSec,
        COUNT(*) AS samples,
        AVG(source_fps) AS avgSourceFps,
        AVG(processed_fps) AS avgProcessedFps,
        AVG(latency_avg_ms) AS avgLatencyMs,
        MAX(queue_depth) AS maxQueueDepth,
        AVG(dropped_total) AS avgDropped,
        AVG(cpu_percent) AS avgCpuPercent,
        AVG(memory_mb) AS avgMemoryMb
      FROM metrics
      ${whereSql}
      GROUP BY bucketSec
      ORDER BY bucketSec ASC
    `),
    db.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        COUNT(*) AS samples,
        AVG(source_fps) AS avgSourceFps,
        AVG(processed_fps) AS avgProcessedFps,
        AVG(latency_avg_ms) AS avgLatencyMs,
        MIN(latency_min_ms) AS minLatencyMs,
        MAX(latency_max_ms) AS maxLatencyMs,
        MAX(queue_depth) AS maxQueueDepth,
        MAX(dropped_total) AS maxDropped,
        AVG(cpu_percent) AS avgCpuPercent,
        AVG(memory_mb) AS avgMemoryMb,
        MAX(frames_processed) AS maxFramesProcessed,
        MAX(detections_total) AS maxDetections
      FROM metrics
      ${whereSql}
    `),
  ]);

  const summary = summaryRows[0];
  return NextResponse.json({
    bucket: bucketKey,
    buckets: bucketRows.map((r) => ({
      ts: Number(r.bucketSec) * 1000, // bucket start, epoch ms
      samples: Number(r.samples),
      avgSourceFps: r.avgSourceFps ?? 0,
      avgProcessedFps: r.avgProcessedFps ?? 0,
      avgLatencyMs: r.avgLatencyMs ?? 0,
      maxQueueDepth: Number(r.maxQueueDepth ?? 0),
      avgDropped: r.avgDropped ?? 0,
      avgCpuPercent: r.avgCpuPercent ?? 0,
      avgMemoryMb: r.avgMemoryMb ?? 0,
    })),
    summary: {
      samples: Number(summary?.samples ?? 0),
      avgSourceFps: summary?.avgSourceFps ?? 0,
      avgProcessedFps: summary?.avgProcessedFps ?? 0,
      avgLatencyMs: summary?.avgLatencyMs ?? 0,
      minLatencyMs: summary?.minLatencyMs ?? 0,
      maxLatencyMs: summary?.maxLatencyMs ?? 0,
      maxQueueDepth: Number(summary?.maxQueueDepth ?? 0),
      maxDropped: Number(summary?.maxDropped ?? 0),
      avgCpuPercent: summary?.avgCpuPercent ?? 0,
      avgMemoryMb: summary?.avgMemoryMb ?? 0,
      maxFramesProcessed: Number(summary?.maxFramesProcessed ?? 0),
      maxDetections: Number(summary?.maxDetections ?? 0),
    },
  });
});
