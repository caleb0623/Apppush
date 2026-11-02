import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, query, setUnauthorizedHandler, tokenStorage } from '@/api/client';

const respond = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), { status });

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    tokenStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends the bearer token and unwraps data and meta', async () => {
    tokenStorage.set('abc');
    fetchMock.mockResolvedValue(respond(200, { data: [1], meta: { total: 1 } }));
    const result = await api.get('/apps');
    expect(result).toMatchObject({ data: [1], meta: { total: 1 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/apps');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });

  it('turns API errors into typed errors with field details', async () => {
    fetchMock.mockResolvedValue(
      respond(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: [{ field: 'title', message: 'Title is required' }],
          requestId: 'r1',
        },
      }),
    );
    const error = await api.post('/x', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'r1' });
    expect((error as ApiRequestError).fieldErrors).toEqual({ title: 'Title is required' });
  });

  it('explains when the backend cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(api.get('/apps')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('handles an empty 204 response', async () => {
    fetchMock.mockResolvedValue(respond(204, null));
    await expect(api.delete('/x')).resolves.toEqual({ data: undefined });
  });

  it('retries once after a rate limit, then gives up', async () => {
    vi.useFakeTimers();
    const limited = () =>
      respond(429, { error: { code: 'RATE_LIMITED', message: 'Slow down', details: { retryAfterMs: 100 } } });
    fetchMock.mockImplementation(() => Promise.resolve(limited()));
    const pending = api.get('/x').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers when the retry succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(respond(429, { error: { code: 'RATE_LIMITED', message: 'x', details: { retryAfterMs: 50 } } }))
      .mockResolvedValueOnce(respond(200, { data: 'ok' }));
    const pending = api.get('/x');
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toEqual({ data: 'ok' });
  });

  it('signals an expired session, but not for a failed login', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockImplementation(() =>
      Promise.resolve(respond(401, { error: { code: 'INVALID_TOKEN', message: 'x' } })),
    );
    await api.get('/apps').catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    await api.post('/auth/login', {}).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('builds query strings without empty values', () => {
    expect(query({ a: 1, b: '', c: null, d: undefined, e: 'x y' })).toBe('?a=1&e=x+y');
    expect(query({})).toBe('');
  });
});
