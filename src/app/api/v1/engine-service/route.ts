// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { internalFetch } from "@/lib/edgevision-server/internal";
import { apiError } from "@/lib/edgevision-server/errors";
import { mutationGuard, withApi } from "@/lib/edgevision-server/handler";
import { readJsonBody } from "@/lib/edgevision-server/bodyguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/engine-service — ensure the engine-service mini-service
 * (port 3003) is running, spawning it detached when it is down.
 *
 * This is a sandbox ops endpoint: shell-spawned background processes are
 * reaped between agent commands, so the service is spawned as a detached
 * child of the long-lived Next.js dev-server process instead. It is guarded
 * by the same internal token as the service's /internal/* API.
 *
 * Body (optional JSON): { engineBin?: string } — absolute path to the engine
 * binary override (ENGINE_BIN) used by the test harness; must point to an
 * existing file inside /home/z/my-project. Defaults to the real engine at
 * engine-cpp/build/edgevision-engine.
 */
export const POST = withApi(async (req) => {
  const limited = mutationGuard(req);
  if (limited) return limited;

  const token = req.headers.get("x-internal-token");
  const expected = process.env.EV_INTERNAL_TOKEN ?? "edgevision-local";
  if (token !== expected) {
    return apiError(401, "UNAUTHORIZED", "توکن داخلی نامعتبر است");
  }

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const data = (body.data ?? {}) as { engineBin?: unknown };

  let engineBin: string | undefined;
  if (data.engineBin !== undefined && data.engineBin !== null) {
    if (typeof data.engineBin !== "string" || !isAbsolute(data.engineBin)) {
      return apiError(400, "VALIDATION", "مسیر موتور باید مطلق باشد");
    }
    const resolved = resolve(data.engineBin);
    const projectRoot = resolve(process.cwd());
    if (!resolved.startsWith(projectRoot)) {
      return apiError(400, "VALIDATION", "مسیر موتور باید داخل پروژه باشد");
    }
    try {
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        return apiError(400, "VALIDATION", "فایل موتور یافت نشد");
      }
    } catch {
      return apiError(400, "VALIDATION", "فایل موتور یافت نشد");
    }
    engineBin = resolved;
  }

  // Already healthy? Nothing to do.
  const before = await internalFetch("/internal/health", undefined, 1500);
  if (before.ok && before.data.ok !== false) {
    return NextResponse.json({ ok: true, spawned: false, health: before.data });
  }

  const serviceDir = resolve(process.cwd(), "mini-services", "engine-service");
  if (!existsSync(serviceDir)) {
    return apiError(500, "INTERNAL", "پوشه سرویس پردازش یافت نشد");
  }

  // Plain record so NODE_ENV can be dropped (bun-types marks it read-only).
  const env = { ...process.env } as Record<string, string | undefined>;
  if (engineBin) env.ENGINE_BIN = engineBin;
  delete env.NODE_ENV; // never inherit "production" from the server

  try {
    const child = spawn(
      "bash",
      ["-c", "exec bun run dev >> service.log 2>&1"],
      {
        cwd: serviceDir,
        detached: true,
        stdio: "ignore",
        env: env as NodeJS.ProcessEnv,
      },
    );
    child.unref();
  } catch (err) {
    console.error("[api] engine-service spawn failed:", err);
    return apiError(500, "INTERNAL", "راه‌اندازی سرویس پردازش ناموفق بود");
  }

  // Wait for the service to come up (boot opens the DB and binds :3003).
  const deadline = Date.now() + 12_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    const health = await internalFetch("/internal/health", undefined, 1500);
    if (health.ok && health.data.ok !== false) {
      return NextResponse.json({ ok: true, spawned: true, health: health.data });
    }
    if (Date.now() > deadline) break;
  }
  return apiError(503, "ENGINE_DOWN", "سرویس پردازش در زمان مجاز آماده نشد");
});
