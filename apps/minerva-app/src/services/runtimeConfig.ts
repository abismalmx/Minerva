export interface MinervaRuntimeConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
  objectStorageType?: string;
  storageFixedQuota?: number;
  translationFixedQuota?: number;
  fontBaseUrl?: string;
  selfHosted?: boolean;
  /**
   * Whether the app authenticates against a self-hosted backend (the
   * `minerva-sync` Worker) instead of Minerva Cloud. Separate from
   * `selfHosted`, which only unlocks the premium features: a Docker deployment
   * that still points at the hosted backend keeps using Supabase.
   */
  selfHostedBackend?: boolean;
}

declare global {
  interface Window {
    __MINERVA_RUNTIME_CONFIG?: MinervaRuntimeConfig;
  }
}

export const getRuntimeConfig = () =>
  typeof window === 'undefined' ? undefined : window.__MINERVA_RUNTIME_CONFIG;

export const getServerRuntimeConfig = (): MinervaRuntimeConfig => ({
  // Browser runtime config should prefer a public Supabase URL when provided.
  // SUPABASE_URL remains as a backward-compatible fallback for non-split setups.
  supabaseUrl:
    process.env['SUPABASE_PUBLIC_URL'] ??
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ??
    process.env['SUPABASE_URL'],
  supabaseAnonKey: process.env['SUPABASE_ANON_KEY'] ?? process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  apiBaseUrl:
    process.env['API_BASE_URL'] ??
    process.env['NEXT_PUBLIC_API_BASE_URL'] ??
    process.env['SITE_URL'],
  // These were previously baked as NEXT_PUBLIC_* build args; now read from runtime env so
  // the published image can be configured without rebuilding.
  objectStorageType:
    process.env['OBJECT_STORAGE_TYPE'] ?? process.env['NEXT_PUBLIC_OBJECT_STORAGE_TYPE'],
  // A self-hosted deployment unlocks every premium feature: there is no store
  // to buy from, and the operator already runs the infrastructure the paywall
  // funds.
  selfHosted:
    (process.env['SELF_HOSTED'] || process.env['NEXT_PUBLIC_SELF_HOSTED']) === 'true' || undefined,
  // A deployment pointing at its own sync Worker authenticates against that
  // Worker instead of Supabase. Undefined (not false) when unset, so the
  // browser falls back to the same `||`-style check the server uses.
  selfHostedBackend:
    (process.env['SELF_HOSTED_BACKEND'] || process.env['NEXT_PUBLIC_SELF_HOSTED_BACKEND']) ===
      'true' || undefined,
  storageFixedQuota: (() => {
    const raw =
      process.env['STORAGE_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_STORAGE_FIXED_QUOTA'];
    return raw ? parseInt(raw, 10) : undefined;
  })(),
  translationFixedQuota: (() => {
    const raw =
      process.env['TRANSLATION_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA'];
    return raw ? parseInt(raw, 10) : undefined;
  })(),
  // Base URL of the directory holding the self-hosted CJK webfont bundles.
  // Minerva's own CDN only answers CORS for minerva.invalid origins, so a
  // self-hosted deployment on a custom domain has to serve them itself (#5550).
  // `||` not `??`: compose passes the variable through even when it is unset,
  // and an empty string would build root-relative font URLs.
  fontBaseUrl:
    process.env['FONT_BASE_URL'] || process.env['NEXT_PUBLIC_FONT_BASE_URL'] || undefined,
});
