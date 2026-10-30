/**
 * Public client identifiers of the hosted Minerva service.
 *
 * None of these is a secret. They are all `NEXT_PUBLIC_*` values, so they are
 * inlined into the app bundle and are visible to anyone who installs Minerva:
 * the Supabase key is the *anon* key and stays behind Row Level Security, the
 * Stripe ones are publishable keys, the PostHog one is a project key, and the
 * Pagebound ones belong to a third party and ship in its own web app.
 *
 * They live here instead of in a `.env` file so that a checkout works with no
 * dotfile at all. Every one of them can still be overridden with the matching
 * environment variable (see `.env.example`); the variable always wins.
 */
export const PUBLIC_DEFAULTS = {
  /** Minerva Cloud account layer: project URL and anon key, base64 encoded. */
  supabaseUrlBase64: 'aHR0cHM6Ly92YnN5eGZ1c2pqcWR4a2pxbHlzYy5zdXBhYmFzZS5jbw==',
  supabaseAnonKeyBase64:
    'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5aaWMzbDRablZ6YW1weFpIaHJhbkZzZVhOaklpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTXpReE1qTTJOekVzSW1WNGNDSTZNakEwT1RZNU9UWTNNWDAuM1U1VXFhb3VfMVNnclZlMWVvOXJBcGMwdUtqcWhwUWRVWGh2d1VIbVVmZw==',
  /** Telemetry endpoint and project key, base64 encoded. */
  posthogUrlBase64: 'aHR0cHM6Ly91cy5pLnBvc3Rob2cuY29t',
  posthogKeyBase64: 'cGhjX0x3ekhZRWtsZUVub3ZSc05ZQlRpTVRTV2MyS1NUOFdZMzBIWWFhN0ZPa1IK',
  /** Publishable (not secret) Stripe keys, base64 encoded. */
  stripePublishableKeyBase64:
    'cGtfbGl2ZV81MVFYN3dRRU5ndjJFOUxQRHpZUlE5TlJJeTNjd09EZ1AzSkNFRHRPWlFtdFJWc3Brd053ZE1NNUpIVnVPTmJWcjZ3VGFCMUNZR1pJMmRPVWppTkY0bHJvVjAwalE4TkpkdWk=',
  stripePublishableKeyDevBase64:
    'cGtfdGVzdF81MVJmQmdLRTdSWW5pTWsxc0tDV2RUd2hMZzcySzk4eDRWcjlIdDdsRFBONngzcnpZYmhydGtNQnpDdzZKbHFaRVVITVp5eVNjVXhCZXVkcGppWTk0WXNHcDAweFlRRnRRaUU=',
  /** Pagebound (third party): Firebase client key and search-only Typesense key. */
  pageboundFirebaseApiKey: 'AIzaSyDCfBJ51pRZgHueBfBz0KNDiPNev1ClnGg',
  pageboundTypesenseApiKey: 'SgSrp2Vx4V4wjJAwnME6uWUufNdi9BxM',
} as const;

/**
 * Decodes a base64 value, tolerating a missing or malformed one.
 *
 * The hosted-service defaults used to live in a `.env` file, and
 * `atob(undefined)` threw at import time when that file was missing, which
 * took the whole app down with it. Every caller goes through here instead.
 */
export const decodeBase64 = (value?: string): string => {
  if (!value) return '';
  try {
    return atob(value);
  } catch {
    return '';
  }
};
