/**
 * The auth client the app uses.
 *
 * A self-hosted deployment has no GoTrue, so it authenticates against its own
 * Worker (`apps/minerva-app/workers/minerva-sync`) instead. The surface is
 * deliberately the same as Supabase's, so `AuthContext` and the auth pages
 * need no branching of their own.
 *
 * This lives in its OWN module — not in `@/utils/supabase` — so that it
 * resolves through whatever `@/utils/supabase` exports. The unit tests mock
 * that module to substitute a fake client; keeping the accessor separate means
 * the mock is honoured instead of being shadowed by a direct import.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import { isSelfHostedBackend } from '@/services/selfhostedBackend';
import { getSelfHostedAuth } from '@/services/selfhostedAuth';

/**
 * The auth client for the current deployment.
 *
 * The cast is safe because {@link getSelfHostedAuth} implements the same
 * methods the app calls on `supabase.auth`; the two differ only in where the
 * session lives and how it is verified.
 */
export const authClient = (): SupabaseClient['auth'] =>
  isSelfHostedBackend()
    ? (getSelfHostedAuth() as unknown as SupabaseClient['auth'])
    : supabase.auth;

/**
 * A Supabase-shaped client whose `auth` is the selected backend's.
 *
 * The auth page injects the client into the form components as a prop — the
 * seam the unit tests use to substitute a fake. Building the client here
 * keeps that seam intact while still letting a self-hosted deployment swap
 * the account layer out.
 */
export const authSupabaseClient = (): SupabaseClient =>
  ({ ...supabase, auth: authClient() }) as SupabaseClient;
