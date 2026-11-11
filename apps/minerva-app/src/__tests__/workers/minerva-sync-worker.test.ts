import { describe, it, expect } from 'vitest';

// Unit tests for the self-hosted sync Worker's pure logic. The Worker
// (workers/minerva-sync) is a self-contained Cloudflare project; only its
// runtime-agnostic helpers are exercised here.
import {
  base64urlDecode,
  base64urlEncode,
  safeEqual,
  sha256Hex,
} from '../../../workers/minerva-sync/src/crypto';
import { extractBearerToken, mintToken, verifyToken } from '../../../workers/minerva-sync/src/auth';

const SECRET = 'test-secret-value';

describe('sha256Hex', () => {
  it('produces the well-known digest of the empty string', async () => {
    await expect(sha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('produces a 64-hex-character digest', async () => {
    const digest = await sha256Hex('passphrase');
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('base64url', () => {
  it('round-trips arbitrary bytes without padding', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    const encoded = base64urlEncode(bytes);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect([...base64urlDecode(encoded)]).toEqual([...bytes]);
  });
});

describe('safeEqual', () => {
  it('compares equal strings as equal and different ones as different', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('token minting and verification', () => {
  it('accepts a freshly minted token', async () => {
    const token = await mintToken(SECRET, { userId: 'u1', email: 'a@example.com' });
    const claims = await verifyToken(SECRET, token);
    expect(claims?.sub).toBe('u1');
    expect(claims?.email).toBe('a@example.com');
    expect(claims?.role).toBe('authenticated');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await mintToken(SECRET, { userId: 'u1', email: 'a@example.com' });
    await expect(verifyToken('another-secret', token)).resolves.toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await mintToken(SECRET, { userId: 'u1', email: 'a@example.com' });
    const [header, , signature] = token.split('.');
    const forged = base64urlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          sub: 'admin',
          email: 'a@example.com',
          role: 'authenticated',
          plan: 'free',
          storage_usage_bytes: 0,
          storage_purchased_bytes: 0,
          customization_purchased: true,
          iat: 0,
          exp: 99999999999,
        }),
      ),
    );
    await expect(verifyToken(SECRET, `${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const now = 1_700_000_000;
    const token = await mintToken(SECRET, { userId: 'u1', email: 'a@example.com' }, now);
    // One second past the 30-day TTL.
    await expect(verifyToken(SECRET, token, now + 60 * 60 * 24 * 30 + 1)).resolves.toBeNull();
  });

  it('rejects a malformed token', async () => {
    await expect(verifyToken(SECRET, 'not-a-token')).resolves.toBeNull();
    await expect(verifyToken(SECRET, 'a.b')).resolves.toBeNull();
  });

  it('grants every premium feature to a self-hosted account', async () => {
    const token = await mintToken(SECRET, { userId: 'u1', email: 'a@example.com' });
    const claims = await verifyToken(SECRET, token);
    expect(claims?.customization_purchased).toBe(true);
  });
});

describe('extractBearerToken', () => {
  it('reads the token from a Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for a missing or non-Bearer header', () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
  });
});
