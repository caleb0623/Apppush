import { t, translateServerText } from '@/lib/i18n';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  [key: string]: unknown;
}

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ApiResult<T> {
  data: T;
  meta?: PageMeta;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
  }

  /** Maps server validation issues to form fields. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as FieldIssue[]).map((d) => [d.field, translateServerText(d.message)]));
  }
}

const TOKEN_KEY = 'apppush.token';
const MAX_RATE_LIMIT_WAIT_MS = 2000;

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  mayRetry = true,
): Promise<ApiResult<T>> {
  const token = tokenStorage.get();
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'The API could not be reached. Is the backend running?');
  }

  if (response.status === 204) return { data: undefined as T };

  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    meta?: PageMeta;
    error?: { code: string; message: string; details?: { retryAfterMs?: number }; requestId?: string };
  } | null;

  if (response.ok && payload) return { data: payload.data as T, ...(payload.meta ? { meta: payload.meta } : {}) };

  const error = payload?.error;
  // A page load in a testing environment can briefly meet the 10 QPS limit; wait and retry once.
  if (response.status === 429 && mayRetry) {
    await wait(Math.min(error?.details?.retryAfterMs ?? 1000, MAX_RATE_LIMIT_WAIT_MS));
    return request<T>(method, path, body, headers, false);
  }
  if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/change-password')) {
    onUnauthorized();
  }
  throw new ApiRequestError(
    response.status,
    error?.code ?? 'UNKNOWN_ERROR',
    error?.message ?? `Request failed with status ${response.status}`,
    error?.details,
    error?.requestId,
  );
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>('POST', path, body, headers),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: (path: string) => request<void>('DELETE', path),
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? translateServerText(error.message) : t('Something went wrong');

export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
