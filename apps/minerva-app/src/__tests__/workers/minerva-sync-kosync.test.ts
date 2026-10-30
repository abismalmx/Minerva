/**
 * @vitest-environment node
 *
 * The KOSync surface runs against the Worker's own migrations on a real
 * SQLite database, because the progress table's existence and its primary key
 * are exactly what the tests have to pin down.
 */
import { describe, it, expect } from 'vitest';

import {
  authenticateKoSync,
  handleKoSyncAuth,
  handleKoSyncCreate,
  handleKoSyncProgressGet,
  handleKoSyncProgressPut,
} from '../../../workers/minerva-sync/src/kosync';
import { handleRegister } from '../../../workers/minerva-sync/src/accounts';
import { md5Hex } from '../../../workers/minerva-sync/src/crypto';
import { MemoryR2, SqliteD1, TEST_SECRET } from './minerva-sync-doubles';

interface TestEnv {
  JWT_SECRET: string;
  // The PBKDF2 cost of the real deployment (600 000) is paid on every
  // registration and sign-in; the suite runs the same code with a cost that
  // keeps it fast. `minerva-sync-kdf.test.ts` checks the production default.
  PASSPHRASE_KDF_ITERATIONS: string;
  ALLOWED_ORIGINS: string;
  MAX_UPLOAD_BYTES: string;
  STORAGE_FIXED_QUOTA: string;
  SYNC_DB: SqliteD1;
  LIBRARY_BUCKET: MemoryR2;
}

const makeEnv = (): TestEnv => ({
  JWT_SECRET: TEST_SECRET,
  PASSPHRASE_KDF_ITERATIONS: '10000',
  ALLOWED_ORIGINS: '*',
  MAX_UPLOAD_BYTES: '104857600',
  STORAGE_FIXED_QUOTA: '0',
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

const PASSPHRASE = 'correct horse battery staple';

describe('la superficie KOSync', () => {
  it('crea la cuenta y autentica con el digest MD5', async () => {
    const env = makeEnv();
    const digest = await md5Hex(PASSPHRASE);

    const create = await handleKoSyncCreate(
      req('/users/create', jsonBody({ username: 'kreader', password: digest })),
      env as never,
    );
    expect(create.status).toBe(201);

    const auth = await handleKoSyncAuth(
      req('/users/auth', { headers: { 'x-auth-user': 'kreader', 'x-auth-key': digest } }),
      env as never,
    );
    expect(auth.status).toBe(200);
    const body = (await auth.json()) as { authorized: string };
    expect(body.authorized).toBe('OK');
  });

  it('la cuenta nativa tambien sirve en la superficie KOSync', async () => {
    const env = makeEnv();
    const register = await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'alice@example.com', passphrase: PASSPHRASE })),
      env as never,
    );
    expect(register.status).toBe(201);

    const digest = await md5Hex(PASSPHRASE);
    const user = await authenticateKoSync(
      env as never,
      req('/users/auth', { headers: { 'x-auth-user': 'alice@example.com', 'x-auth-key': digest } }),
    );
    expect(user).not.toBeNull();
    expect(user!.username).toContain('alice');
  });

  it('guarda y devuelve la posicion de lectura', async () => {
    const env = makeEnv();
    const digest = await md5Hex(PASSPHRASE);
    await handleKoSyncCreate(
      req('/users/create', jsonBody({ username: 'kreader', password: digest })),
      env as never,
    );
    const user = await authenticateKoSync(
      env as never,
      req('/users/auth', { headers: { 'x-auth-user': 'kreader', 'x-auth-key': digest } }),
    );
    expect(user).not.toBeNull();

    // The progress table has to EXIST: the migrations create it. A schema
    // that dropped it made every progress write fail with "no such table".
    const put = await handleKoSyncProgressPut(
      req(
        '/syncs/progress',
        jsonBody({
          document: 'd41d8cd98f00b204e9800998ecf8427e',
          progress: '/body/DocFragment[3]/body/div/p[2]/text()[0]',
          percentage: 42.5,
          device: 'kobo',
          device_id: 'device-1',
        }),
      ),
      env as never,
      user!,
    );
    expect(put.status).toBe(200);

    const get = await handleKoSyncProgressGet(
      env as never,
      user!,
      'd41d8cd98f00b204e9800998ecf8427e',
    );
    expect(get.status).toBe(200);
    const body = (await get.json()) as {
      document: string;
      progress: string;
      percentage: number;
      device: string;
    };
    expect(body.document).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(body.progress).toContain('DocFragment');
    expect(body.percentage).toBe(42.5);
    expect(body.device).toBe('kobo');
  });

  it('un documento sin posicion responde 404', async () => {
    const env = makeEnv();
    const digest = await md5Hex(PASSPHRASE);
    await handleKoSyncCreate(
      req('/users/create', jsonBody({ username: 'kreader', password: digest })),
      env as never,
    );
    const user = await authenticateKoSync(
      env as never,
      req('/users/auth', { headers: { 'x-auth-user': 'kreader', 'x-auth-key': digest } }),
    );

    const get = await handleKoSyncProgressGet(env as never, user!, 'unknown-document');
    expect(get.status).toBe(404);
  });
});
