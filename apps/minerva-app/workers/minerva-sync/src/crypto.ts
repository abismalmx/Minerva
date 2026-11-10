/**
 * Hashing primitives for the self-hosted sync Worker.
 *
 * Three digests are needed, for three different protocols:
 *
 * - **PBKDF2-HMAC-SHA256** for the native sync API's account passphrase
 *   (`users.passhash`). A passphrase is a secret the user picks, so it is
 *   stored stretched and salted: a dump of the D1 table must not be enough to
 *   recover it, not even for a weak passphrase.
 * - **SHA-256** for the KOSync account key (`users.userkey`), salted. The
 *   KOSync protocol sends `md5(password)` **on the client** and the server
 *   only ever compares digests — it never sees the passphrase — so the key
 *   cannot be stretched, but it can still be salted so the stored value is
 *   not the credential itself.
 * - **MD5** for that same KOSync key, because the protocol defines it.
 *
 * The formats are marked in the value itself, so an account created before
 * the change keeps working and is re-stretched the first time its owner
 * signs in; no migration of the table is needed.
 *
 * All of it is implemented here so the Worker needs no runtime dependency.
 */

import { argon2id } from '@noble/hashes/argon2';

const encoder = new TextEncoder();

/** Base64url encoding without padding, per RFC 7515. */
export const base64urlEncode = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const base64urlDecode = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** SHA-256 of a string, hex encoded. */
export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** SHA-256 of a string, raw bytes. */
const sha256Bytes = async (value: string): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return new Uint8Array(digest);
};

/**
 * The iterations PBKDF2 stretches an account passphrase with.
 *
 * The 2023 OWASP recommendation for PBKDF2-HMAC-SHA256 is 600 000. Each
 * sign-in pays for them once: the Worker only stretches when the account
 * exists, and the sign-in throttle caps how often that can happen per
 * account.
 */
export const PASSPHRASE_KDF_ITERATIONS = 600_000;
export const MAX_PASSPHRASE_KDF_ITERATIONS = 100_000;

/**
 * The lowest cost a deployment may set.
 *
 * The cost is paid on every registration and every sign-in, and a deployment
 * with a tight CPU budget may want it lower — but not so low that the
 * stored hash is worth a rainbow table.
 */
export const MIN_PASSPHRASE_KDF_ITERATIONS = 10_000;

/** The length of the per-account salt, in bytes. */
const SALT_BYTES = 16;

/** The marker of a stretched passphrase (PBKDF2). */
export const PASSPHRASE_HASH_PREFIX = 'pbkdf2-sha256';

/** The marker of a stretched passphrase (Argon2id). */
export const ARGON2ID_HASH_PREFIX = 'argon2id';

/** Default Argon2id parameters calibrated for serverless edge workers */
export const DEFAULT_ARGON2_PARAMS = {
  m: 4096, // 4 MB memory cost
  t: 1, // 1 iteration
  p: 1, // 1 lane parallelism
};

/**
 * Stretch an account passphrase into an Argon2id hash.
 * Format: `argon2id$<t>$<m>$<p>$<salt>$<hash>`
 */
export const createArgon2idHash = (
  passphrase: string,
  options: { m?: number; t?: number; p?: number } = {},
): string => {
  const m = options.m ?? DEFAULT_ARGON2_PARAMS.m;
  const t = options.t ?? DEFAULT_ARGON2_PARAMS.t;
  const p = options.p ?? DEFAULT_ARGON2_PARAMS.p;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = argon2id(passphrase, salt, { m, t, p, dkLen: 32 });
  return [
    ARGON2ID_HASH_PREFIX,
    String(t),
    String(m),
    String(p),
    base64urlEncode(salt),
    base64urlEncode(hash),
  ].join('$');
};

/** The marker of a salted KOSync account key. */
export const KOSYNC_USERKEY_PREFIX = 'kosync-sha256';

/** PBKDF2-HMAC-SHA256, raw bytes. */
const pbkdf2 = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ]);
  // A copy of the salt, so the buffer is a plain ArrayBuffer whatever the
  // caller decoded it into.
  const saltBytes = new Uint8Array(salt);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
};

/**
 * Stretch an account passphrase into the value stored in `users.passhash`.
 *
 * The format carries everything needed to verify it later:
 * `pbkdf2-sha256$<iterations>$<salt>$<hash>`, with the salt and the hash
 * base64url encoded.
 */
export const createPassphraseHash = async (
  passphrase: string,
  iterations: number = PASSPHRASE_KDF_ITERATIONS,
): Promise<string> => {
  const safeIterations = Math.min(
    MAX_PASSPHRASE_KDF_ITERATIONS,
    Math.max(MIN_PASSPHRASE_KDF_ITERATIONS, iterations),
  );
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(passphrase, salt, safeIterations);
  return [
    PASSPHRASE_HASH_PREFIX,
    String(safeIterations),
    base64urlEncode(salt),
    base64urlEncode(hash),
  ].join('$');
};

/** Whether a stored passphrase is already stretched. */
export const isPassphraseHash = (stored: string): boolean =>
  stored.startsWith(`${PASSPHRASE_HASH_PREFIX}$`);

/**
 * Whether a stored passphrase is the legacy unsalted SHA-256 digest.
 *
 * Those rows are re-stretched the first time their owner signs in.
 */
export const isLegacyPassphraseHash = (stored: string): boolean => /^[0-9a-f]{64}$/.test(stored);

/**
 * Check a passphrase against the value stored for an account.
 *
 * Both formats are accepted: a stretched one is verified with PBKDF2, and a
 * legacy unsalted SHA-256 with a plain digest, so an account created before
 * the change keeps working.
 */
export const verifyPassphrase = async (passphrase: string, stored: string): Promise<boolean> => {
  try {
    if (stored.startsWith(`${ARGON2ID_HASH_PREFIX}$`)) {
      const parts = stored.split('$');
      if (parts.length !== 6) return false;
      const [, tStr, mStr, pStr, saltStr, hashStr] = parts;
      if (!tStr || !mStr || !pStr || !saltStr || !hashStr) return false;
      const t = Number(tStr);
      const m = Number(mStr);
      const p = Number(pStr);
      if (!Number.isInteger(t) || t < 1 || t > 10) return false;
      if (!Number.isInteger(m) || m < 8 || m > 65536) return false;
      if (!Number.isInteger(p) || p < 1 || p > 4) return false;
      const salt = base64urlDecode(saltStr);
      const derived = argon2id(passphrase, salt, { m, t, p, dkLen: 32 });
      return safeEqual(base64urlEncode(derived), hashStr);
    }
    if (isPassphraseHash(stored)) {
      const parts = stored.split('$');
      if (parts.length !== 4) return false;
      const [, iterationsStr, salt, hash] = parts;
      if (!iterationsStr || !salt || !hash) return false;
      const iterations = Number(iterationsStr);
      if (!Number.isInteger(iterations) || iterations < MIN_PASSPHRASE_KDF_ITERATIONS) return false;
      const derived = await pbkdf2(
        passphrase,
        base64urlDecode(salt),
        Math.min(MAX_PASSPHRASE_KDF_ITERATIONS, iterations),
      );
      return safeEqual(base64urlEncode(derived), hash);
    }
    if (isLegacyPassphraseHash(stored)) {
      return safeEqual(await sha256Hex(passphrase), stored);
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * Salt a KOSync account key.
 *
 * The protocol fixes the key to `md5(password)`, so it cannot be stretched,
 * but it can be salted: the stored value is then useless to somebody who
 * reads the table, and a table of unsalted MD5s cannot be attacked with a
 * precomputed table.
 */
export const createKoSyncUserkey = async (md5: string): Promise<string> => {
  const salt = base64urlEncode(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
  const hash = await sha256Bytes(`${md5}${salt}`);
  return `${KOSYNC_USERKEY_PREFIX}$${salt}$${base64urlEncode(hash)}`;
};

/** Whether a stored KOSync account key is already salted. */
export const isKoSyncUserkey = (stored: string): boolean =>
  stored.startsWith(`${KOSYNC_USERKEY_PREFIX}$`);

/**
 * Check a KOSync account key against the value stored for an account.
 *
 * A salted key is verified by hashing the received digest with the stored
 * salt; a legacy key is the digest itself.
 */
export const verifyKoSyncUserkey = async (md5: string, stored: string): Promise<boolean> => {
  if (isKoSyncUserkey(stored)) {
    const [, salt, hash] = stored.split('$');
    if (!salt || !hash) return false;
    const derived = await sha256Bytes(`${md5}${salt}`);
    return safeEqual(base64urlEncode(derived), hash);
  }
  return safeEqual(stored, md5.toLowerCase());
};

/**
 * MD5 of a string, hex encoded.
 *
 * A compact, dependency-free implementation. KOSync compares the hex digest
 * against the value the client sent, so this only has to be correct for
 * arbitrary UTF-8 input.
 */
export const md5Hex = async (value: string): Promise<string> => {
  const bytes = encoder.encode(value);
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const sine = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
  );
  const rotate = (v: number, shift: number) => (v << shift) | (v >>> (32 - shift));

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  // Pad to a multiple of 64 bytes, then append the 64-bit length in bits.
  const padded = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bytes.length * 8, true);

  for (let offset = 0; offset < padded.length; offset += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true);

    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const temp = d;
      d = c;
      c = b;
      const sum = (a + f + sine[i]! + m[g]!) >>> 0;
      b = (b + rotate(sum, shifts[i]!)) >>> 0;
      a = temp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return [...out].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Constant-time-ish string comparison, for digest equality checks. */
export const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
