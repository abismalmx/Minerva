/**
 * The auth surface a self-hosted deployment uses.
 *
 * The app's auth code talks to a Supabase-shaped client (`signInWithPassword`,
 * `signUp`, `getSession`, `onAuthStateChange`, `signOut`, `refreshSession`). A
 * self-hosted deployment has no GoTrue, so this module provides the same
 * surface on top of the `minerva-sync` Worker's `/api/auth/*` routes.
 *
 * Only the methods the app actually calls are implemented. The ones it does
 * not — OAuth providers, magic links, password recovery by email — are not
 * available on a self-hosted backend (there is no mail server and no OAuth
 * provider), so the auth page hides them when
 * {@link isSelfHostedBackend} is on.
 */

import {
  isSelfHostedBackend,
  selfHostedLogin,
  selfHostedMe,
  selfHostedRegister,
  selfHostedUpdateEmail,
  type SelfHostedSession,
  type SelfHostedUser,
} from '@/services/selfhostedBackend';

export type AuthStateChangeEvent =
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'USER_UPDATED'
  | 'INITIAL_SESSION'
  | 'TOKEN_REFRESHED';

type AuthStateChangeCallback = (
  event: AuthStateChangeEvent,
  session: SelfHostedSession | null,
) => void;

interface Subscription {
  subscription: { unsubscribe: () => void };
}

/** The error shape the app reads (`{ error }` from supabase-js). */
export interface AuthError {
  message: string;
}

/** The claim set a self-hosted token carries. */
export interface SelfHostedClaims {
  /** The account id. */
  sub: string;
  email: string;
  role: 'authenticated';
}

interface AuthResult {
  data: { user: SelfHostedUser | null; session: SelfHostedSession | null };
  error: AuthError | null;
}

const ok = (session: SelfHostedSession): AuthResult => ({
  data: { user: session.user, session },
  error: null,
});

const fail = (message: string): AuthResult => ({
  data: { user: null, session: null },
  error: { message },
});

/** Read the stored session from localStorage (the app's own storage). */
const readStoredSession = (): SelfHostedSession | null => {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem('token');
  const userJson = window.localStorage.getItem('user');
  if (!token || !userJson) return null;
  try {
    const user = JSON.parse(userJson) as SelfHostedUser;
    return { access_token: token, refresh_token: token, user };
  } catch {
    return null;
  }
};

/**
 * The self-hosted auth client.
 *
 * Mirrors the part of `supabase.auth` the app uses. The session lives in
 * localStorage under the same `token` / `user` keys the app already reads, so
 * `getAccessToken` and `getUserID` keep working unchanged.
 */
class SelfHostedAuth {
  private listeners = new Set<AuthStateChangeCallback>();
  private currentSession: SelfHostedSession | null = null;

  constructor() {
    this.currentSession = readStoredSession();
  }

  /** Sign in with an email and a passphrase. */
  async signInWithPassword({
    email,
    password,
  }: {
    email: string;
    password: string;
  }): Promise<AuthResult> {
    try {
      const session = await selfHostedLogin(email, password);
      this.currentSession = session;
      this.emit('SIGNED_IN', session);
      return ok(session);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Sign in failed');
    }
  }

  /** Create an account and sign in. */
  async signUp({ email, password }: { email: string; password: string }): Promise<AuthResult> {
    try {
      const session = await selfHostedRegister(email, password);
      this.currentSession = session;
      this.emit('SIGNED_IN', session);
      return ok(session);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Sign up failed');
    }
  }

  /** The current session, read from storage. */
  async getSession(): Promise<{
    data: { session: SelfHostedSession | null };
    error: AuthError | null;
  }> {
    return { data: { session: this.currentSession }, error: null };
  }

  /** The signed-in user, verified against the server when a token is held. */
  async getUser(): Promise<{ data: { user: SelfHostedUser | null }; error: AuthError | null }> {
    const session = this.currentSession;
    if (!session) return { data: { user: null }, error: null };
    try {
      const user = await selfHostedMe(session.access_token);
      return { data: { user }, error: null };
    } catch (error) {
      // A rejected token means the session is no longer valid; drop it so the
      // app falls back to the signed-out state instead of retrying forever.
      this.currentSession = null;
      return {
        data: { user: null },
        error: { message: error instanceof Error ? error.message : 'Session expired' },
      };
    }
  }

  /** Subscribe to session changes. */
  onAuthStateChange(callback: AuthStateChangeCallback): Subscription {
    this.listeners.add(callback);
    return {
      subscription: {
        unsubscribe: () => {
          this.listeners.delete(callback);
        },
      },
    };
  }

  /**
   * Adopt an externally obtained session.
   *
   * A self-hosted deployment has no OAuth redirect, so this only ever runs
   * with a token the app already holds — it verifies the token and stores it.
   */
  async setSession({
    access_token,
    refresh_token,
  }: {
    access_token: string;
    refresh_token: string;
  }): Promise<{
    data: { user: SelfHostedUser | null; session: SelfHostedSession | null };
    error: AuthError | null;
  }> {
    try {
      const user = await selfHostedMe(access_token);
      const session: SelfHostedSession = {
        access_token,
        refresh_token: refresh_token || access_token,
        user,
      };
      this.currentSession = session;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('token', access_token);
        window.localStorage.setItem('refresh_token', refresh_token || access_token);
        window.localStorage.setItem('user', JSON.stringify(user));
      }
      this.emit('SIGNED_IN', session);
      return { data: { user, session }, error: null };
    } catch (error) {
      return {
        data: { user: null, session: null },
        error: { message: error instanceof Error ? error.message : 'Invalid session' },
      };
    }
  }

  /**
   * Change the account email.
   *
   * A self-hosted deployment has no mail server, so the address is changed
   * directly and the account keeps working with the new one.
   *
   * The passphrase travels with the request: the Worker re-validates it
   * before rewriting the identity, so a stolen session token on its own is
   * not enough to re-point the account at an address somebody else owns.
   */
  async updateUser({
    email,
    password,
  }: {
    email?: string;
    password?: string;
  }): Promise<{ data: { user: SelfHostedUser | null }; error: AuthError | null }> {
    const session = this.currentSession;
    if (!session || !email) {
      return { data: { user: null }, error: { message: 'Not authenticated' } };
    }
    if (!password) {
      return {
        data: { user: null },
        error: { message: 'Your passphrase is required to change the account email' },
      };
    }
    try {
      await selfHostedUpdateEmail(session.access_token, email, password);
      const user: SelfHostedUser = { id: session.user.id, email };
      this.currentSession = { ...session, user };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('user', JSON.stringify(user));
      }
      this.emit('USER_UPDATED', this.currentSession);
      return { data: { user }, error: null };
    } catch (error) {
      return {
        data: { user: null },
        error: { message: error instanceof Error ? error.message : 'Failed to update email' },
      };
    }
  }

  /**
   * Send a magic link.
   *
   * Not available on a self-hosted deployment: there is no mail server. The
   * auth page hides the option, so this is only reached by an old build.
   */
  async signInWithOtp(): Promise<{ data: { user: null; session: null }; error: AuthError | null }> {
    return {
      data: { user: null, session: null },
      error: { message: 'Magic links are not available on this server' },
    };
  }

  /**
   * Send a password-reset email.
   *
   * Not available on a self-hosted deployment: there is no mail server. The
   * auth page hides the option, so this is only reached by an old build.
   */
  async resetPasswordForEmail(): Promise<{ data: {}; error: AuthError | null }> {
    return {
      data: {},
      error: { message: 'Password recovery is not available on this server' },
    };
  }

  /**
   * Verify a bearer token and return its claims.
   *
   * A self-hosted token is an HS256 JWT signed by the Worker's secret, which
   * the client does not hold — so the token is verified by asking the
   * backend. The server answers with the same claim set the app reads from a
   * Supabase token (`sub`, `email`, `role`, …), so the caller's code does not
   * change.
   */
  async getClaims(token: string): Promise<{
    data: { claims: SelfHostedClaims | null };
    error: AuthError | null;
  }> {
    try {
      const user = await selfHostedMe(token);
      const claims: SelfHostedClaims = {
        sub: user.id,
        email: user.email,
        role: 'authenticated',
      };
      return { data: { claims }, error: null };
    } catch (error) {
      return {
        data: { claims: null },
        error: { message: error instanceof Error ? error.message : 'Invalid token' },
      };
    }
  }

  /** Sign out and forget the stored session. */
  async signOut(): Promise<{ error: AuthError | null }> {
    this.currentSession = null;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('refresh_token');
      window.localStorage.removeItem('user');
    }
    this.emit('SIGNED_OUT', null);
    return { error: null };
  }

  /**
   * Refresh the session.
   *
   * A self-hosted session IS the token, and it is valid until it expires —
   * there is no refresh token to exchange. The method therefore just
   * re-verifies the stored session.
   */
  async refreshSession(): Promise<{
    data: { session: SelfHostedSession | null };
    error: AuthError | null;
  }> {
    const session = this.currentSession;
    if (!session) return { data: { session: null }, error: null };
    try {
      const user = await selfHostedMe(session.access_token);
      const refreshed: SelfHostedSession = { ...session, user };
      this.currentSession = refreshed;
      return { data: { session: refreshed }, error: null };
    } catch {
      this.currentSession = null;
      return { data: { session: null }, error: { message: 'Session expired' } };
    }
  }

  private emit(event: AuthStateChangeEvent, session: SelfHostedSession | null): void {
    for (const listener of this.listeners) {
      try {
        listener(event, session);
      } catch (error) {
        console.error('self-hosted auth listener failed', error);
      }
    }
  }
}

let selfHostedAuthClient: SelfHostedAuth | null = null;

/** The self-hosted auth client (created lazily). */
export const getSelfHostedAuth = (): SelfHostedAuth => {
  if (!selfHostedAuthClient) selfHostedAuthClient = new SelfHostedAuth();
  return selfHostedAuthClient;
};

/**
 * Whether the deployment has no OAuth provider and no mail server, so the
 * auth page must hide those options.
 */
export const selfHostedAuthHasNoExternalProviders = (): boolean => isSelfHostedBackend();
