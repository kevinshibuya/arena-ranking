import { apiInternalUrl } from './internal-url';

/** An API answer: the body on 2xx, otherwise the status and the API's message. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/**
 * GET an API path (`/api/...`). On the server it goes straight to the API; in
 * the browser it goes through the web app's /api rewrite, so only the web
 * container needs to be reachable.
 */
export function apiGet<T>(path: string): Promise<ApiResult<T>> {
  return apiRequest('GET', path);
}

/**
 * POST an API path, as `apiGet` does. A status in `answers` carries the
 * endpoint's own body, as a 2xx does: a refused refresh answers 429 with one.
 */
export function apiPost<T>(path: string, answers: readonly number[] = []): Promise<ApiResult<T>> {
  return apiRequest('POST', path, answers);
}

async function apiRequest<T>(method: 'GET' | 'POST', path: string, answers: readonly number[] = []): Promise<ApiResult<T>> {
  const base = typeof window === 'undefined' ? apiInternalUrl() : '';
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method, cache: 'no-store', headers: { accept: 'application/json' } });
  } catch {
    return { ok: false, status: 503, message: 'The stats server did not answer.' };
  }
  if (response.ok || answers.includes(response.status)) return { ok: true, data: (await response.json()) as T };
  return { ok: false, status: response.status, message: await errorMessage(response) };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Not JSON; fall through.
  }
  return response.statusText || `HTTP ${response.status}`;
}

/** A query string from the set values, `?` included, or '' when none is set. */
export function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}
