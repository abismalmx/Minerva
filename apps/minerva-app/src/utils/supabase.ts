import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@/services/runtimeConfig';

/**
 * The account layer (Minerva Cloud) is optional.
 *
 * A self-hosted deployment authenticates against its own Worker and has no
 * Supabase project, so both values resolve to an empty string and the client
 * below becomes a placeholder. Nothing here throws at import time: the app,
 * the build and the unit tests import this module unconditionally.
 */
const supabaseUrl = () =>
  getRuntimeConfig()?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
  '';

const supabaseAnonKey = () =>
  getRuntimeConfig()?.supabaseAnonKey ||
  process.env['SUPABASE_ANON_KEY'] ||
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ||
  '';

/** Whether an account layer is configured at all. */
export const isSupabaseConfigured = () => Boolean(supabaseUrl() && supabaseAnonKey());

/**
 * Placeholder origin for a deployment with no account layer. The client is
 * still built — the module has to export one — but every call against it
 * fails at once with a connection error instead of taking the process down.
 */
const NO_ACCOUNT_LAYER_URL = 'http://127.0.0.1:1';
const NO_ACCOUNT_LAYER_KEY = 'no-account-layer';

const clientUrl = supabaseUrl() || NO_ACCOUNT_LAYER_URL;
const clientKey = supabaseAnonKey() || NO_ACCOUNT_LAYER_KEY;

// Minerva Cloud keeps the key from its original host so moving the client to
// another of its hosts doesn't sign everyone out.
const MINERVA_CLOUD_HOSTS = [
  'readest.supabase.co',
  'vbsyxfusjjqdxkjqlysc.supabase.co',
  'auth.readest.com',
];

export const supabase = createClient(
  clientUrl,
  clientKey,
  MINERVA_CLOUD_HOSTS.includes(new URL(clientUrl).hostname)
    ? { auth: { storageKey: 'sb-readest-auth-token' } }
    : undefined,
);

export const createSupabaseClient = (accessToken?: string) => {
  return createClient(clientUrl, clientKey, {
    global: {
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {},
    },
  });
};

export const createSupabaseAdminClient = () => {
  const supabaseAdminKey = process.env['SUPABASE_ADMIN_KEY'] || '';
  return createClient(clientUrl, supabaseAdminKey || NO_ACCOUNT_LAYER_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
