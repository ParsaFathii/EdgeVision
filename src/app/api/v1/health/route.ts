// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { internalFetch } from "@/lib/edgevision-server/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/health — aggregate DB + engine-service health. */
export async function GET() {
  let dbOk = false;
  try {
    await db.stream.count();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const engine = await internalFetch("/internal/health", undefined, 2500);
  const engineOk = engine.ok && engine.data.ok !== false;
  return NextResponse.json({
    status: dbOk && engineOk ? "ok" : "degraded",
    db: dbOk,
    engine: engineOk,
    engineBinary: engineOk ? engine.data.engineBinary === true : false,
    activeSessions: engineOk ? Number(engine.data.activeSessions ?? 0) : 0,
    version: "1.0.0",
    uptimeSec: Math.floor(process.uptime()),
  });
}
