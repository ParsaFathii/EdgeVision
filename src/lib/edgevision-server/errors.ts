// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { NextResponse } from "next/server";
import type { InternalResponse } from "./internal";

/** Canonical error envelope shared by every /api/v1 route. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Build a JSON error response (messages are Persian, codes are English). */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: details === undefined ? { code, message } : { code, message, details } },
    { status },
  );
}

/** 400 — validation failure. */
export function badRequest(details?: unknown): NextResponse<ApiErrorBody> {
  return apiError(400, "VALIDATION", "داده‌های ورودی نامعتبر است", details);
}

/** 404 — resource not found. */
export function notFound(): NextResponse<ApiErrorBody> {
  return apiError(404, "NOT_FOUND", "موردی یافت نشد");
}

/** 429 — mutation rate limit exceeded. */
export function rateLimited(): NextResponse<ApiErrorBody> {
  return apiError(429, "RATE_LIMIT", "درخواست‌های بیش از حد مجاز؛ کمی صبر کنید");
}

/** 413 — request body too large. */
export function bodyTooLarge(): NextResponse<ApiErrorBody> {
  return apiError(413, "BODY_TOO_LARGE", "حجم درخواست بیش از حد مجاز است");
}

/** 503 — engine-service unreachable. */
export function engineDown(): NextResponse<ApiErrorBody> {
  return apiError(503, "ENGINE_DOWN", "سرویس پردازش در دسترس نیست");
}

/** 500 — catch-all (never leaks stack traces). */
export function internalError(): NextResponse<ApiErrorBody> {
  return apiError(500, "INTERNAL", "خطای داخلی سرور");
}

/**
 * Re-emit an engine-service error response through the Next.js error
 * envelope, preserving its status and Persian message. Internal 400s map
 * to the canonical VALIDATION code.
 */
export function forwardInternalError(res: InternalResponse): NextResponse<ApiErrorBody> {
  if (res.status === 400) {
    const details = Array.isArray(res.data.details) ? res.data.details : undefined;
    const message =
      typeof res.data.message === "string"
        ? res.data.message
        : "داده‌های ورودی نامعتبر است";
    return apiError(400, "VALIDATION", message, details);
  }
  const code =
    typeof res.data.code === "string" ? res.data.code : "ENGINE_ERROR";
  const message =
    typeof res.data.message === "string"
      ? res.data.message
      : "سرویس پردازش درخواست را نپذیرفت";
  const details = Array.isArray(res.data.details) ? res.data.details : undefined;
  return apiError(res.status, code, message, details);
}
