/**
 * The KOSync-compatible API (KOReader Sync protocol).
 *
 * The plan calls for a KOSync-compatible surface so KOReader — and Minerva's
 * own KOReader Sync integration — can use this backend directly. The protocol
 * is small and well-specified:
 *
 * - `POST /users/create` — register `{ username, password }`. The password is
 *   ALREADY an md5 digest: KOReader hashes it client-side and sends only the
 *   digest, so the server never sees the passphrase.
 * - `GET /users/auth` — validate the credentials. The client sends
 *   `X-Auth-User` (username) and `X-Auth-Key` (the md5 digest). A 200 means
 *   the pair matches; 401 means it does not.
 * - `PUT /syncs/progress` — store the reading position for a document.
 * - `GET /syncs/progress/<md5>` — read it back.
 *
 * The md5 digest of the passphrase is what both the native sync account and
 * the KOSync account use, so one Minerva account can share its passphrase
 * across both surfaces without storing it twice.
 */

import { errorJson, json, readJson, type Env } from './http';
import { createKoSyncUserkey, verifyKoSyncUserkey } from './crypto';
import {
  clearFailedAttempts,
  isLockedOut,
  isRegistrationRateLimited,
  isUniqueViolation,
  KOSYNC_ONLY_PASSHASH,
  recordFailedAttempt,
  recordRegistration,
} from './accounts';

export interface KoSyncUser {
  id: string;
  username: string;
  userkey: string;
}

/** The `X-Auth-User` / `X-Auth-Key` pair KOSync clients send. */
const readAuthHeaders = (request: Request): { username: string; userkey: string } => ({
  username: request.headers.get('x-auth-user') ?? '',
  userkey: request.headers.get('x-auth-key') ?? '',
});

/**
 * The KOSync surface authenticates on EVERY request (KOReader sends the
 * digest on each call), so it needs the same brute-force protection as the
 * native login. The counter is keyed by the account name, which is the
 * identity the KOSync client presents.
 */
const kosyncAttemptKey = (username: string): string => `kosync:${username.toLowerCase()}`;

/**
 * The longest account identifier the KOSync surface accepts.
 *
 * The identifier arrives in a header the client controls, and it is used as
 * the key of the `login_attempts` counter (see `kosyncAttemptKey`), so an
 * identifier without a length bound would let an unauthenticated caller
 * write a row as large as it wants into the operator's database, one request
 * per row. The bound matches the longest email address.
 */
const MAX_KOSYNC_IDENTIFIER_LENGTH = 254;

/**
 * Whether an identifier is usable as a KOSync account identifier.
 *
 * The identifier may be an account NAME or the EMAIL of a native account
 * (both resolve to an account, see {@link findKoSyncAccount}), so its format
 * is not restricted here — only its length is, which is what bounds the
 * counter row.
 */
const isUsableKosyncIdentifier = (value: string): boolean =>
  value.length > 0 && value.length <= MAX_KOSYNC_IDENTIFIER_LENGTH;

/**
 * The longest account NAME the KOSync surface accepts.
 *
 * A name has to survive being a value of the `users.username` column, and
 * the native surface has the same bound (`sanitizeUsername`), so the two
 * agree.
 */
const MAX_KOSYNC_USERNAME_LENGTH = 64;

/**
 * Whether a name is usable as a KOSync ACCOUNT NAME.
 *
 * A name has to survive being a key of the throttle counter and a value of
 * the `users.username` column, so it is bounded and restricted to the same
 * character set the native surface uses.
 */
const isUsableKosyncUsername = (value: string): boolean =>
  value.length > 0 && value.length <= MAX_KOSYNC_USERNAME_LENGTH && /^[A-Za-z0-9._-]+$/.test(value);

/**
 * Find the account a KOSync request refers to.
 *
 * A native account is reachable by its KOSync username AND by its email: the
 * username is derived from the email prefix plus a short id slice (so two
 * accounts sharing a prefix do not collide), and the README documents the
 * email as the name KOReader should use. Both identifiers are unique, so the
 * lookup is unambiguous.
 */
const findKoSyncAccount = async (
  env: Env,
  identifier: string,
): Promise<{ id: string; username: string; userkey: string } | null> => {
  const byUsername = await env.SYNC_DB.prepare(
    'SELECT id, username, userkey FROM users WHERE username = ?',
  )
    .bind(identifier)
    .first<{ id: string; username: string; userkey: string }>();
  if (byUsername) return byUsername;
  return await env.SYNC_DB.prepare('SELECT id, username, userkey FROM users WHERE email = ?')
    .bind(identifier)
    .first<{ id: string; username: string; userkey: string }>();
};

/**
 * Authenticate a KOSync request, applying the sign-in throttle.
 *
 * Returns `null` when the credentials do not match; the caller answers 401.
 * A failed digest counts as an attempt, so a wrong key cannot be guessed
 * forever.
 */
export const authenticateKoSync = async (
  env: Env,
  request: Request,
): Promise<KoSyncUser | null> => {
  const { username, userkey } = readAuthHeaders(request);
  if (!username || !userkey) return null;
  // An identifier the surface would never accept cannot be an account: the
  // account NAME has to be usable, and the EMAIL of a native account has to
  // fit in a bound. Refusing them here keeps an arbitrary string out of the
  // throttle counter (whose key is the identifier) and out of the query.
  if (!isUsableKosyncIdentifier(username)) return null;

  const row = await findKoSyncAccount(env, username);
  // The counter is keyed by the ACCOUNT, not by the identifier the client
  // happened to present: otherwise an attacker could halve the throttle by
  // alternating between the username and the email.
  const attemptKey = kosyncAttemptKey(row?.username ?? username);
  if (await isLockedOut(env, attemptKey)) return null;

  if (!row) {
    await recordFailedAttempt(env, attemptKey);
    return null;
  }
  if (!(await verifyKoSyncUserkey(userkey.toLowerCase(), row.userkey))) {
    await recordFailedAttempt(env, attemptKey);
    return null;
  }
  await clearFailedAttempts(env, attemptKey);
  return { id: row.id, username: row.username, userkey: row.userkey };
};

/** `POST /users/create` — register a KOSync account. */
export const handleKoSyncCreate = async (request: Request, env: Env): Promise<Response> => {
  const body = await readJson<{ username?: string; password?: string }>(request);
  const username = (body?.username ?? '').trim();
  // The client sends md5(password); a raw passphrase would mean a different
  // protocol and must not be silently accepted.
  const password = (body?.password ?? '').trim();
  if (!username || !password) {
    return errorJson('username and password are required', 400);
  }
  // The name has to be usable as an account name: bounded and with the same
  // character set the native surface uses. An unbounded name is a row in the
  // operator's database whose size the caller chooses, on a route that does
  // not even require an account.
  if (!isUsableKosyncUsername(username)) {
    return errorJson(
      `username must be at most ${MAX_KOSYNC_USERNAME_LENGTH} characters and may only contain letters, digits, dot, underscore and hyphen`,
      400,
    );
  }
  // A username that looks like an email address would SHADOW the native
  // account of that address: the lookup tries the username before the email,
  // so the native account would stop being reachable on this surface. KOSync
  // account names are not email addresses.
  if (username.includes('@')) {
    return errorJson('username must not be an email address', 400);
  }
  if (!/^[0-9a-f]{32}$/i.test(password)) {
    return errorJson('password must be an md5 digest', 400);
  }
  // The key is stored salted: the protocol fixes it to `md5(password)`, so it
  // cannot be stretched, but the stored value must not be the credential
  // itself — a table of bare MD5s is both a rainbow-table target and a
  // pass-the-hash credential.
  const userkey = await createKoSyncUserkey(password.toLowerCase());

  // The registration surface is public, so it needs the same limit as the
  // native one: without it a script creates accounts in a loop, and each one
  // costs the operator a row in `users` and a counter row of its own.
  const clientId = request.headers.get('CF-Connecting-IP') ?? '';
  if (await isRegistrationRateLimited(env, clientId)) {
    return errorJson('Too many accounts created from this client. Try again later.', 429);
  }

  const existing = await env.SYNC_DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string }>();
  if (existing) {
    // KOSync answers 402 for a duplicate account; the client reads that as
    // "invalid credentials".
    return errorJson('User already exists', 402);
  }

  const id = crypto.randomUUID();
  try {
    await env.SYNC_DB.prepare(
      `INSERT INTO users (id, email, username, passhash, userkey, plan)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      // `passhash` holds the sentinel, NOT the MD5: the native login compares
      // a SHA-256 against that column, and storing the KOSync digest there
      // would make the two surfaces disagree about the account's credential.
      // The MD5 lives only in `userkey`, which is what KOSync authenticates.
      .bind(id, `${username}@kosync.local`, username, KOSYNC_ONLY_PASSHASH, userkey, 'free')
      .run();
  } catch (error) {
    // A UNIQUE violation is a client error (the name is taken), not a fault.
    if (isUniqueViolation(error)) {
      return errorJson('User already exists', 402);
    }
    throw error;
  }

  // The account exists: it counts against the client's registration window
  // and against the deployment's.
  await recordRegistration(env, clientId);
  return json({ username }, 201);
};

/** `GET /users/auth` — validate the credentials. */
export const handleKoSyncAuth = async (request: Request, env: Env): Promise<Response> => {
  const user = await authenticateKoSync(env, request);
  if (!user) return errorJson('Unauthorized', 401);
  return json({ authorized: 'OK' });
};

/**
 * `PUT /syncs/progress` — store the reading position for a document.
 *
 * The document key is the md5 of the file's contents, so the same book on two
 * devices resolves to the same row.
 */

/**
 * The largest document key the server accepts.
 *
 * The key is the md5 digest of the file (32 hexadecimal characters); a
 * client that names the document differently still has to stay inside a
 * bound, because the value is stored in the operator's database and it is
 * part of the primary key of the progress table.
 */
const MAX_KOSYNC_DOCUMENT_LENGTH = 128;

/** The largest reading position the server accepts. */
const MAX_KOSYNC_PROGRESS_LENGTH = 8192;

/** The largest metadata blob the server accepts. */
const MAX_KOSYNC_METADATA_LENGTH = 64 * 1024;

export const handleKoSyncProgressPut = async (
  request: Request,
  env: Env,
  user: KoSyncUser,
): Promise<Response> => {
  const body = await readJson<{
    document?: string;
    progress?: string;
    percentage?: number;
    device?: string;
    device_id?: string;
    metadata?: unknown;
  }>(request);
  const document = (body?.document ?? '').trim();
  if (!document) return errorJson('document is required', 400);
  if (document.length > MAX_KOSYNC_DOCUMENT_LENGTH) {
    return errorJson(`document must be at most ${MAX_KOSYNC_DOCUMENT_LENGTH} characters long`, 400);
  }
  const progress = body?.progress ?? '';
  if (typeof progress !== 'string' || progress.length > MAX_KOSYNC_PROGRESS_LENGTH) {
    return errorJson(`progress must be at most ${MAX_KOSYNC_PROGRESS_LENGTH} characters long`, 400);
  }
  const metadata = body?.metadata ? JSON.stringify(body.metadata) : null;
  if (metadata !== null && metadata.length > MAX_KOSYNC_METADATA_LENGTH) {
    return errorJson(`metadata must be at most ${MAX_KOSYNC_METADATA_LENGTH} characters long`, 400);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  await env.SYNC_DB.prepare(
    `INSERT INTO kosync_progress (user_id, document, progress, percentage, device, device_id, metadata, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, document) DO UPDATE SET
       progress = excluded.progress, percentage = excluded.percentage,
       device = excluded.device, device_id = excluded.device_id,
       metadata = excluded.metadata, timestamp = excluded.timestamp`,
  )
    .bind(
      user.id,
      document,
      progress,
      typeof body?.percentage === 'number' ? body.percentage : 0,
      body?.device ?? null,
      body?.device_id ?? null,
      metadata,
      timestamp,
    )
    .run();

  return json({ document, timestamp });
};

/**
 * `GET /syncs/progress/<document>` — read the stored position.
 *
 * A document with no stored position answers 404, as the official server does.
 */
export const handleKoSyncProgressGet = async (
  env: Env,
  user: KoSyncUser,
  document: string,
): Promise<Response> => {
  const row = await env.SYNC_DB.prepare(
    `SELECT document, progress, percentage, device, device_id, metadata, timestamp
     FROM kosync_progress WHERE user_id = ? AND document = ?`,
  )
    .bind(user.id, document)
    .first<{
      document: string;
      progress: string;
      percentage: number;
      device: string | null;
      device_id: string | null;
      metadata: string | null;
      timestamp: number;
    }>();
  if (!row) return errorJson('Not found', 404);
  return json({
    document: row.document,
    progress: row.progress,
    percentage: row.percentage,
    device: row.device,
    device_id: row.device_id,
    timestamp: row.timestamp,
    ...(row.metadata ? { metadata: JSON.parse(row.metadata) } : {}),
  });
};
