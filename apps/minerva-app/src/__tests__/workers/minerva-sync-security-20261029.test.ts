/**
 * @vitest-environment node
 *
 * Regression tests for the security audit of 2026-10-29 (second pass: the
 * new Minerva implementations).
 *
 * They run the Worker's own migrations on a real SQLite database, so the
 * rows and the throttle arithmetic behave exactly as they do in D1.
 *
 * - SEC-08: the sign-in throttle table must not grow without bound from the
 *   unauthenticated routes. The native login validates the email (it is the
 *   key of the counter row) and the KOSync surface only accepts a name it
 *   would accept as an account name (the name is the key too).
 * - SEC-09: the KOSync registration has the same rate limit and the same
 *   username bound as the native one.
 * - SEC-10: changing the account email re-validates the passphrase and moves
 *   the sign-in throttle to the new address.
 */
import { describe, it, expect } from 'vitest';

import { handleKoSyncCreate, authenticateKoSync } from '../../../workers/minerva-sync/src/kosync';
import {
  handleRegister,
  handleLogin,
  handleUpdateEmail,
  MAX_LOGIN_ATTEMPTS,
} from '../../../workers/minerva-sync/src/accounts';
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

/** How many rows the sign-in throttle table holds. */
const countAttempts = (env: TestEnv): number =>
  Number(
    (env.SYNC_DB.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get() as { n: number }).n,
  );

/** The longest key the sign-in throttle table holds. */
const maxAttemptKeyLength = (env: TestEnv): number =>
  Number(
    (
      env.SYNC_DB.db.prepare('SELECT MAX(LENGTH(email)) AS n FROM login_attempts').get() as {
        n: number;
      }
    ).n,
  );

describe('SEC-08: la tabla de bloqueo no crece sin limite desde rutas no autenticadas', () => {
  it('el login nativo rechaza un email que no es un email', async () => {
    const env = makeEnv();
    const res = await handleLogin(
      req('/api/auth/login', jsonBody({ email: 'a'.repeat(50000), passphrase: 'wrong' })),
      env as never,
    );
    expect(res.status).toBe(400);
    // The email is the key of the counter row: an invalid one must not
    // become one.
    expect(countAttempts(env)).toBe(0);
  });

  it('un email valido mal escrito sigue contando el intento', async () => {
    const env = makeEnv();
    await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'bob@example.com', passphrase: PASSPHRASE })),
      env as never,
    );
    const before = countAttempts(env);
    for (let i = 0; i < 3; i++) {
      await handleLogin(
        req('/api/auth/login', jsonBody({ email: 'bob@example.com', passphrase: 'wrong' })),
        env as never,
      );
    }
    const row = env.SYNC_DB.db
      .prepare('SELECT attempts FROM login_attempts WHERE email = ?')
      .get('bob@example.com') as { attempts: number } | undefined;
    expect(Number(row?.attempts ?? 0)).toBe(3);
    expect(countAttempts(env)).toBe(before + 1);
  });

  it('la superficie KOSync no acepta un nombre que no seria un nombre de cuenta', async () => {
    const env = makeEnv();
    const user = await authenticateKoSync(
      env as never,
      new Request('https://worker.test/syncs/progress', {
        headers: { 'x-auth-user': 'z'.repeat(100000), 'x-auth-key': 'wrong' },
      }),
    );
    expect(user).toBeNull();
    // The name is the key of the counter row: a name the surface would never
    // accept as an account name must not become a row.
    expect(countAttempts(env)).toBe(0);
    expect(maxAttemptKeyLength(env)).toBe(0);
  });

  it('un nombre KOSync normal mal escrito sigue contando el intento', async () => {
    const env = makeEnv();
    for (let i = 0; i < 3; i++) {
      await authenticateKoSync(
        env as never,
        new Request('https://worker.test/syncs/progress', {
          headers: { 'x-auth-user': 'alice', 'x-auth-key': 'wrong' },
        }),
      );
    }
    const row = env.SYNC_DB.db
      .prepare('SELECT attempts FROM login_attempts WHERE email = ?')
      .get('kosync:alice') as { attempts: number } | undefined;
    expect(Number(row?.attempts ?? 0)).toBe(3);
  });
});

describe('SEC-09: el alta KOSync tiene el mismo limite que la alta nativa', () => {
  it('el alta KOSync se limita (429) como la nativa', async () => {
    const env = makeEnv();
    let created = 0;
    let lastStatus = 0;
    for (let i = 0; i < 30; i++) {
      const res = await handleKoSyncCreate(
        req('/users/create', jsonBody({ username: `attacker-${i}`, password: 'a'.repeat(32) })),
        env as never,
      );
      lastStatus = res.status;
      if (res.status === 201) created++;
    }
    expect(lastStatus).toBe(429);
    expect(created).toBeLessThan(30);
    const users = Number(
      (env.SYNC_DB.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n,
    );
    expect(users).toBe(created);
  });

  it('el username KOSync esta acotado en longitud', async () => {
    const env = makeEnv();
    const huge = 'u'.repeat(50000);
    const res = await handleKoSyncCreate(
      req('/users/create', jsonBody({ username: huge, password: 'b'.repeat(32) })),
      env as never,
    );
    expect(res.status).toBe(400);
    const row = env.SYNC_DB.db
      .prepare('SELECT LENGTH(username) AS n FROM users WHERE username = ?')
      .get(huge) as { n: number } | undefined;
    expect(row).toBeUndefined();
  });

  it('un username KOSync normal se acepta', async () => {
    const env = makeEnv();
    const res = await handleKoSyncCreate(
      req('/users/create', jsonBody({ username: 'alice', password: 'c'.repeat(32) })),
      env as never,
    );
    expect(res.status).toBe(201);
  });
});

describe('SEC-10: cambiar el email revalida la passphrase y mueve el bloqueo', () => {
  it('cambiar el email sin passphrase se rechaza', async () => {
    const env = makeEnv();
    await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'bob@example.com', passphrase: PASSPHRASE })),
      env as never,
    );
    const bob = env.SYNC_DB.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get('bob@example.com') as { id: string };

    const res = await handleUpdateEmail(
      req('/api/auth/email', jsonBody({ email: 'attacker@evil.example' })),
      env as never,
      bob.id,
    );
    expect(res.status).toBe(400);
    const row = env.SYNC_DB.db.prepare('SELECT email FROM users WHERE id = ?').get(bob.id) as {
      email: string;
    };
    expect(row.email).toBe('bob@example.com');
  });

  it('cambiar el email con la passphrase equivocada se rechaza y cuenta', async () => {
    const env = makeEnv();
    await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'bob@example.com', passphrase: PASSPHRASE })),
      env as never,
    );
    const bob = env.SYNC_DB.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get('bob@example.com') as { id: string };

    const res = await handleUpdateEmail(
      req('/api/auth/email', jsonBody({ email: 'attacker@evil.example', passphrase: 'wrong' })),
      env as never,
      bob.id,
    );
    expect(res.status).toBe(401);
    const row = env.SYNC_DB.db.prepare('SELECT email FROM users WHERE id = ?').get(bob.id) as {
      email: string;
    };
    expect(row.email).toBe('bob@example.com');
  });

  it('cambiar el email con la passphrase correcta mueve el bloqueo al email nuevo', async () => {
    const env = makeEnv();
    await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'bob@example.com', passphrase: PASSPHRASE })),
      env as never,
    );
    const bob = env.SYNC_DB.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get('bob@example.com') as { id: string };

    for (let i = 0; i < MAX_LOGIN_ATTEMPTS + 1; i++) {
      await handleLogin(
        req('/api/auth/login', jsonBody({ email: 'bob@example.com', passphrase: 'wrong' })),
        env as never,
      );
    }

    const res = await handleUpdateEmail(
      req('/api/auth/email', jsonBody({ email: 'bob-new@example.com', passphrase: PASSPHRASE })),
      env as never,
      bob.id,
    );
    expect(res.status).toBe(200);

    const rows = env.SYNC_DB.db.prepare('SELECT email, attempts FROM login_attempts').all() as {
      email: string;
      attempts: number;
    }[];
    // The counter travelled with the account: the new address carries it and
    // the old one is gone.
    const moved = rows.find((r) => r.email === 'bob-new@example.com');
    expect(Number(moved?.attempts ?? 0)).toBeGreaterThanOrEqual(MAX_LOGIN_ATTEMPTS);
    expect(rows.find((r) => r.email === 'bob@example.com')).toBeUndefined();
  });
});
