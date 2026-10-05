// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { internalJson } from "@/lib/edgevision-server/internal";
import { forwardInternalError } from "@/lib/edgevision-server/errors";
import { mutationGuard, withApi, type RouteCtx } from "@/lib/edgevision-server/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/streams/:id/stop — stop the active session (graceful). */
export const POST = withApi<{ id: string }>(async (req, ctx) => {
  const { id } = await ctx.params;
  const limited = mutationGuard(req);
  if (limited) return limited;

  // stop waits for graceful engine shutdown (up to ~7s escalation)
  const res = await internalJson(
    `/internal/streams/${encodeURIComponent(id)}/stop`,
    "POST",
    undefined,
    15_000,
  );
  if (!res.ok) return forwardInternalError(res);
  const session = res.data.session ?? null;
  return NextResponse.json({ session });
});
