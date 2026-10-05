// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/edgevision-server/errors";
import { withApi } from "@/lib/edgevision-server/handler";
import { parseTimeParam } from "@/lib/edgevision-server/schemas";
import { dirSql, eqCond, timeConds, whereSql } from "@/lib/edgevision-server/sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Detection row shape returned by the raw query (DATETIME → Date). */
interface DetectionRow {
  id: number;
  sessionId: string;
  streamId: string;
  frameIndex: number;
  ts: Date;
  label: string;
  confidence: number;
  trackId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * GET /api/v1/detections — filterable, paginated detection rows.
 * Query: streamId, sessionId, label, minConfidence, trackId, from, to,
 * page (default 1), pageSize (default 25, max 200), sort=ts|confidence,
 * order=asc|desc. Time filters compare ISO text (see lib/edgevision-server/sql).
 */
export const GET = withApi(async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams;

  const conds: Prisma.Sql[] = [];
  const streamId = q.get("streamId");
  if (streamId) conds.push(eqCond("stream_id", streamId));
  const sessionId = q.get("sessionId");
  if (sessionId) conds.push(eqCond("session_id", sessionId));
  const label = q.get("label");
  if (label) conds.push(eqCond("label", label));
  const trackIdRaw = q.get("trackId");
  if (trackIdRaw !== null && trackIdRaw.trim() !== "") {
    const trackId = Number(trackIdRaw);
    if (!Number.isInteger(trackId))
      return badRequest(["شناسه مسیر (trackId) باید عدد صحیح باشد"]);
    conds.push(eqCond("track_id", trackId));
  }
  const minConfRaw = q.get("minConfidence");
  if (minConfRaw !== null && minConfRaw.trim() !== "") {
    const minConf = Number(minConfRaw);
    if (!Number.isFinite(minConf))
      return badRequest(["حداقل اطمینان باید عدد باشد"]);
    conds.push(Prisma.sql`confidence >= ${minConf}`);
  }

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
  conds.push(...timeConds("ts", from, to));

  const page = Math.max(1, Number(q.get("page") ?? 1) || 1);
  let pageSize = Number(q.get("pageSize") ?? 25) || 25;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 25;
  pageSize = Math.min(200, Math.max(1, Math.trunc(pageSize)));

  const sort = q.get("sort") === "confidence" ? "confidence" : "ts";
  const asc = q.get("order") === "asc";
  const orderBy =
    sort === "confidence"
      ? Prisma.sql`ORDER BY confidence ${dirSql(asc)}, id ${dirSql(asc)}`
      : Prisma.sql`ORDER BY ts ${dirSql(asc)}, id ${dirSql(asc)}`;

  const where = whereSql(conds);

  const [rows, countRows] = await Promise.all([
    db.$queryRaw<DetectionRow[]>(Prisma.sql`
      SELECT id, session_id AS "sessionId", stream_id AS "streamId",
             frame_index AS "frameIndex", ts, label, confidence,
             track_id AS "trackId", x, y, w, h
      FROM detections
      ${where}
      ${orderBy}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.$queryRaw<{ total: bigint | number }[]>(Prisma.sql`
      SELECT COUNT(*) AS total FROM detections ${where}
    `),
  ]);

  return NextResponse.json({
    items: rows,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  });
});
