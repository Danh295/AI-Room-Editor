import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit } from './rateLimit.js';

function fakeResponse(): Response & { statusCode?: number; body?: unknown } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    set: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown };
}

const req = { ip: '127.0.0.1' } as Request;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('rateLimit', () => {
  it('lets a burst through', () => {
    const limiter = rateLimit({ burst: 3, perMinute: 6 });
    const next = vi.fn() as unknown as NextFunction;

    for (let i = 0; i < 3; i += 1) limiter(req, fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('answers 429 once the burst is spent', () => {
    const limiter = rateLimit({ burst: 2, perMinute: 6 });
    const next = vi.fn() as unknown as NextFunction;

    limiter(req, fakeResponse(), next);
    limiter(req, fakeResponse(), next);

    const blocked = fakeResponse();
    limiter(req, blocked, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toMatchObject({ kind: 'quota' });
  });

  it('refills over time', () => {
    const limiter = rateLimit({ burst: 1, perMinute: 60 }); // one per second
    const next = vi.fn() as unknown as NextFunction;

    limiter(req, fakeResponse(), next);
    limiter(req, fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_100);
    limiter(req, fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('never banks more than the burst', () => {
    const limiter = rateLimit({ burst: 2, perMinute: 60 });
    const next = vi.fn() as unknown as NextFunction;

    // Idle for a minute: the bucket should cap at 2, not hold 60.
    vi.advanceTimersByTime(60_000);
    for (let i = 0; i < 4; i += 1) limiter(req, fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
