// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import type { NextResponse } from "next/server";
import { badRequest, bodyTooLarge, type ApiErrorBody } from "./errors";

const MAX_BYTES = 1024 * 1024; // 1MB

export type BodyResult =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse<ApiErrorBody> };

/**
 * Read and parse a JSON request body defensively: rejects bodies larger
 * than 1MB (413) and invalid JSON (400).
 */
export async function readJsonBody(req: Request): Promise<BodyResult> {
  const declared = req.headers.get("content-length");
  if (declared && Number(declared) > MAX_BYTES) {
    return { ok: false, response: bodyTooLarge() };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: badRequest(["خواندن بدنه درخواست ناموفق بود"]) };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    return { ok: false, response: bodyTooLarge() };
  }
  if (text.trim().length === 0) return { ok: true, data: {} };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: badRequest(["بدنه درخواست باید JSON معتبر باشد"]),
    };
  }
}
