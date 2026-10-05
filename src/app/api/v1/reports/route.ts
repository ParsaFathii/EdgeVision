// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/edgevision-server/errors";
import { withApi } from "@/lib/edgevision-server/handler";
import { parseTimeParam } from "@/lib/edgevision-server/schemas";
import { eqCond, timeConds, whereSql } from "@/lib/edgevision-server/sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV cell escaping (RFC 4180). */
function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface CountRow {
  count: bigint | number;
}

interface LabelRow {
  label: string;
  count: bigint | number;
}

interface TypeRow {
  type: string;
  count: bigint | number;
}

interface TrackRow {
  trackId: number;
  label: string;
  count: bigint | number;
}

interface MetricAggRow {
  samples: bigint | number;
  avgSourceFps: number | null;
  avgProcessedFps: number | null;
  avgLatencyMs: number | null;
  avgCpuPercent: number | null;
  avgMemoryMb: number | null;
  maxQueueDepth: bigint | number | null;
}

/** $queryRaw maps DATETIME columns to Date objects; normalise to ISO text. */
function isoOf(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

interface DetectionCsvRow {
  ts: Date | string;
  streamId: string;
  sessionId: string;
  frameIndex: number | bigint;
  trackId: number | bigint;
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * GET /api/v1/reports — analytics report over retained data.
 * Query: streamId, from, to, format=json|csv (default json).
 * CSV = full detections table with UTF-8 BOM. All time filters compare
 * ISO text via raw SQL (see lib/edgevision-server/sql).
 */
export const GET = withApi(async (req) => {
  const q = new URL(req.url).searchParams;

  const format = q.get("format") ?? "json";
  if (format !== "json" && format !== "csv") {
    return badRequest(["فرمت گزارش باید json یا csv باشد"]);
  }

  const streamId = q.get("streamId");
  let from: Date | null = null;
  let to: Date | null = null;
  for (const [name, target] of [
    ["from", "from"],
    ["to", "to"],
  ] as const) {
    const parsed = parseTimeParam(q.get(name));
    if (parsed === "invalid")
      return badRequest([`پارامتر ${name} باید تاریخ ISO یا میلی‌ثانیه باشد`]);
    if (parsed) {
      if (target === "from") from = parsed;
      else to = parsed;
    }
  }

  // Shared condition builders per table (stream filter + time range).
  const streamCond = (col: string): Prisma.Sql[] =>
    streamId ? [eqCond(col, streamId)] : [];
  const detectionConds = [
    ...streamCond("stream_id"),
    ...timeConds("ts", from, to),
  ];
  const eventConds = [
    ...streamCond("stream_id"),
    ...timeConds("ts", from, to),
  ];
  const sessionConds = [
    ...streamCond("stream_id"),
    ...timeConds("started_at", from, to),
  ];
  const metricConds = [
    ...streamCond("stream_id"),
    ...timeConds("ts", from, to),
  ];

  if (format === "csv") {
    const rows = await db.$queryRaw<DetectionCsvRow[]>(Prisma.sql`
      SELECT ts, stream_id AS "streamId", session_id AS "sessionId",
             frame_index AS "frameIndex", track_id AS "trackId", label,
             confidence, x, y, w, h
      FROM detections
      ${whereSql(detectionConds)}
      ORDER BY ts ASC, id ASC
    `);
    const header =
      "ts,streamId,sessionId,frameIndex,trackId,label,confidence,x,y,w,h";
    const lines = rows.map((r) =>
      [
        isoOf(r.ts),
        r.streamId,
        r.sessionId,
        r.frameIndex,
        r.trackId,
        r.label,
        r.confidence,
        r.x,
        r.y,
        r.w,
        r.h,
      ]
        .map(csvEscape)
        .join(","),
    );
    const csv = `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="edgevision-report.csv"',
      },
    });
  }

  const streams = await db.stream.findMany({
    where: streamId ? { id: streamId } : undefined,
    orderBy: { createdAt: "asc" },
  });

  const [
    sessionsCountRows,
    detectionsByLabelRows,
    eventsByTypeRows,
    metricAggRows,
    topTrackRows,
  ] = await Promise.all([
    db.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS count FROM sessions ${whereSql(sessionConds)}`),
    db.$queryRaw<LabelRow[]>(Prisma.sql`
      SELECT label, COUNT(*) AS count FROM detections
      ${whereSql(detectionConds)} GROUP BY label ORDER BY count DESC`),
    db.$queryRaw<TypeRow[]>(Prisma.sql`
      SELECT type, COUNT(*) AS count FROM events
      ${whereSql(eventConds)} GROUP BY type ORDER BY count DESC`),
    db.$queryRaw<MetricAggRow[]>(Prisma.sql`
      SELECT COUNT(*) AS samples,
             AVG(source_fps) AS avgSourceFps,
             AVG(processed_fps) AS avgProcessedFps,
             AVG(latency_avg_ms) AS avgLatencyMs,
             AVG(cpu_percent) AS avgCpuPercent,
             AVG(memory_mb) AS avgMemoryMb,
             MAX(queue_depth) AS maxQueueDepth
      FROM metrics ${whereSql(metricConds)}`),
    db.$queryRaw<TrackRow[]>(Prisma.sql`
      SELECT track_id AS "trackId", label, COUNT(*) AS count FROM detections
      ${whereSql(detectionConds)}
      GROUP BY track_id, label ORDER BY count DESC LIMIT 10`),
  ]);

  // Per-stream summaries (small stream count; three counts each).
  const streamsSummary = await Promise.all(
    streams.map(async (s) => {
      const sidCond = [eqCond("stream_id", s.id)];
      const [sess, det, ev] = await Promise.all([
        db.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(*) AS count FROM sessions
          ${whereSql([...sidCond, ...timeConds("started_at", from, to)])}`),
        db.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(*) AS count FROM detections
          ${whereSql([...sidCond, ...timeConds("ts", from, to)])}`),
        db.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(*) AS count FROM events
          ${whereSql([...sidCond, ...timeConds("ts", from, to)])}`),
      ]);
      return {
        streamId: s.id,
        name: s.name,
        sessions: Number(sess[0]?.count ?? 0),
        detections: Number(det[0]?.count ?? 0),
        events: Number(ev[0]?.count ?? 0),
      };
    }),
  );

  const agg = metricAggRows[0];
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    streamsSummary,
    sessionsCount: Number(sessionsCountRows[0]?.count ?? 0),
    detectionsByLabel: detectionsByLabelRows.map((r) => ({
      label: r.label,
      count: Number(r.count),
    })),
    eventsByType: eventsByTypeRows.map((r) => ({
      type: r.type,
      count: Number(r.count),
    })),
    metricsAverages: {
      avgSourceFps: agg?.avgSourceFps ?? 0,
      avgProcessedFps: agg?.avgProcessedFps ?? 0,
      avgLatencyMs: agg?.avgLatencyMs ?? 0,
      avgCpuPercent: agg?.avgCpuPercent ?? 0,
      avgMemoryMb: agg?.avgMemoryMb ?? 0,
      maxQueueDepth: Number(agg?.maxQueueDepth ?? 0),
      samples: Number(agg?.samples ?? 0),
    },
    topTracks: topTrackRows.map((r) => ({
      trackId: r.trackId,
      label: r.label,
      count: Number(r.count),
    })),
  });
});
