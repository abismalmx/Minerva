/**
 * Signed tickets for the storage object routes.
 *
 * The client transfers the book bytes with a plain `PUT` / `GET` to the URL
 * the server handed it — no `Authorization` header (the hosted backend
 * answers with an R2 presigned URL, which carries its own signature). The
 * Worker must therefore answer with a URL that is usable on its own.
 *
 * The ticket is an HMAC-SHA-256 signature over the object key, the expiry and
 * the SCOPE, carried in the query string:
 *
 *   /api/storage/object?key=<key>&exp=<unix-seconds>&sig=<hex>
 *
 * It is verified WITHOUT a database round trip, so a transfer costs one
 * request, exactly like a presigned R2 URL. The expiry keeps a leaked URL
 * from working forever.
 *
 * The scope is what keeps a download URL from being a write URL: the client
 * hands the download URL to third parties (Discord, an `<img>` tag), so it
 * must only ever open the object. The write ticket is the one the uploader
 * gets for its own reservation.
 */

import { safeEqual } from './crypto';

const encoder = new TextEncoder();

/**
 * What a ticket authorizes.
 *
 * - `read`: fetch the object. This is the URL that travels to third parties.
 * - `write`: replace the object. Only the reservation's owner gets one.
 */
export type TicketScope = 'read' | 'write';

/** How long a minted ticket stays valid. */
export const TICKET_TTL_SECONDS = 30 * 60; // 30 minutes, like the hosted backend's presigns

const importKey = async (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Sign one ticket. */
export const signTicket = async (
  secret: string,
  key: string,
  expiresAt: number,
  scope: TicketScope = 'read',
): Promise<string> => {
  const cryptoKey = await importKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(`${key}\n${expiresAt}\n${scope}`),
  );
  return toHex(signature);
};

/**
 * Mint a ticket for an object key.
 *
 * Returns `null` when no secret is configured — the Worker then cannot issue
 * usable URLs, and the caller answers 503 rather than handing out a URL that
 * would fail.
 *
 * The scope defaults to `read`: a URL that is handed out without saying what
 * it is for must never be a write URL.
 */
export const mintTicket = async (
  secret: string | undefined,
  key: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  scope: TicketScope = 'read',
): Promise<string | null> => {
  if (!secret) return null;
  const expiresAt = nowSeconds + TICKET_TTL_SECONDS;
  const sig = await signTicket(secret, key, expiresAt, scope);
  return `${expiresAt}.${sig}`;
};

/**
 * Verify a ticket for an object key.
 *
 * Returns false when the ticket is missing, malformed, expired, does not
 * match the key, or was minted for another scope.
 */
export const verifyTicket = async (
  secret: string | undefined,
  key: string,
  ticket: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  scope: TicketScope = 'read',
): Promise<boolean> => {
  if (!secret || !ticket) return false;
  const separator = ticket.indexOf('.');
  if (separator <= 0) return false;
  const expiresAt = Number(ticket.slice(0, separator));
  const signature = ticket.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < nowSeconds) return false;
  const expected = await signTicket(secret, key, expiresAt, scope);
  return safeEqual(expected, signature);
};
