// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { internalFetch, internalJson } from "@/lib/edgevision-server/internal";
import { badRequest, forwardInternalError, rateLimited } from "@/lib/edgevision-server/errors";
import { withApi } from "@/lib/edgevision-server/handler";
import { clientIp, consumeMutationToken } from "@/lib/edgevision-server/ratelimit";
import { readJsonBody } from "@/lib/edgevision-server/bodyguard";
import { settingsPatchSchema, zodDetails } from "@/lib/edgevision-server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/settings — proxy the engine-service settings. */
export const GET = withApi(async () => {
  const res = await internalFetch("/internal/settings");
  if (!res.ok) return forwardInternalError(res);
  return NextResponse.json(res.data);
});

/** PATCH /api/v1/settings — validate, forward, echo new settings. */
export const PATCH = withApi(async (req) => {
  if (!consumeMutationToken(clientIp(req))) return rateLimited();

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = settingsPatchSchema.safeParse(body.data);
  if (!parsed.success) return badRequest(zodDetails(parsed.error, body.data));

  const res = await internalJson("/internal/settings", "PATCH", parsed.data);
  if (!res.ok) return forwardInternalError(res);
  return NextResponse.json(res.data);
});
