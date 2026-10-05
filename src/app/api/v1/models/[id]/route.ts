// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { internalJson } from "@/lib/edgevision-server/internal";
import { badRequest, forwardInternalError, notFound } from "@/lib/edgevision-server/errors";
import { mutationGuard, withApi, type RouteCtx } from "@/lib/edgevision-server/handler";
import { readJsonBody } from "@/lib/edgevision-server/bodyguard";
import { modelActivateSchema, zodDetails } from "@/lib/edgevision-server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/v1/models/:id — activate/deactivate (single-active). */
export const PATCH = withApi<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const limited = mutationGuard(req);
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = modelActivateSchema.safeParse(body.data);
  if (!parsed.success) return badRequest(zodDetails(parsed.error, body.data));

  const res = await internalJson(
    `/internal/models/${encodeURIComponent(id)}`,
    "PATCH",
    parsed.data,
  );
  if (!res.ok) return forwardInternalError(res);

  const model = await db.model.findUnique({ where: { id } });
  if (!model) return notFound();
  return NextResponse.json(model);
});
