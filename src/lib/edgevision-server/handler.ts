// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

import { internalError } from "./errors";
import { clientIp, consumeMutationToken } from "./ratelimit";
import { rateLimited } from "./errors";

/** Route context shape (Next.js 15+/16: params is a Promise). */
export interface RouteCtx<P extends Record<string, string> = Record<string, string>> {
  params: Promise<P>;
}

/**
 * Wrap a route handler so unexpected exceptions become a clean 500
 * «خطای داخلی سرور» — stack traces never reach the client.
 */
export function withApi<P extends Record<string, string> = Record<string, string>>(
  handler: (req: Request, ctx: RouteCtx<P>) => Promise<Response>,
): (req: Request, ctx: RouteCtx<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      console.error("[api] unhandled route error:", err);
      return internalError();
    }
  };
}

/**
 * Enforce the mutation rate limit (60/min per IP). Returns a 429 response
 * when exceeded, otherwise null.
 */
export function mutationGuard(req: Request): Response | null {
  if (!consumeMutationToken(clientIp(req))) {
    return rateLimited();
  }
  return null;
}
