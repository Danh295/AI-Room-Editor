import type { NextFunction, Request, Response } from 'express';

/**
 * A token bucket in front of the AI routes.
 *
 * Even single-user this matters: one stuck retry loop against a free Gemini
 * key burns the day's quota in a minute, and the first you know about it is
 * every lookup failing until tomorrow. A bucket lets a burst of genuine work
 * through — ingesting five products in a row is normal — while capping the
 * sustained rate at something a human could plausibly ask for.
 */
export interface RateLimitOptions {
  /** Most requests allowed back to back. */
  burst: number;
  /** Tokens added per minute once the burst is spent. */
  perMinute: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export function rateLimit({ burst, perMinute }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const perMs = perMinute / 60_000;

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Keyed by caller so a future multi-client setup doesn't share one bucket;
    // on a local single-user app this is always the same key.
    const key = req.ip ?? 'local';
    const now = Date.now();

    const bucket = buckets.get(key) ?? { tokens: burst, lastRefill: now };
    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.lastRefill) * perMs);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const waitMs = Math.ceil((1 - bucket.tokens) / perMs);
      buckets.set(key, bucket);
      res.set('retry-after', String(Math.ceil(waitMs / 1000)));
      res.status(429).json({
        error: `Too many AI requests in a row. Try again in ${Math.ceil(waitMs / 1000)}s.`,
        kind: 'quota',
      });
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    next();
  };
}
