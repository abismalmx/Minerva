/**
 * The self-hosted backend adapter.
 *
 * A self-hosted deployment points `API_BASE_URL` at its own Worker
 * (apps/minerva-app/workers/minerva-sync) instead of the hosted Minerva Cloud.
 * That Worker serves the SAME API the app already speaks — `/api/sync`,
 * `/api/sync/replicas`, `/api/storage/*` — so the sync, storage and replica
 * clients need no change at all.
 *
 * What DOES change is the account: the hosted backend authenticates against
 * Supabase GoTrue, and a self-hosted deployment has no identity provider. This
 * module provides the small auth surface the app uses (`signInWithPassword`,
 * `signUp`, `getSession`, `signOut`, …) on top of the Worker's own
 * `/api/auth/*` routes, so `AuthContext` and the auth pages keep working
 * unchanged.
 *
 * The adapter is selected by {@link isSelfHostedBackend}, which reads the
 * runtime config's `selfHostedBackend` flag. A deployment that does not set
 * it keeps using Supabase exactly as before.
 */

import { getRuntimeConfig } from '@/services/runtimeConfig';
import { getAPIBaseUrl, getCustomBackendUrl } from '@/services/environment';

export interface SelfHostedUser {
  id: string;
  email: string;
  username?: string;
}

export interface SelfHostedSession {
  access_token: string;
  refresh_token: string;
  user: SelfHostedUser;
}

/**
 * Whether the app talks to a self-hosted backend rather than Minerva Cloud.
 *
 * The flag is separate from `selfHosted` (which unlocks the premium features):
 * a Docker deployment that still points at the hosted backend must keep using
 * Supabase, and a deployment that points at its own Worker must not try to
 * reach Supabase at all.
 */
export const isSelfHostedBackend = (): boolean => {
  if (getCustomBackendUrl()) return true;
  const config = getRuntimeConfig();
  if (config?.selfHostedBackend !== undefined) return config.selfHostedBackend;
  const raw = process.env['SELF_HOSTED_BACKEND'] ?? process.env['NEXT_PUBLIC_SELF_HOSTED_BACKEND'];
  return raw === 'true';
};

/** The base URL of the self-hosted API (without the trailing `/api`). */
const apiBase = (): string => getAPIBaseUrl();

interface AuthResponse {
  token?: string;
  user?: SelfHostedUser;
  error?: string;
}

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      (body as AuthResponse | null)?.error || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
};

/** Register a new account. */
export const selfHostedRegister = async (
  emailOrUsername: string,
  passphrase: string,
): Promise<SelfHostedSession> => {
  const isEmail = emailOrUsername.includes('@');
  const payload = isEmail
    ? { email: emailOrUsername, passphrase }
    : { username: emailOrUsername, passphrase };
  const body = await request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!body.token || !body.user) throw new Error('The server did not return an account');
  return { access_token: body.token, refresh_token: body.token, user: body.user };
};

/** Sign in with an existing account. */
export const selfHostedLogin = async (
  emailOrUsername: string,
  passphrase: string,
): Promise<SelfHostedSession> => {
  const isEmail = emailOrUsername.includes('@');
  const payload = isEmail
    ? { email: emailOrUsername, passphrase }
    : { username: emailOrUsername, passphrase };
  const body = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!body.token || !body.user) throw new Error('The server did not return a session');
  return { access_token: body.token, refresh_token: body.token, user: body.user };
};

/** Read the signed-in account back from the server. */
export const selfHostedMe = async (token: string): Promise<SelfHostedUser> => {
  const body = await request<{ user: SelfHostedUser }>('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return body.user;
};

/**
 * Verify a bearer token and return its claims.
 *
 * The Worker's `/api/auth/me` route answers the account behind the token, so
 * the client never needs the signing secret to check a token.
 */
export const selfHostedClaims = async (
  token: string,
): Promise<{ sub: string; email: string; role: 'authenticated' }> => {
  const user = await selfHostedMe(token);
  return { sub: user.id, email: user.email, role: 'authenticated' };
};

/**
 * Change the account email.
 *
 * The passphrase is the proof that the caller owns the account: the Worker
 * re-validates it before it rewrites the identity (a session token alone is
 * not enough — it lives in `localStorage` for 30 days and can be stolen by
 * an extension, an XSS or a shared machine).
 */
export const selfHostedUpdateEmail = async (
  token: string,
  email: string,
  passphrase: string,
): Promise<void> => {
  await request('/auth/email', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, passphrase }),
  });
};

/** Remove the account and everything it owns. */
export const selfHostedDeleteAccount = async (token: string): Promise<void> => {
  await request('/user/delete', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
};
