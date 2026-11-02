import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../../src/lib/rate-limiter.js';

const setup = (limit = 10) => {
  const time = { now: 1_000_000 };
  return { time, limiter: new SlidingWindowRateLimiter(limit, 1000, () => time.now) };
};

describe('SlidingWindowRateLimiter', () => {
  it('allows the limit and rejects the next request', () => {
    const { limiter } = setup();
    for (let i = 0; i < 10; i += 1) expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('a')).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('counts down the remaining quota', () => {
    const { limiter } = setup(3);
    expect(limiter.consume('a').remaining).toBe(2);
    expect(limiter.consume('a').remaining).toBe(1);
    expect(limiter.consume('a').remaining).toBe(0);
  });

  it('tracks keys independently', () => {
    const { limiter } = setup(1);
    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('b').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(false);
  });

  it('allows requests again once the window has passed', () => {
    const { limiter, time } = setup(1);
    limiter.consume('a');
    time.now += 1000;
    expect(limiter.consume('a').allowed).toBe(true);
  });

  it('prevents the double burst a fixed window would allow', () => {
    const { limiter, time } = setup(10);
    time.now += 900;
    for (let i = 0; i < 10; i += 1) limiter.consume('a');
    time.now += 200; // Inside a new fixed window, but only 200 ms later.
    expect(limiter.consume('a').allowed).toBe(false);
  });

  it('reports how long to wait', () => {
    const { limiter, time } = setup(1);
    limiter.consume('a');
    time.now += 400;
    expect(limiter.consume('a').retryAfterMs).toBe(600);
  });

  it('does not count rejected requests against the window', () => {
    const { limiter, time } = setup(1);
    limiter.consume('a');
    for (let i = 0; i < 50; i += 1) limiter.consume('a');
    time.now += 1000;
    expect(limiter.consume('a').allowed).toBe(true);
  });
});
