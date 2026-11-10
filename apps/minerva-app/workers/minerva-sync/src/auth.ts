/**
 * Authentication for the self-hosted sync Worker.
 *
 * The hosted backend delegates to Supabase GoTrue and gets a signed JWT. A
 * self-hosted deployment has no identity provider, so the Worker mints its own
 * bearer tokens: an HMAC-SHA-256 signed JWT (HS256) over a small claim set.
 *
 * The token is deliberately the SAME shape the client already understands:
 * `sub` = user id, `email`, `role` = 'authenticated', plus the `plan` and
 * storage claims the client's `getStoragePlanData` / `getUserProfilePlan`
 * read. That way the client needs no change beyond the token verification.
 *
 * The signing secret lives in the Worker secret store (`wrangler secret put
 * JWT_SECRET`). A deployment without it cannot mint tokens and every
 * authenticated route answers 503 — fail closed rather than issue unsigned
 * tokens.
 */

import { base64urlDecode, base64urlEncode } from './crypto';

/**
 * Copy a byte view into a plain ArrayBuffer.
 *
 * WebCrypto's `BufferSource` does not accept a `Uint8Array` backed by a
 * `SharedArrayBuffer`, which the lib types allow for any `Uint8Array`. A fresh
 * copy pins the buffer type and sidesteps the mismatch.
 */
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
};

export interface TokenClaims {
  /** User id — the `sub` claim. */
  sub: string;
  email: string;
  /** Always 'authenticated' for a signed-in user. */
  role: 'authenticated';
  /** Subscription plan. A self-hosted deployment grants every premium feature. */
  plan: string;
  storage_usage_bytes: number;
  storage_purchased_bytes: number;
  customization_purchased: boolean;
  /** Issued-at, seconds since the epoch. */
  iat: number;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export interface AuthUser {
  id: string;
  email: string;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

const importKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);

export interface MintTokenInput {
  userId: string;
  email: string;
  plan?: string;
  storageUsageBytes?: number;
  storagePurchasedBytes?: number;
}

/** Mint a signed HS256 access token for the given user. */
export const mintToken = async (
  secret: string,
  input: MintTokenInput,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> => {
  const claims: TokenClaims = {
    sub: input.userId,
    email: input.email,
    role: 'authenticated',
    plan: input.plan ?? 'pro',
    storage_usage_bytes: input.storageUsageBytes ?? 0,
    storage_purchased_bytes: input.storagePurchasedBytes ?? 0,
    // A self-hosted deployment has no store to buy from; the operator already
    // runs the infrastructure the paywall funds.
    customization_purchased: true,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  const header = base64urlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64urlEncode(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${base64urlEncode(signature)}`;
};

/**
 * Verify a bearer token and return its claims, or `null` when the token is
 * malformed, forged, expired, or not an `authenticated` token.
 */
export const verifyToken = async (
  secret: string,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<TokenClaims | null> => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  let key: CryptoKey;
  try {
    key = await importKey(secret);
  } catch {
    return null;
  }

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      toArrayBuffer(base64urlDecode(signature)),
      encoder.encode(`${header}.${payload}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let claims: TokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as TokenClaims;
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object') return null;
  if (claims.role !== 'authenticated' || !claims.sub) return null;
  if (typeof claims.exp !== 'number' || claims.exp < nowSeconds) return null;
  return claims;
};

/**
 * Extract the bearer token from an Authorization header. Returns `null` when
 * the header is missing or does not use the Bearer scheme.
 */
export const extractBearerToken = (header: string | null | undefined): string | null => {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
};
