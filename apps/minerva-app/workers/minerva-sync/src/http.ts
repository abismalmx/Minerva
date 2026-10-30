/**
 * HTTP plumbing shared by every route: CORS, JSON responses and the error
 * shape the client expects.
 *
 * The client's `fetchWithAuth` reads `{ error }` from a failed response and
 * `SyncClient` reads `{ error }` too, so every error body carries that key.
 * The replica client additionally reads `{ code }` and maps HTTP statuses onto
 * its own `SyncErrorCode` vocabulary, so the statuses used here match what it
 * expects: 401/403 → AUTH, 409 → CLOCK_SKEW, 413/422 → VALIDATION,
 * 5xx → SERVER.
 */

import type { D1Database, R2Bucket } from './types';

export interface Env {
  LIBRARY_BUCKET: R2Bucket;
  SYNC_DB: D1Database;
  /** HMAC secret for access tokens. `wrangler secret put JWT_SECRET`. */
  JWT_SECRET?: string;
  /** Comma-separated allowed browser origins; '*' allows any. */
  ALLOWED_ORIGINS?: string;
  /** Max bytes for a single upload. */
  MAX_UPLOAD_BYTES?: string;
  /**
   * The operator's own storage limit, in bytes. A self-hosted deployment has
   * no store to buy from, so the quota is whatever the operator sets here; 0
   * means "no limit configured".
   */
  STORAGE_FIXED_QUOTA?: string;
  /**
   * PBKDF2 iterations used to stretch account passphrases.
   *
   * The cost is paid on every registration and every sign-in, so a deployment
   * with a tight CPU budget can lower it; the default follows the OWASP
   * recommendation. The count is stored with each hash, so changing it never
   * invalidates the accounts that already exist.
   */
  PASSPHRASE_KDF_ITERATIONS?: string;
}

export const json = (body: unknown, status = 200, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Sync responses are per-user and per-cursor; never let a cache hold one.
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...headers,
    },
  });

export const errorJson = (message: string, status = 400, extra: Record<string, unknown> = {}) =>
  json({ error: message, ...extra }, status);

/**
 * Apply the CORS headers the browser client needs.
 *
 * The `Authorization` header is echoed explicitly rather than answered with
 * `*`: the Fetch spec excludes `Authorization` from wildcard matching, so a
 * wildcard answer forces a fresh preflight round trip before every
 * authenticated call.
 */
export const withCors = (request: Request, env: Env, response: Response): Response => {
  const origin = request.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const isAllowed = allowed.includes('*') || allowed.includes(origin);

  const headers = new Headers(response.headers);
  if (isAllowed && origin) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    request.headers.get('access-control-request-headers') || 'Authorization, Content-Type',
  );
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Vary', 'Origin, Access-Control-Request-Headers');
  return new Response(response.body, { status: response.status, headers });
};

/** Handle a CORS preflight. */
export const preflight = (request: Request, env: Env): Response =>
  withCors(request, env, new Response(null, { status: 204 }));

/** Parse a JSON body, tolerating an empty body. */
export const readJson = async <T = unknown>(request: Request): Promise<T | null> => {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/** The ISO timestamp the Worker stamps on writes. */
export const nowIso = (): string => new Date().toISOString();
