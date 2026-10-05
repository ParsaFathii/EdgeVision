// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withApi } from "@/lib/edgevision-server/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/detections/labels — distinct labels with counts
 * (optional streamId/sessionId filters).
 */
export const GET = withApi(async (req) => {
  const q = new URL(req.url).searchParams;
  const where: Prisma.DetectionWhereInput = {};
  const streamId = q.get("streamId");
  if (streamId) where.streamId = streamId;
  const sessionId = q.get("sessionId");
  if (sessionId) where.sessionId = sessionId;

  const grouped = await db.detection.groupBy({
    by: ["label"],
    where,
    _count: { _all: true },
  });
  const items = grouped
    .map((g) => ({ label: g.label, count: g._count._all }))
    .sort((a, b) => b.count - a.count);
  return NextResponse.json(items);
});
