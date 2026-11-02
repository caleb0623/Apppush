export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Sliding-window log: unlike a fixed window, it cannot admit a double burst
 * across a window boundary. Each key stores at most `limit` timestamps.
 * State is per process, which suits this single-node deployment.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    public readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): RateLimitDecision {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > windowStart);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        retryAfterMs: Math.max(oldest + this.windowMs - now, 1),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - recent.length,
      retryAfterMs: 0,
    };
  }

  reset(): void {
    this.hits.clear();
  }
}
