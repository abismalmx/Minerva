import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@/services/runtimeConfig';
import { decodeBase64, PUBLIC_DEFAULTS } from '@/services/publicDefaults';

const supabaseUrl =
  getRuntimeConfig()?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
  decodeBase64(
    process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64'] || PUBLIC_DEFAULTS.supabaseUrlBase64,
  );
const supabaseAnonKey =
  getRuntimeConfig()?.supabaseAnonKey ||
  process.env['SUPABASE_ANON_KEY'] ||
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ||
  decodeBase64(
    process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64'] || PUBLIC_DEFAULTS.supabaseAnonKeyBase64,
  );

// supabase-js persists the session under a key derived from the URL's first
// host label. Minerva Cloud keeps the key from its original host so moving the
// client to another of its hosts doesn't sign everyone out.
const MINERVA_CLOUD_HOSTS = [
  'readest.supabase.co',
  'vbsyxfusjjqdxkjqlysc.supabase.co',
  'auth.readest.com',
];

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  MINERVA_CLOUD_HOSTS.includes(new URL(supabaseUrl).hostname)
    ? { auth: { storageKey: 'sb-readest-auth-token' } }
    : undefined,
);

export const createSupabaseClient = (accessToken?: string) => {
  return createClient(supabaseUrl, supabaseAnonKey, {
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
  return createClient(supabaseUrl, supabaseAdminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
