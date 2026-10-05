// EdgeVision — server API layer
// Copyright © 2026 Parsa Fathi — Apache-2.0

/**
 * In-memory token-bucket rate limiter for mutating requests
 * (60 mutations/minute per client IP).
 */

const CAPACITY = 60;
const REFILL_PER_MS = 60 / 60_000; // 1 token per second => 60/min

interface Bucket {
  tokens: number;
  last: number;
}

const globalForLimiter = globalThis as unknown as {
  __evRateBuckets?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> =
  globalForLimiter.__evRateBuckets ?? new Map();
globalForLimiter.__evRateBuckets = buckets;

/** Best-effort client IP extraction (behind the Caddy gateway). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}

/**
 * Consume one mutation token for the IP. Returns false when the bucket is
 * empty (caller should answer 429).
 */
export function consumeMutationToken(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket) {
    if (buckets.size > 4096) buckets.clear();
    buckets.set(ip, { tokens: CAPACITY - 1, last: now });
    return true;
  }
  const elapsed = now - bucket.last;
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_MS);
  bucket.last = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}
