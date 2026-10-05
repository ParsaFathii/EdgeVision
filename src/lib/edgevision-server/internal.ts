// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

/**
 * Client for the engine-service internal HTTP API (port 3003). All Next.js
 * mutations are forwarded here; reads go through Prisma directly.
 */

const BASE_URL =
  process.env.EV_ENGINE_SERVICE_URL ?? "http://127.0.0.1:3003";
const TOKEN = process.env.EV_INTERNAL_TOKEN ?? "edgevision-local";

export interface InternalResponse {
  /** true iff the service answered with a 2xx status. */
  ok: boolean;
  /** HTTP status code (503 when the service is unreachable/timed out). */
  status: number;
  /** Parsed JSON body (error envelope when not ok). */
  data: Record<string, unknown>;
}

/**
 * Fetch an /internal/* route with the internal token and a hard timeout.
 * Never throws: network errors/timeouts resolve to a 503 envelope.
 */
export async function internalFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = 5000,
): Promise<InternalResponse> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        "x-internal-token": TOKEN,
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 503,
      data: {
        code: "ENGINE_DOWN",
        message: "سرویس پردازش در دسترس نیست",
      },
    };
  }
}

/**
 * JSON mutation helper: serialises the body and forwards it with the given
 * method to the internal API.
 */
export async function internalJson(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  timeoutMs = 5000,
): Promise<InternalResponse> {
  return internalFetch(
    path,
    {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
  );
}
