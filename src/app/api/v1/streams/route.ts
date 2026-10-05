// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { internalJson } from "@/lib/edgevision-server/internal";
import { badRequest, forwardInternalError } from "@/lib/edgevision-server/errors";
import { mutationGuard, withApi } from "@/lib/edgevision-server/handler";
import { readJsonBody } from "@/lib/edgevision-server/bodyguard";
import { streamCreateSchema, zodDetails } from "@/lib/edgevision-server/schemas";
import { getSnapshot } from "@/lib/edgevision-server/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/streams — all streams (Prisma) with live session info. */
export const GET = withApi(async () => {
  const streams = await db.stream.findMany({ orderBy: { createdAt: "asc" } });
  const sessions = await getSnapshot();
  const byStream = new Map(sessions.map((s) => [s.streamId, s]));
  return NextResponse.json({
    items: streams.map((s) => ({
      ...s,
      activeSession: byStream.get(s.id) ?? null,
    })),
  });
});

/** POST /api/v1/streams — validate, forward to engine-service, read back. */
export const POST = withApi(async (req) => {
  const limited = mutationGuard(req);
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = streamCreateSchema.safeParse(body.data);
  if (!parsed.success) return badRequest(zodDetails(parsed.error, body.data));

  const res = await internalJson("/internal/streams", "POST", parsed.data);
  if (!res.ok) return forwardInternalError(res);

  const id = typeof res.data.id === "string" ? res.data.id : null;
  if (!id) return badRequest();
  const stream = await db.stream.findUnique({ where: { id } });
  if (!stream) return badRequest();
  return NextResponse.json({ ...stream, activeSession: null }, { status: 201 });
});
