// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { internalJson } from "@/lib/edgevision-server/internal";
import { badRequest, forwardInternalError, notFound } from "@/lib/edgevision-server/errors";
import { mutationGuard, withApi, type RouteCtx } from "@/lib/edgevision-server/handler";
import { readJsonBody } from "@/lib/edgevision-server/bodyguard";
import { streamPatchSchema, zodDetails } from "@/lib/edgevision-server/schemas";
import { activeSessionFor } from "@/lib/edgevision-server/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/streams/:id — stream + active session + latest metric. */
export const GET = withApi<{ id: string }>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const stream = await db.stream.findUnique({ where: { id } });
  if (!stream) return notFound();
  const [activeSession, latestMetric] = await Promise.all([
    activeSessionFor(id),
    db.metric.findFirst({ where: { streamId: id }, orderBy: { ts: "desc" } }),
  ]);
  return NextResponse.json({ ...stream, activeSession, latestMetric });
});

/** PATCH /api/v1/streams/:id — validate, forward, read back. */
export const PATCH = withApi<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const limited = mutationGuard(req);
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = streamPatchSchema.safeParse(body.data);
  if (!parsed.success) return badRequest(zodDetails(parsed.error, body.data));

  const res = await internalJson(`/internal/streams/${encodeURIComponent(id)}`, "PATCH", parsed.data);
  if (!res.ok) return forwardInternalError(res);

  const stream = await db.stream.findUnique({ where: { id } });
  if (!stream) return notFound();
  return NextResponse.json({ ...stream, activeSession: null });
});

/** DELETE /api/v1/streams/:id — forward (cascade handled by the service). */
export const DELETE = withApi<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const limited = mutationGuard(req);
  if (limited) return limited;

  const res = await internalJson(`/internal/streams/${encodeURIComponent(id)}`, "DELETE");
  if (!res.ok) return forwardInternalError(res);
  return NextResponse.json({ ok: true });
});
