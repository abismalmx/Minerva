/**
 * Account creation and sign-in for the self-hosted backend.
 *
 * The hosted backend delegates to Supabase GoTrue (email + password, OAuth,
 * magic links). A self-hosted deployment has no mail server and no OAuth
 * provider, so the Worker offers the simplest thing that still works offline
 * and on every platform: **email + passphrase**.
 *
 * The passphrase never leaves the device in a recoverable form: the Worker
 * stores only what it derives from it — a stretched, salted PBKDF2 digest
 * (`users.passhash`) and a salted digest of the KOSync-compatible MD5
 * (`users.userkey`). Both are derived server-side from the passphrase the
 * client sends over TLS.
 *
 * The client stores the returned bearer token and uses it for every API call,
 * exactly as it does with a Supabase session token.
 */

import { errorJson, json, readJson, type Env } from './http';
import {
  createArgon2idHash,
  createKoSyncUserkey,
  createPassphraseHash,
  isKoSyncUserkey,
  isLegacyPassphraseHash,
  md5Hex,
  MIN_PASSPHRASE_KDF_ITERATIONS,
  MAX_PASSPHRASE_KDF_ITERATIONS,
  PASSPHRASE_KDF_ITERATIONS,
  safeEqual,
  verifyPassphrase,
} from './crypto';
import { mintToken } from './auth';

/**
 * The PBKDF2 cost this deployment stretches passphrases with.
 *
 * The operator may lower it for a tight CPU budget, but not below the floor:
 * a cost that low would make the stored hash worth a rainbow table.
 */
export const kdfIterations = (env: Env): number => {
  const configured = Number(env.PASSPHRASE_KDF_ITERATIONS ?? '');
  const base =
    !Number.isFinite(configured) || configured <= 0
      ? PASSPHRASE_KDF_ITERATIONS
      : Math.floor(configured);
  return Math.min(MAX_PASSPHRASE_KDF_ITERATIONS, Math.max(MIN_PASSPHRASE_KDF_ITERATIONS, base));
};

/** Stretch a passphrase with Argon2id by default, or PBKDF2 if configured */
export const hashPassphraseForAccount = async (passphrase: string, env: Env): Promise<string> => {
  const algo = (env.HASH_ALGORITHM || 'argon2id').toLowerCase();
  if (algo === 'pbkdf2') {
    return await createPassphraseHash(passphrase, kdfIterations(env));
  }
  const m = Math.min(65536, Math.max(8, Number(env.ARGON2_MEMORY || 4096)));
  const t = Math.min(10, Math.max(1, Number(env.ARGON2_PASSES || 1)));
  const p = Math.min(4, Math.max(1, Number(env.ARGON2_PARALLELISM || 1)));
  return createArgon2idHash(passphrase, { m, t, p });
};

/** Normalize an email for storage and lookup. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * A passphrase must be long enough to be worth hashing. A short passphrase is
 * rejected outright rather than silently accepted.
 */
export const MIN_PASSPHRASE_LENGTH = 8;

// The length cap goes first: the pattern backtracks quadratically on a long
// run of dots, so it must never see an oversized, attacker-sized string.
export const isValidEmail = (email: string): boolean =>
  email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const isValidUsername = (username: string): boolean =>
  /^[A-Za-z0-9._-]{3,64}$/.test(username);

/**
 * The `passhash` value stored for an account that only exists on the KOSync
 * surface.
 *
 * The KOSync protocol (KOReader) sends `md5(password)` as the credential and
 * the Worker can only ever compare digests — it never sees the passphrase.
 * Storing that MD5 in `users.passhash` would put a 128-bit hash in the column
 * the NATIVE login compares a SHA-256 against (`handleLogin`), so the two
 * surfaces would disagree about what the credential of a single account is.
 *
 * This sentinel is stored instead: it is not a digest of anything, so the
 * native login can never accept it, and it makes the account's nature
 * explicit in the database rather than silently wrong.
 */
export const KOSYNC_ONLY_PASSHASH = 'k';

/**
 * The `userkey` value stored for an account registered with a pre-computed
 * passphrase digest.
 *
 * The KOSync account key is `md5(passphrase)`, and a passphrase digest does
 * not carry the information needed to derive it. Such an account therefore
 * authenticates on the native surface only; the sentinel makes that visible
 * in the database instead of leaving an empty key that would match anything.
 *
 * It cannot collide with a real key: a KOSync key is 32 hexadecimal digits,
 * and this sentinel is not hexadecimal.
 */
export const NO_KOSYNC_USERKEY = 'none';

/** The longest email prefix kept in a derived KOSync username. */
const MAX_USERNAME_PREFIX_LENGTH = 64;

/**
 * A unique KOSync username for a native account.
 *
 * The username doubles as the KOSync account name, so it must be unique. It
 * is derived from the email prefix, but the prefix alone is NOT unique (two
 * accounts `alice@corp.example` and `alice@other.example` share it) and the
 * column carries a UNIQUE index — so the prefix is suffixed with a short
 * slice of the account id.
 */
export const deriveKoSyncUsername = (email: string, accountId: string): string => {
  const raw = (email.split('@')[0] ?? accountId).replace(/[^A-Za-z0-9._-]/g, '-');
  const prefix = raw.slice(0, MAX_USERNAME_PREFIX_LENGTH);
  const suffix = accountId.replace(/-/g, '').slice(0, 8).toLowerCase();
  return suffix ? `${prefix}-${suffix}` : prefix;
};

/**
 * A username the caller supplied, if it is usable.
 *
 * The username is the KOSync account name, so it has to survive the KOSync
 * clients' character set. An unusable value is ignored rather than rejected:
 * the caller asked for an account, and the derived name serves the same
 * purpose.
 */
export const sanitizeUsername = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_USERNAME_PREFIX_LENGTH) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
};

/**
 * Whether a D1 error is a UNIQUE-constraint violation.
 *
 * D1 (SQLite) reports it as `UNIQUE constraint failed: <table>.<column>`; the
 * message is matched loosely so the check survives a wording change.
 */
export const isUniqueViolation = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /UNIQUE constraint failed/i.test(message);
};

/**
 * `POST /api/auth/register` — create an account.
 *
 * Answers `{ token, user: { id, email } }`, the shape the client stores in
 * localStorage and replays as a bearer token.
 *
 * The credential may arrive in either of the two forms the spec allows:
 *
 * - `passphrase` (or `password`) — the plaintext passphrase, over TLS. The
 *   Worker derives both digests from it. This is what the Minerva client
 *   sends.
 * - `passhash` — a SHA-256 digest the caller computed itself. The Worker
 *   stores it as-is. It cannot derive the KOSync account key from it, so such
 *   an account authenticates on the native surface only.
 *
 * `username` is optional: it is the name the account answers to on the
 * KOSync surface. When it is omitted, a unique one is derived from the email.
 */
export const handleRegister = async (request: Request, env: Env): Promise<Response> => {
  const body = await readJson<{
    email?: string;
    username?: string;
    passphrase?: string;
    password?: string;
    passhash?: string;
  }>(request);
  const rawIdentifier = (body?.username ?? body?.email ?? '').trim();
  const passphrase = body?.passphrase ?? body?.password ?? '';
  const suppliedHash = (body?.passhash ?? '').trim().toLowerCase();

  if (!rawIdentifier) return errorJson('email or username is required', 400);

  const id = crypto.randomUUID();
  let email: string;
  let username: string;

  if (rawIdentifier.includes('@')) {
    email = normalizeEmail(rawIdentifier);
    if (!isValidEmail(email)) return errorJson('Invalid email address', 400);
    username = sanitizeUsername(body?.username) ?? deriveKoSyncUsername(email, id);
  } else {
    username = rawIdentifier;
    if (!isValidUsername(username)) {
      return errorJson(
        'Username must be 3-64 characters and contain only letters, numbers, hyphens, dots, or underscores',
        400,
      );
    }
    email = normalizeEmail(body?.email ?? `${username.toLowerCase()}@minerva.local`);
  }

  if (!passphrase && !suppliedHash) {
    return errorJson('email and passphrase are required', 400);
  }
  if (passphrase && passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return errorJson(
      `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long`,
      400,
    );
  }
  if (suppliedHash && !/^[0-9a-f]{64}$/.test(suppliedHash)) {
    return errorJson('passhash must be a SHA-256 digest, hex encoded', 400);
  }
  if (!env.JWT_SECRET) {
    return errorJson('Server is not configured: JWT_SECRET is missing', 503);
  }

  // The registration surface is public: a client may not create accounts in a
  // loop. The edge sets the client address; the deployment-wide ceiling
  // applies even when it does not.
  const clientId = request.headers.get('CF-Connecting-IP') ?? '';
  if (await isRegistrationRateLimited(env, clientId)) {
    return errorJson('Too many accounts created from this client. Try again later.', 429);
  }
  // Every attempt counts, not only the ones that create an account: the
  // endpoint answers a repeated email with a 409, so an attempt that finds
  // the account already there is exactly the probe an enumeration uses.
  await recordRegistration(env, clientId);

  const existing = await env.SYNC_DB.prepare('SELECT id FROM users WHERE email = ? OR username = ?')
    .bind(email, username)
    .first<{ id: string }>();
  if (existing) return errorJson('An account with this email already exists', 409);

  // The passphrase is stretched with a per-account salt: a dump of the table
  // must not be enough to recover it, not even for a weak passphrase. A
  // pre-computed digest cannot be stretched (there is no passphrase to
  // stretch), so such an account keeps the digest it was given.
  const passhash = suppliedHash || (await hashPassphraseForAccount(passphrase, env));
  // The KOSync account key is the MD5 of the passphrase, salted so the stored
  // value is not the credential itself. A pre-computed digest does not carry
  // it, so the account keeps the native surface only.
  const userkey = passphrase
    ? await createKoSyncUserkey(await md5Hex(passphrase))
    : NO_KOSYNC_USERKEY;

  try {
    await env.SYNC_DB.prepare(
      `INSERT INTO users (id, email, username, passhash, userkey, plan)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, email, username, passhash, userkey, 'pro')
      .run();
  } catch (error) {
    // D1 rejects a duplicate email or username with a UNIQUE violation. That
    // is a client error, not a server fault: answer 409 instead of letting the
    // exception escape as a 500 that leaks the schema in the message.
    if (isUniqueViolation(error)) {
      return errorJson('An account with this email already exists', 409);
    }
    throw error;
  }

  const token = await mintToken(env.JWT_SECRET, { userId: id, email, plan: 'pro' });
  return json({ token, user: { id, email, username } }, 201);
};

/**
 * How many failed sign-in attempts an account tolerates before it is locked.
 */
export const MAX_LOGIN_ATTEMPTS = 5;

/**
 * The base lockout, in seconds. Every attempt past the threshold doubles it
 * (up to `MAX_LOCKOUT_SECONDS`), so a persistent attacker keeps hitting a
 * longer wall while an ordinary typo only waits out the base window.
 */
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;

/** The longest lockout the Worker ever grants. */
export const MAX_LOCKOUT_SECONDS = 24 * 60 * 60;

/** How long the account stays locked after `attempts` consecutive failures. */
export const lockoutSecondsFor = (attempts: number): number => {
  const over = Math.max(0, attempts - MAX_LOGIN_ATTEMPTS);
  return Math.min(MAX_LOCKOUT_SECONDS, LOGIN_LOCKOUT_SECONDS * 2 ** over);
};

/**
 * Whether the account is currently locked out after too many failed attempts.
 *
 * The counter lives in D1 so it survives a Worker instance being recycled
 * (and so several instances share it). A locked account answers 429, which the
 * client maps to a generic validation error (`statusToDefaultCode`).
 */
export const isLockedOut = async (env: Env, email: string): Promise<boolean> => {
  const row = await env.SYNC_DB.prepare(
    'SELECT attempts, locked_until FROM login_attempts WHERE email = ?',
  )
    .bind(email)
    .first<{ attempts: number; locked_until: number | null }>();
  if (!row) return false;
  const lockedUntil = Number(row.locked_until ?? 0);
  return lockedUntil > Math.floor(Date.now() / 1000);
};

/**
 * Record a failed sign-in attempt and lock the account once the threshold is
 * reached. The window is sliding: a successful sign-in clears the counter.
 *
 * A lockout that has EXPIRED starts over: the counter must not keep counting,
 * or every later failure would double the penalty for ever (15 min, 30 min,
 * 60 min ... up to 24 h) and the account could never be signed into again.
 */
export const recordFailedAttempt = async (env: Env, email: string): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.SYNC_DB.prepare(
    'SELECT attempts, locked_until FROM login_attempts WHERE email = ?',
  )
    .bind(email)
    .first<{ attempts: number; locked_until: number | null }>();
  const lockedUntilStored = Number(row?.locked_until ?? 0);
  // The lockout is over: the row only carries the leftovers of it.
  const expired = row !== null && lockedUntilStored > 0 && lockedUntilStored <= now;
  const attempts = (expired ? 0 : Number(row?.attempts ?? 0)) + 1;
  const lockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? now + lockoutSecondsFor(attempts) : null;
  if (expired) {
    // The stale row goes first: the UPSERT below keeps the HIGHEST count, so
    // it would otherwise resurrect the old one.
    await env.SYNC_DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
  }
  await env.SYNC_DB.prepare(
    `INSERT INTO login_attempts (email, attempts, locked_until)
     VALUES (?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET
       attempts = MAX(login_attempts.attempts + 1, excluded.attempts),
       locked_until = excluded.locked_until`,
  )
    .bind(email, attempts, lockedUntil)
    .run();
};

/** Clear the failure counter after a successful sign-in. */
export const clearFailedAttempts = async (env: Env, email: string): Promise<void> => {
  await env.SYNC_DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
};

/**
 * Move the failure counter of one account key to another.
 *
 * The counter is keyed by the email, so an account that changes its email
 * would otherwise leave its protection behind on the old address (which
 * nobody can reach any more) and start the new one with a clean slate. The
 * counter is carried over instead, so the change of address neither drops
 * the protection nor hands the account a free reset of it.
 */
export const moveFailedAttempts = async (
  env: Env,
  fromEmail: string,
  toEmail: string,
): Promise<void> => {
  if (fromEmail === toEmail) return;
  const row = await env.SYNC_DB.prepare(
    'SELECT attempts, locked_until FROM login_attempts WHERE email = ?',
  )
    .bind(fromEmail)
    .first<{ attempts: number; locked_until: number | null }>();
  if (!row) return;
  await env.SYNC_DB.prepare(
    `INSERT INTO login_attempts (email, attempts, locked_until)
     VALUES (?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET
       attempts = MAX(login_attempts.attempts, excluded.attempts),
       locked_until = MAX(COALESCE(login_attempts.locked_until, 0), COALESCE(excluded.locked_until, 0))`,
  )
    .bind(
      toEmail,
      Number(row.attempts ?? 0),
      row.locked_until === null ? null : Number(row.locked_until),
    )
    .run();
  await env.SYNC_DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(fromEmail).run();
};

/**
 * How many accounts one client may create inside the registration window.
 */
export const MAX_REGISTRATIONS_PER_WINDOW = 10;

/**
 * How many accounts the whole deployment may create inside the window.
 *
 * The per-client limit only holds as long as the client address is known.
 * The edge sets it, but a deployment reached in another way (or an attacker
 * with a botnet) would still be able to create accounts in a loop, so there is
 * a ceiling for the deployment as well.
 */
export const MAX_REGISTRATIONS_PER_GLOBAL_WINDOW = 20;

/**
 * The registration window, in seconds.
 */
export const REGISTRATION_WINDOW_SECONDS = 60 * 60;

/**
 * The key the registration attempts of a client are counted under.
 *
 * The registration surface is public, so without a limit a script can create
 * accounts in a loop: every account costs the operator a row in `users` — and,
 * with the storage quota, a bucket of its own. The counter is kept in the same
 * table as the sign-in throttling, under a prefixed key so the two never
 * collide.
 */
const registrationAttemptKey = (clientId: string) => `register:${clientId}`;

/** The key the registration attempts of the whole deployment are counted under. */
const GLOBAL_REGISTRATION_KEY = 'register:global';

/**
 * Whether this client (or the deployment as a whole) has already created too
 * many accounts in the current window.
 */
export const isRegistrationRateLimited = async (env: Env, clientId: string): Promise<boolean> => {
  const now = Math.floor(Date.now() / 1000);
  const limits: Array<[string, number]> = [
    [GLOBAL_REGISTRATION_KEY, MAX_REGISTRATIONS_PER_GLOBAL_WINDOW],
  ];
  if (clientId) limits.push([registrationAttemptKey(clientId), MAX_REGISTRATIONS_PER_WINDOW]);
  for (const [key, max] of limits) {
    const row = await env.SYNC_DB.prepare(
      'SELECT attempts, locked_until FROM login_attempts WHERE email = ?',
    )
      .bind(key)
      .first<{ attempts: number; locked_until: number | null }>();
    if (!row) continue;
    // The window is over: the counter starts over.
    if (Number(row.locked_until ?? 0) <= now) continue;
    if (Number(row.attempts ?? 0) >= max) return true;
  }
  return false;
};

/**
 * Count one registration attempt against the client's window and the
 * deployment's.
 *
 * The attempt is counted whether or not it creates an account: the endpoint
 * answers a repeated email with a 409, and an attempt that finds the account
 * already there is the probe an enumeration is made of.
 */
export const recordRegistration = async (env: Env, clientId: string): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const windowEnds = now + REGISTRATION_WINDOW_SECONDS;
  const keys = clientId
    ? [GLOBAL_REGISTRATION_KEY, registrationAttemptKey(clientId)]
    : [GLOBAL_REGISTRATION_KEY];
  for (const key of keys) {
    const row = await env.SYNC_DB.prepare(
      'SELECT attempts, locked_until FROM login_attempts WHERE email = ?',
    )
      .bind(key)
      .first<{ attempts: number; locked_until: number | null }>();
    const stale = !row || Number(row.locked_until ?? 0) <= now;
    const attempts = stale ? 1 : Number(row.attempts ?? 0) + 1;
    await env.SYNC_DB.prepare(
      `INSERT INTO login_attempts (email, attempts, locked_until)
       VALUES (?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET
         attempts = excluded.attempts,
         locked_until = excluded.locked_until`,
    )
      .bind(key, attempts, windowEnds)
      .run();
  }
};

/**
 * `POST /api/auth/login` — exchange the passphrase for a bearer token.
 *
 * The wrong passphrase and the unknown account answer the SAME 401, so the
 * route cannot be used to enumerate which emails have accounts.
 */
export const handleLogin = async (request: Request, env: Env): Promise<Response> => {
  const body = await readJson<{
    email?: string;
    username?: string;
    passphrase?: string;
    password?: string;
    passhash?: string;
  }>(request);
  const rawIdentifier = (body?.username ?? body?.email ?? '').trim();
  const passphrase = body?.passphrase ?? body?.password ?? '';
  const suppliedHash = (body?.passhash ?? '').trim().toLowerCase();

  if (!rawIdentifier || (!passphrase && !suppliedHash)) {
    return errorJson('email and passphrase are required', 400);
  }

  const identifier = rawIdentifier.toLowerCase();
  const isEmail = identifier.includes('@');
  if (isEmail && !isValidEmail(identifier)) {
    return errorJson('Invalid email address', 400);
  }
  if (!isEmail && !isValidUsername(identifier)) {
    return errorJson('Invalid username format', 400);
  }
  if (suppliedHash && !/^[0-9a-f]{64}$/.test(suppliedHash)) {
    return errorJson('passhash must be a SHA-256 digest, hex encoded', 400);
  }
  if (!env.JWT_SECRET) {
    return errorJson('Server is not configured: JWT_SECRET is missing', 503);
  }

  // Too many failed attempts: refuse before touching the credential at all.
  if (await isLockedOut(env, identifier)) {
    return errorJson('Too many failed sign-in attempts. Try again later.', 429);
  }

  const synthEmail = isEmail ? identifier : `${identifier}@minerva.local`;
  const row = await env.SYNC_DB.prepare(
    'SELECT id, email, username, passhash, userkey, plan, storage_usage_bytes, storage_purchased_bytes FROM users WHERE email = ? OR username = ? OR email = ?',
  )
    .bind(identifier, identifier, synthEmail)
    .first<{
      id: string;
      email: string;
      username: string;
      passhash: string;
      userkey: string;
      plan: string;
      storage_usage_bytes: number;
      storage_purchased_bytes: number;
    }>();
  if (!row) {
    // An unknown account and a wrong passphrase must look alike, but the
    // attempt is still counted so a script cannot probe an address forever.
    await recordFailedAttempt(env, identifier);
    return errorJson('Invalid credentials', 401);
  }

  // A pre-computed digest can only be compared with the digest it is, so it
  // only works for an account that was created that way. Everything else is
  // verified with the passphrase.
  const accepted = suppliedHash
    ? safeEqual(suppliedHash, row.passhash)
    : await verifyPassphrase(passphrase, row.passhash);
  if (!accepted) {
    await recordFailedAttempt(env, identifier);
    return errorJson('Invalid credentials', 401);
  }

  await clearFailedAttempts(env, identifier);
  if (row.email && row.email !== identifier) await clearFailedAttempts(env, row.email);
  if (row.username && row.username !== identifier) await clearFailedAttempts(env, row.username);

  if (!suppliedHash) await upgradeLegacyCredentials(env, row, passphrase);
  const token = await mintToken(env.JWT_SECRET, {
    userId: row.id,
    email: row.email,
    plan: row.plan,
    storageUsageBytes: row.storage_usage_bytes,
    storagePurchasedBytes: row.storage_purchased_bytes,
  });
  return json({ token, user: { id: row.id, email: row.email, username: row.username } });
};

/**
 * Re-stretch the credentials of an account created before the change.
 *
 * Rows written by an older Worker hold an unsalted SHA-256 of the passphrase
 * and the bare MD5 of it. The first sign-in with the passphrase replaces them
 * with the stretched and salted values, so a deployment does not need a
 * migration: the accounts keep working and the table stops holding the weak
 * digests one account at a time.
 */
const upgradeLegacyCredentials = async (
  env: Env,
  row: { id: string; passhash: string; userkey: string },
  passphrase: string,
): Promise<void> => {
  const stretched = isLegacyPassphraseHash(row.passhash);
  const salted = !isKoSyncUserkey(row.userkey) && /^[0-9a-f]{32}$/.test(row.userkey);
  if (!stretched && !salted) return;
  const passhash = stretched ? await hashPassphraseForAccount(passphrase, env) : row.passhash;
  const userkey = salted ? await createKoSyncUserkey(await md5Hex(passphrase)) : row.userkey;
  await env.SYNC_DB.prepare('UPDATE users SET passhash = ?, userkey = ? WHERE id = ?')
    .bind(passhash, userkey, row.id)
    .run();
};

/**
 * `GET /api/auth/me` — the signed-in account.
 *
 * Lets the client verify a stored token on boot without a round trip to a
 * separate identity provider.
 */
export const handleMe = async (env: Env, userId: string): Promise<Response> => {
  const row = await env.SYNC_DB.prepare('SELECT id, email, username, plan FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; username: string; plan: string }>();
  if (!row) return errorJson('Not authenticated', 403);
  return json({ user: { id: row.id, email: row.email, username: row.username }, plan: row.plan });
};

/**
 * `POST /api/auth/email` — change the account email.
 *
 * A self-hosted deployment has no mail server, so the address is changed
 * directly: the account keeps working with the new one and the old address
 * stops being able to sign in.
 *
 * Changing the identity of an account is a credential operation, so it
 * re-validates the passphrase: a session token on its own (which lives in
 * `localStorage` for 30 days and can be stolen by an extension, an XSS or a
 * shared machine) must not be enough to re-point the account at an address
 * somebody else controls.
 *
 * The sign-in throttle travels with the account: the counter is keyed by the
 * email, so it is moved to the new key instead of being left behind on the
 * old one (where it would keep a dead address busy) and instead of leaving
 * the new address with a clean slate.
 */
export const handleUpdateEmail = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const body = await readJson<{
    email?: string;
    passphrase?: string;
    password?: string;
    passhash?: string;
  }>(request);
  const email = normalizeEmail(body?.email ?? '');
  if (!email) return errorJson('email is required', 400);
  if (!isValidEmail(email)) return errorJson('Invalid email address', 400);

  const current = await env.SYNC_DB.prepare('SELECT id, email, passhash FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; passhash: string }>();
  if (!current) return errorJson('Not authenticated', 401);

  // The passphrase (or its pre-computed digest) has to match the account's.
  const passphrase = body?.passphrase ?? body?.password ?? '';
  const suppliedHash = (body?.passhash ?? '').trim().toLowerCase();
  if (!passphrase && !suppliedHash) {
    return errorJson('passphrase is required to change the account email', 400);
  }
  if (suppliedHash && !/^[0-9a-f]{64}$/.test(suppliedHash)) {
    return errorJson('passhash must be a SHA-256 digest, hex encoded', 400);
  }
  const accepted = suppliedHash
    ? safeEqual(suppliedHash, current.passhash)
    : await verifyPassphrase(passphrase, current.passhash);
  if (!accepted) {
    // The wrong passphrase is a failed attempt on the account, like a failed
    // sign-in: it counts against the throttle.
    await recordFailedAttempt(env, current.email);
    return errorJson('Invalid credentials', 401);
  }

  const taken = await env.SYNC_DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .bind(email, userId)
    .first<{ id: string }>();
  if (taken) return errorJson('An account with this email already exists', 409);

  await env.SYNC_DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, userId).run();

  // The throttle moves with the account: the counter of the old address is
  // carried over to the new one, so the change neither loses the protection
  // nor gives the account a clean slate.
  if (current.email !== email) {
    await moveFailedAttempts(env, current.email, email);
  }
  return json({ user: { id: userId, email } });
};

/**
 * `DELETE /api/user/delete` — remove the account and everything it owns.
 */
export const handleDeleteAccount = async (env: Env, userId: string): Promise<Response> => {
  const db = env.SYNC_DB;
  // Remove the R2 objects first: the database rows are cheap to lose, the
  // objects are not.
  const { results: files } = await db
    .prepare('SELECT file_key FROM files WHERE user_id = ?')
    .bind(userId)
    .all<{ file_key: string }>();
  for (const file of files ?? []) {
    await env.LIBRARY_BUCKET.delete(file.file_key);
  }

  await db.batch([
    db.prepare('DELETE FROM books WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM book_configs WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM book_notes WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM files WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM stat_books WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM stat_pages WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM replicas WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM replica_keys WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM kosync_progress WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(await emailOfUser(env, userId)),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);

  return json({ deleted: true });
};

/** The email of an account, used to clear its sign-in throttle. */
const emailOfUser = async (env: Env, userId: string): Promise<string> => {
  const row = await env.SYNC_DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>();
  return row?.email ?? '';
};

/**
 * `DELETE /api/user/library` — clear the cloud library, keep the account.
 *
 * Only the `books` rows are removed, and they are removed HARD rather than
 * tombstoned: a tombstone would pull down to every other signed-in device
 * and clear its local library too. The configs, notes and files are keyed by
 * `book_hash`, not by `books`, so they are left behind and line up again if
 * the same book is ever re-added.
 */
export const handleDeleteLibrary = async (env: Env, userId: string): Promise<Response> => {
  await env.SYNC_DB.prepare('DELETE FROM books WHERE user_id = ?').bind(userId).run();
  return json({ deleted: true, message: 'Cloud library deleted successfully' });
};
