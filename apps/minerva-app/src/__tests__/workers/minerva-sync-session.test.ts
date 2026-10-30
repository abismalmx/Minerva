/**
 * @vitest-environment node
 *
 * Security regression tests for the self-hosted sync Worker
 * (apps/minerva-app/workers/minerva-sync), added by the security audit of
 * 2026-10-29 (BACKEND_SPEC_2 / Minerva).
 *
 * They run the Worker's own migrations on a real SQLite database, so the
 * account rows and the sessions behave exactly as they do in D1.
 *
 * - SEC-06: deleting an account ends its sessions. The access token is
 *   self-contained and lives for 30 days, so without a check against the
 *   account table the token of a deleted account keeps authorizing the sync
 *   API.
 * - SEC-07: a failing request answers a generic message. The internal error
 *   (schema, table names, driver codes) stays in the log instead of being
 *   handed to the caller.
 */
import { describe, it, expect } from 'vitest';

import { handleDeleteAccount, handleRegister } from '../../../workers/minerva-sync/src/accounts';
import { mintToken } from '../../../workers/minerva-sync/src/auth';
import { routeRequest } from '../../../workers/minerva-sync/src/routes';
import worker from '../../../workers/minerva-sync/src/index';
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

describe('SEC-06: la baja de la cuenta revoca sus sesiones', () => {
  it('el token de una cuenta borrada ya no autoriza la sincronizacion', async () => {
    const env = makeEnv();
    const registered = await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'alice@example.com', passphrase: PASSPHRASE })),
      env as never,
    );
    const { token, user } = (await registered.json()) as { token: string; user: { id: string } };

    const deleted = await handleDeleteAccount(env as never, user.id);
    expect(deleted.status).toBe(200);

    const accounts = await env.SYNC_DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(user.id)
      .all();
    expect(accounts.results).toHaveLength(0);

    const response = await routeRequest(
      req('/api/sync?since=0', { headers: { authorization: `Bearer ${token}` } }),
      env as never,
      '/api/sync',
    );
    expect(response.status).toBe(401);
  });

  it('el token de una cuenta viva sigue authorizing la sincronizacion', async () => {
    const env = makeEnv();
    const registered = await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'bob@example.com', passphrase: PASSPHRASE })),
      env as never,
    );
    const { token } = (await registered.json()) as { token: string };

    const response = await routeRequest(
      req('/api/sync?since=0', { headers: { authorization: `Bearer ${token}` } }),
      env as never,
      '/api/sync',
    );
    expect(response.status).toBe(200);
  });
});

describe('SEC-07: un fallo no filtra el mensaje interno de la excepcion', () => {
  it('un 500 responde un mensaje generico', async () => {
    const token = await mintToken(TEST_SECRET, { userId: 'ghost', email: 'ghost@example.com' });
    const brokenEnv = {
      JWT_SECRET: TEST_SECRET,
      ALLOWED_ORIGINS: '*',
      SYNC_DB: {
        prepare: () => {
          throw new Error('D1_ERROR: no such table: users (SQLITE_ERROR)');
        },
      },
      LIBRARY_BUCKET: new MemoryR2(),
    };

    const response = await worker.fetch(
      req('/api/sync?since=0', { headers: { authorization: `Bearer ${token}` } }),
      brokenEnv as never,
    );
    const body = (await response.json()) as { error?: string };
    expect(response.status).toBe(500);
    expect(body.error ?? '').not.toContain('SQLITE_ERROR');
    expect(body.error ?? '').not.toContain('no such table');
  });
});
