/**
 * @vitest-environment node
 *
 * H-02: the account passphrase was stored as an unsalted SHA-256 and the
 * KOSync account key as the bare MD5 of it.
 *
 * A dump of the D1 table was then enough to recover a weak passphrase at
 * GPU speed, and the stored KOSync key *was* the credential: whoever read the
 * table could authenticate against the KOSync surface without knowing
 * anything else.
 *
 * The passphrase is now stretched with PBKDF2-HMAC-SHA256 and salted per
 * account, and the KOSync key is salted. The format is marked in the value
 * itself, so an account created before the change keeps working and is
 * re-stretched the first time its owner signs in: the table needs no
 * migration.
 */
import { describe, expect, it } from 'vitest';

import { handleLogin, handleRegister } from '../../../workers/minerva-sync/src/accounts';
import { authenticateKoSync, handleKoSyncAuth } from '../../../workers/minerva-sync/src/kosync';
import {
  md5Hex,
  PASSPHRASE_KDF_ITERATIONS,
  sha256Hex,
} from '../../../workers/minerva-sync/src/crypto';
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
    expect(one?.passhash).toMatch(/^pbkdf2-sha256\$\d+\$/);
    // Two accounts with the SAME passphrase do not share a stored value: the
    // salt is per account, so a table of digests cannot be attacked with one
    // precomputed table.
    expect(one?.passhash).not.toBe(two?.passhash);
    // The unsalted digest of the passphrase is nowhere in the row.
    const digest = await sha256Hex(PASSPHRASE);
    expect(one?.passhash).not.toContain(digest);
    expect(String(one?.userkey)).not.toContain(await md5Hex(PASSPHRASE));
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
    // passphrase and the bare MD5 of it.
    await env.SYNC_DB.prepare(
      `INSERT INTO users (id, email, username, passhash, userkey, plan)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        '11111111-2222-3333-4444-555555555555',
        'legacy@example.com',
        'legacy',
        await sha256Hex(PASSPHRASE),
        await md5Hex(PASSPHRASE),
        'free',
      )
      .run();

    expect((await login(env, 'legacy@example.com')).status).toBe(200);

    const upgraded = await storedRow(env, 'legacy@example.com');
    expect(upgraded?.passhash).toMatch(/^pbkdf2-sha256\$/);
    expect(upgraded?.passhash).not.toBe(await sha256Hex(PASSPHRASE));
    expect(String(upgraded?.userkey)).toMatch(/^kosync-sha256\$/);
  });

  it('la superficie KOSync sigue autenticando con el MD5 de la passphrase', async () => {
    const env = makeEnv();
    await register(env, 'alice@example.com');
    const md5 = await md5Hex(PASSPHRASE);

    // The stored key is not the credential: it is salted.
    const row = await storedRow(env, 'alice@example.com');
    expect(row?.userkey).not.toBe(md5);

    const auth = await handleKoSyncAuth(
      req('/users/auth', { headers: { 'x-auth-user': 'alice@example.com', 'x-auth-key': md5 } }),
      env as never,
    );
    expect(auth.status).toBe(200);

    // A wrong key is still refused.
    const wrong = await authenticateKoSync(
      env as never,
      req('/users/auth', {
        headers: { 'x-auth-user': 'alice@example.com', 'x-auth-key': 'b'.repeat(32) },
      }),
    );
    expect(wrong).toBeNull();
  });

  it('una cuenta antigua sigue entrando por la superficie KOSync', async () => {
    const env = makeEnv();
    await env.SYNC_DB.prepare(
      `INSERT INTO users (id, email, username, passhash, userkey, plan)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        '11111111-2222-3333-4444-555555555555',
        'legacy@example.com',
        'legacy',
        await sha256Hex(PASSPHRASE),
        await md5Hex(PASSPHRASE),
        'free',
      )
      .run();

    const md5 = await md5Hex(PASSPHRASE);
    const user = await authenticateKoSync(
      env as never,
      req('/users/auth', {
        headers: { 'x-auth-user': 'legacy@example.com', 'x-auth-key': md5 },
      }),
    );
    expect(user).not.toBeNull();
  });
});
