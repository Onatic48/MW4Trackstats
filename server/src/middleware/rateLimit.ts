import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface IpRateLimiter {
  checkAndConsume(ip: string, nowMs?: number): RateLimitDecision;
  middleware: RequestHandler;
  clear(): void;
}

export function extractClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createIpRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
}): IpRateLimiter {
  const buckets = new Map<string, number[]>();

  function pruneOld(timestamps: number[], windowStart: number): number[] {
    let firstValid = 0;
    while (firstValid < timestamps.length && (timestamps[firstValid] ?? 0) <= windowStart) {
      firstValid += 1;
    }
    return firstValid > 0 ? timestamps.slice(firstValid) : timestamps;
  }

  function checkAndConsume(ip: string, nowMs = Date.now()): RateLimitDecision {
    const windowStart = nowMs - options.windowMs;
    const existing = pruneOld(buckets.get(ip) ?? [], windowStart);

    if (existing.length >= options.maxRequests) {
      const oldest = existing[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, oldest + options.windowMs - nowMs);
      buckets.set(ip, existing);
      return {
        allowed: false,
        limit: options.maxRequests,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    const updated = [...existing, nowMs];
    buckets.set(ip, updated);

    if (buckets.size > 5000) {
      for (const [key, list] of buckets.entries()) {
        const cleaned = pruneOld(list, windowStart);
        if (cleaned.length === 0) {
          buckets.delete(key);
        } else {
          buckets.set(key, cleaned);
        }
      }
    }

    return {
      allowed: true,
      limit: options.maxRequests,
      remaining: Math.max(0, options.maxRequests - updated.length),
      retryAfterSeconds: 0,
    };
  }

  const middleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const decision = checkAndConsume(extractClientIp(req));
    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. Try again in ${decision.retryAfterSeconds} seconds`,
          retryAfterSeconds: decision.retryAfterSeconds,
        },
      });
      return;
    }

    next();
  };

  return {
    checkAndConsume,
    middleware,
    clear: () => buckets.clear(),
  };
}
