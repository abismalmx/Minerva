/**
 * The replica-key API: `GET|POST|DELETE /api/sync/replica-keys`.
 *
 * The passphrase salts are opaque blobs: the Worker stores them so a second
 * device can derive the same key and decrypt the encrypted replica rows, but
 * it never interprets them. The passphrase itself never reaches the server.
 *
 * The client contract is the hosted backend's
 * (apps/minerva-app/src/pages/api/sync/replica-keys.ts):
 *
 * - `POST` takes `{ alg }` and the SERVER mints the salt. The client asks for
 *   an algorithm and derives its key from the salt it gets back — it never
 *   sends one, because a client-minted salt would have to travel over the
 *   wire in the clear.
 * - `GET` answers `{ rows: [{ saltId, alg, salt, createdAt }] }` — the
 *   camelCase shape the client reads. The salt is base64, which is what the
 *   client's `base64ToBytes` expects.
 */

import { errorJson, json, nowIso, readJson, type Env } from './http';

/** The algorithms the server accepts. */
export const SUPPORTED_ALGS = new Set<string>(['pbkdf2-600k-sha256']);

/** The size of a minted salt, in bytes. */
export const SALT_BYTES = 32;

/**
 * The largest salt the server accepts.
 *
 * The server mints a 32-byte salt (44 characters in base64); a client that
 * sends its own may use a longer one, but not an unbounded one: the value is
 * stored in the operator's database, one row per request.
 */
const MAX_SALT_LENGTH = 4096;

/**
 * The largest identifier the server accepts.
 *
 * The server mints a UUID (36 characters). The column is part of the primary
 * key, so an unbounded identifier is an unbounded key.
 */
const MAX_SALT_ID_LENGTH = 128;

/**
 * The largest encrypted envelope the server accepts.
 *
 * The envelope holds the wrapped passphrase key: a public key and a nonce.
 * It is stored verbatim, so it needs a ceiling too.
 */
const MAX_ENVELOPE_LENGTH = 64 * 1024;

/** The stored form of a salt row. */
interface ReplicaKeyRow {
  salt_id: string;
  alg: string;
  salt: string;
  created_at: string;
  envelope: string | null;
}

/** The wire shape of a salt row — the client's `ReplicaKeyRow`. */
interface ReplicaKeyWireRow {
  saltId: string;
  alg: string;
  salt: string;
  createdAt: string;
}

const toWireRow = (row: ReplicaKeyRow): ReplicaKeyWireRow => ({
  saltId: row.salt_id,
  alg: row.alg,
  salt: row.salt,
  createdAt: row.created_at,
});

/** A fresh random salt, base64 encoded. */
const mintSalt = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** `GET /api/sync/replica-keys` — list the account's passphrase salts. */
export const handleReplicaKeysList = async (env: Env, userId: string): Promise<Response> => {
  const { results } = await env.SYNC_DB.prepare(
    `SELECT salt_id, alg, salt, created_at, envelope FROM replica_keys
     WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<ReplicaKeyRow>();
  return json({ rows: (results ?? []).map(toWireRow) });
};

/**
 * `POST /api/sync/replica-keys` — store a new passphrase salt.
 *
 * The salt is minted here. A client that sends its own salt is accepted too
 * (the salt is opaque either way), but the server-minted path is the one the
 * client uses.
 */
export const handleReplicaKeysCreate = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const body = await readJson<{
    alg?: string;
    salt?: string;
    salt_id?: string;
    envelope?: string;
  }>(request);
  const alg = body?.alg ?? 'pbkdf2-600k-sha256';
  if (!SUPPORTED_ALGS.has(alg)) {
    return errorJson(`Unsupported alg: ${alg}`, 422, { code: 'UNSUPPORTED_ALG' });
  }
  const salt = body?.salt ?? mintSalt();
  if (!salt) return errorJson('salt is required', 400, { code: 'VALIDATION' });
  if (typeof salt !== 'string' || salt.length > MAX_SALT_LENGTH) {
    return errorJson(`salt must be at most ${MAX_SALT_LENGTH} characters long`, 400, {
      code: 'VALIDATION',
    });
  }
  const saltId = body?.salt_id ?? crypto.randomUUID();
  if (typeof saltId !== 'string' || saltId.length === 0 || saltId.length > MAX_SALT_ID_LENGTH) {
    return errorJson(`salt_id must be between 1 and ${MAX_SALT_ID_LENGTH} characters long`, 400, {
      code: 'VALIDATION',
    });
  }
  const envelope = body?.envelope ?? null;
  if (
    envelope !== null &&
    (typeof envelope !== 'string' || envelope.length > MAX_ENVELOPE_LENGTH)
  ) {
    return errorJson(`envelope must be at most ${MAX_ENVELOPE_LENGTH} characters long`, 400, {
      code: 'VALIDATION',
    });
  }
  const createdAt = nowIso();

  await env.SYNC_DB.prepare(
    `INSERT INTO replica_keys (user_id, salt_id, alg, salt, envelope, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, salt_id) DO UPDATE SET
       alg = excluded.alg, salt = excluded.salt, envelope = excluded.envelope`,
  )
    .bind(userId, saltId, alg, salt, envelope, createdAt)
    .run();

  return json({ row: { saltId, alg, salt, createdAt } }, 201);
};

/** `DELETE /api/sync/replica-keys` — forget every salt and envelope. */
export const handleReplicaKeysForget = async (env: Env, userId: string): Promise<Response> => {
  await env.SYNC_DB.prepare('DELETE FROM replica_keys WHERE user_id = ?').bind(userId).run();
  return json({ ok: true });
};
