// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { internalJson } from "@/lib/edgevision-server/internal";
import { badRequest, forwardInternalError } from "@/lib/edgevision-server/errors";
import { mutationGuard, withApi } from "@/lib/edgevision-server/handler";
import { readJsonBody } from "@/lib/edgevision-server/bodyguard";
import { modelCreateSchema, zodDetails } from "@/lib/edgevision-server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/models — the model registry (Prisma read). */
export const GET = withApi(async () => {
  const items = await db.model.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ items });
});

/** POST /api/v1/models — register a model (forwarded to the service). */
export const POST = withApi(async (req) => {
  const limited = mutationGuard(req);
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = modelCreateSchema.safeParse(body.data);
  if (!parsed.success) return badRequest(zodDetails(parsed.error, body.data));

  const res = await internalJson("/internal/models", "POST", parsed.data);
  if (!res.ok) return forwardInternalError(res);

  const id = typeof res.data.id === "string" ? res.data.id : null;
  if (!id) return badRequest();
  const model = await db.model.findUnique({ where: { id } });
  if (!model) return badRequest();
  return NextResponse.json(model, { status: 201 });
});
