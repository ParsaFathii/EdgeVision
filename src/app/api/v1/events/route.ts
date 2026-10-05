// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest } from "@/lib/edgevision-server/errors";
import { withApi } from "@/lib/edgevision-server/handler";
import { EVENT_TYPES, parseTimeParam } from "@/lib/edgevision-server/schemas";
import { eqCond, timeConds, whereSql } from "@/lib/edgevision-server/sql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Event row (payloadJson parsed into `payload`; DATETIME → Date). */
interface EventItem {
  id: number;
  sessionId: string;
  streamId: string;
  type: string;
  trackId: number | null;
  label: string | null;
  payload: unknown;
  ts: Date;
  createdAt: Date;
}

/**
 * GET /api/v1/events — filterable, paginated events (payload parsed).
 * Query: streamId, type, from, to, page, pageSize. Time filters compare
 * ISO text (see lib/edgevision-server/sql).
 */
export const GET = withApi(async (req) => {
  const q = new URL(req.url).searchParams;

  const conds: Prisma.Sql[] = [];
  const streamId = q.get("streamId");
  if (streamId) conds.push(eqCond("stream_id", streamId));
  const type = q.get("type");
  if (type) {
    if (!(EVENT_TYPES as readonly string[]).includes(type)) {
      return badRequest([
        `نوع رویداد باید یکی از ${EVENT_TYPES.join("، ")} باشد`,
      ]);
    }
    conds.push(eqCond("type", type));
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

  const where = whereSql(conds);

  const [rows, countRows] = await Promise.all([
    db.$queryRaw<
      (Omit<EventItem, "payload"> & { payloadJson: string })[]
    >(Prisma.sql`
      SELECT id, session_id AS "sessionId", stream_id AS "streamId", type,
             track_id AS "trackId", label, payload_json AS "payloadJson",
             ts, created_at AS "createdAt"
      FROM events
      ${where}
      ORDER BY ts DESC, id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.$queryRaw<{ total: bigint | number }[]>(Prisma.sql`
      SELECT COUNT(*) AS total FROM events ${where}
    `),
  ]);

  const items: EventItem[] = rows.map((row) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch {
      payload = row.payloadJson;
    }
    return {
      id: row.id,
      sessionId: row.sessionId,
      streamId: row.streamId,
      type: row.type,
      trackId: row.trackId,
      label: row.label,
      payload,
      ts: row.ts,
      createdAt: row.createdAt,
    };
  });

  return NextResponse.json({
    items,
    total: Number(countRows[0]?.total ?? 0),
    page,
    pageSize,
  });
});
