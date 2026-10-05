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

/** Session row shape returned by the raw query (DATETIME → Date). */
interface SessionRow {
  id: string;
  streamId: string;
  state: string;
  reason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  framesProcessed: number;
  framesDropped: number;
  detectionsTotal: number;
  eventsTotal: number;
}

/**
 * GET /api/v1/sessions — paginated session history.
 * Query: streamId, state, from, to (applied to startedAt), page, pageSize.
 * Time filters compare ISO text (see lib/edgevision-server/sql).
 */
export const GET = withApi(async (req) => {
  const q = new URL(req.url).searchParams;

  const conds: Prisma.Sql[] = [];
  const streamId = q.get("streamId");
  if (streamId) conds.push(eqCond("stream_id", streamId));
  const state = q.get("state");
  if (state) conds.push(eqCond("state", state));

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
  conds.push(...timeConds("started_at", from, to));

  const page = Math.max(1, Number(q.get("page") ?? 1) || 1);
  let pageSize = Number(q.get("pageSize") ?? 25) || 25;
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 25;
  pageSize = Math.min(200, Math.max(1, Math.trunc(pageSize)));

  const where = whereSql(conds);

  const [rows, countRows] = await Promise.all([
    db.$queryRaw<SessionRow[]>(Prisma.sql`
      SELECT id, stream_id AS "streamId", state, reason,
             started_at AS "startedAt", ended_at AS "endedAt",
             frames_processed AS "framesProcessed",
             frames_dropped AS "framesDropped",
             detections_total AS "detectionsTotal",
             events_total AS "eventsTotal"
      FROM sessions
      ${where}
      ORDER BY started_at DESC, id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.$queryRaw<{ total: bigint | number }[]>(Prisma.sql`
      SELECT COUNT(*) AS total FROM sessions ${where}
    `),
  ]);

  return NextResponse.json({
    items: rows,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  });
});
