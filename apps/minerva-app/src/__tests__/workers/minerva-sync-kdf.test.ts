/**
 * @vitest-environment node
 *
 * H-02: the account passphrase was stored as an unsalted SHA-256, and the
 * KOSync-era `userkey` column held the bare MD5 of it.
 *
 * A dump of the D1 table was then enough to recover a weak passphrase at
 * GPU speed.
 *
 * The passphrase is now stretched with PBKDF2-HMAC-SHA256 and salted per
 * account, and `userkey` holds only a sentinel. The format is marked in the
 * value itself, so an account created before the change keeps working and is
 * re-stretched, and its `userkey` cleared, the first time its owner signs in:
 * the table needs no migration.
 */
import { describe, expect, it } from 'vitest';

import {
  handleLogin,
  handleRegister,
  UNUSED_USERKEY,
} from '../../../workers/minerva-sync/src/accounts';
import { PASSPHRASE_KDF_ITERATIONS, sha256Hex } from '../../../workers/minerva-sync/src/crypto';

// The bare MD5 an older Worker stored in `users.userkey` (md5('a')).
const LEGACY_MD5_USERKEY = '0cc175b9c0f1b6a831c399e269772661';
import { MemoryR2, SqliteD1, TEST_SECRET } from './minerva-sync-doubles';

interface TestEnv {
  JWT_SECRET: string;
  PASSPHRASE_KDF_ITERATIONS: string;
  ALLOWED_ORIGINS: string;
  SYNC_DB: SqliteD1;
  LIBRARY_BUCKET: MemoryR2;
}

const makeEnv = (): TestEnv => ({
  JWT_SECRET: TEST_SECRET,
  // The production cost (600 000) is paid on every registration and sign-in;
  // the suite runs the same code with a cost that keeps it fast.
  PASSPHRASE_KDF_ITERATIONS: '10000',
  ALLOWED_ORIGINS: '*',
  SYNC_DB: SqliteD1.withMigrations(),
  LIBRARY_BUCKET: new MemoryR2(),
});

const req = (url: string, init: RequestInit = {}) =>
  new Request(url.startsWith('http') ? url : `https://worker.test${url}`, init);

const jsonBody = (obj: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

const PASSPHRASE = 'a passphrase long enough';

const register = async (env: TestEnv, email: string, passphrase = PASSPHRASE) =>
  handleRegister(req('/api/auth/register', jsonBody({ email, passphrase })), env as never);

const login = async (env: TestEnv, email: string, passphrase = PASSPHRASE) =>
  handleLogin(req('/api/auth/login', jsonBody({ email, passphrase })), env as never);

const storedRow = async (env: TestEnv, email: string) =>
  env.SYNC_DB.prepare('SELECT passhash, userkey FROM users WHERE email = ?')
    .bind(email)
    .first<{ passhash: string; userkey: string }>();

describe('H-02: la passphrase de la cuenta se guarda estirada y con sal', () => {
  it('el coste por defecto es el que recomienda OWASP', () => {
    expect(PASSPHRASE_KDF_ITERATIONS).toBe(600_000);
  });

  it('guarda un PBKDF2 con sal propia de cada cuenta', async () => {
    const env = makeEnv();
    expect((await register(env, 'one@example.com')).status).toBe(201);
    expect((await register(env, 'two@example.com')).status).toBe(201);

    const one = await storedRow(env, 'one@example.com');
    const two = await storedRow(env, 'two@example.com');
    expect(one?.passhash).toMatch(/^(argon2id|pbkdf2-sha256)\$/);
    // Two accounts with the SAME passphrase do not share a stored value: the
    // salt is per account, so a table of digests cannot be attacked with one
    // precomputed table.
    expect(one?.passhash).not.toBe(two?.passhash);
    // The unsalted digest of the passphrase is nowhere in the row.
    const digest = await sha256Hex(PASSPHRASE);
    expect(one?.passhash).not.toContain(digest);
    // No credential-derived value is stored beside it.
    expect(one?.userkey).toBe(UNUSED_USERKEY);
  });

  it('acepta la passphrase correcta y rechaza las demás', async () => {
    const env = makeEnv();
    await register(env, 'alice@example.com');

    expect((await login(env, 'alice@example.com')).status).toBe(200);
    expect((await login(env, 'alice@example.com', 'another passphrase')).status).toBe(401);
  });

  it('una cuenta creada antes del cambio entra y se re-estira en el sitio', async () => {
    const env = makeEnv();
    // A row as an older Worker wrote it: the unsalted SHA-256 of the
    // passphrase and a digest of it in `userkey`.
    await env.SYNC_DB.prepare(
      `INSERT INTO users (id, email, username, passhash, userkey, plan)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        '11111111-2222-3333-4444-555555555555',
        'legacy@example.com',
        'legacy',
        await sha256Hex(PASSPHRASE),
        LEGACY_MD5_USERKEY,
        'free',
      )
      .run();

    expect((await login(env, 'legacy@example.com')).status).toBe(200);

    const upgraded = await storedRow(env, 'legacy@example.com');
    expect(upgraded?.passhash).toMatch(/^(argon2id|pbkdf2-sha256)\$/);
    expect(upgraded?.passhash).not.toBe(await sha256Hex(PASSPHRASE));
    expect(upgraded?.userkey).toBe(UNUSED_USERKEY);
  });

  it('limpia el userkey de una cuenta con passhash ya estirado', async () => {
    const env = makeEnv();
    await register(env, 'alice@example.com');
    // A KOSync-era account whose passhash was already re-stretched but whose
    // userkey still holds a salted digest of the passphrase.
    await env.SYNC_DB.prepare('UPDATE users SET userkey = ? WHERE email = ?')
      .bind('kosync-sha256$salt$hash', 'alice@example.com')
      .run();

    expect((await login(env, 'alice@example.com')).status).toBe(200);
    expect((await storedRow(env, 'alice@example.com'))?.userkey).toBe(UNUSED_USERKEY);
  });
});
