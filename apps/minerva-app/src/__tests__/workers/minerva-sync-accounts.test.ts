/**
 * @vitest-environment node
 *
 * The account tests need the Node environment: they run the Worker's own
 * migrations on a real SQLite database, so the throttling table, the UNIQUE
 * indexes and the account rows behave exactly as they do in D1.
 */
import { describe, it, expect } from 'vitest';

import {
  handleDeleteAccount,
  handleDeleteLibrary,
  handleLogin,
  handleRegister,
  MAX_LOGIN_ATTEMPTS,
  MAX_REGISTRATIONS_PER_GLOBAL_WINDOW,
  UNUSED_USERKEY,
} from '../../../workers/minerva-sync/src/accounts';
import { sha256Hex } from '../../../workers/minerva-sync/src/crypto';
import { verifyToken } from '../../../workers/minerva-sync/src/auth';
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

const register = (env: TestEnv, email: string, passphrase = PASSPHRASE) =>
  handleRegister(req('/api/auth/register', jsonBody({ email, passphrase })), env as never);

const login = (env: TestEnv, email: string, passphrase: string) =>
  handleLogin(req('/api/auth/login', jsonBody({ email, passphrase })), env as never);

describe('las cuentas nativas', () => {
  it('el alta emite un JWT verificable', async () => {
    const env = makeEnv();
    const response = await register(env, 'alice@example.com');
    expect(response.status).toBe(201);

    const body = (await response.json()) as { token: string; user: { id: string; email: string } };
    expect(body.user.email).toBe('alice@example.com');

    const claims = await verifyToken(TEST_SECRET, body.token);
    expect(claims?.sub).toBe(body.user.id);
    expect(claims?.email).toBe('alice@example.com');
    expect(claims?.role).toBe('authenticated');
  });

  it('el inicio de sesión emite un JWT verificable', async () => {
    const env = makeEnv();
    await register(env, 'alice@example.com');
    const response = await login(env, 'alice@example.com', PASSPHRASE);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { token: string };
    const claims = await verifyToken(TEST_SECRET, body.token);
    expect(claims?.email).toBe('alice@example.com');
  });

  it('permite registrarse e iniciar sesión únicamente con un nombre de usuario (sin correo)', async () => {
    const env = makeEnv();
    const regResp = await handleRegister(
      req('/api/auth/register', jsonBody({ username: 'bob_reader', passphrase: PASSPHRASE })),
      env as never,
    );
    expect(regResp.status).toBe(201);
    const regBody = (await regResp.json()) as {
      token: string;
      user: { id: string; email: string; username: string };
    };
    expect(regBody.user.username).toBe('bob_reader');

    // Inicia sesión solo con username
    const loginResp = await handleLogin(
      req('/api/auth/login', jsonBody({ username: 'bob_reader', passphrase: PASSPHRASE })),
      env as never,
    );
    expect(loginResp.status).toBe(200);
    const loginBody = (await loginResp.json()) as {
      token: string;
      user: { id: string; email: string; username: string };
    };
    expect(loginBody.user.username).toBe('bob_reader');
  });

  it('rechaza un nombre de usuario repetido con 409', async () => {
    const env = makeEnv();
    await handleRegister(
      req('/api/auth/register', jsonBody({ username: 'unique_user', passphrase: PASSPHRASE })),
      env as never,
    );
    const dup = await handleRegister(
      req('/api/auth/register', jsonBody({ username: 'unique_user', passphrase: PASSPHRASE })),
      env as never,
    );
    expect(dup.status).toBe(409);
  });

  it('un email repetido responde 409', async () => {
    const env = makeEnv();
    await register(env, 'alice@example.com');
    const second = await register(env, 'ALICE@example.com');
    expect(second.status).toBe(409);
  });

  it('dos cuentas con el mismo prefijo de email coexisten', async () => {
    const env = makeEnv();
    expect((await register(env, 'alice@corp.example')).status).toBe(201);
    expect((await register(env, 'alice@other.example')).status).toBe(201);

    const rows = await env.SYNC_DB.prepare('SELECT email, username FROM users ORDER BY email').all<{
      email: string;
      username: string;
    }>();
    expect(rows.results).toHaveLength(2);
    const usernames = rows.results.map((row) => row['username']);
    expect(new Set(usernames).size).toBe(2);
  });
});

describe('el bloqueo por intentos fallidos', () => {
  it('bloquea la cuenta con 429 y la libera cuando expira', async () => {
    const env = makeEnv();
    await register(env, 'bob@example.com');

    for (let attempt = 0; attempt < MAX_LOGIN_ATTEMPTS; attempt++) {
      const failed = await login(env, 'bob@example.com', `wrong-${attempt}`);
      expect(failed.status).toBe(401);
    }

    const locked = await login(env, 'bob@example.com', 'wrong-again');
    expect(locked.status).toBe(429);

    // The correct passphrase is refused while the lockout lasts.
    const stillLocked = await login(env, 'bob@example.com', PASSPHRASE);
    expect(stillLocked.status).toBe(429);

    // Once the window passes the account works again.
    await env.SYNC_DB.prepare('UPDATE login_attempts SET locked_until = ? WHERE email = ?')
      .bind(Math.floor(Date.now() / 1000) - 1, 'bob@example.com')
      .run();

    const recovered = await login(env, 'bob@example.com', PASSPHRASE);
    expect(recovered.status).toBe(200);
  });

  it('un intento fallido no bloquea una cuenta válida', async () => {
    const env = makeEnv();
    await register(env, 'carol@example.com');
    expect((await login(env, 'carol@example.com', 'wrong')).status).toBe(401);
    expect((await login(env, 'carol@example.com', PASSPHRASE)).status).toBe(200);
  });

  it('un email desconocido no filtra si la cuenta existe', async () => {
    const env = makeEnv();
    await register(env, 'dave@example.com');
    const unknown = await login(env, 'nobody@example.com', PASSPHRASE);
    const wrong = await login(env, 'dave@example.com', 'wrong');
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.status).toBe(401);
  });
});

describe('las formas de credencial que admite el alta', () => {
  it('acepta un nombre de usuario propio', async () => {
    const env = makeEnv();
    const response = await handleRegister(
      req(
        '/api/auth/register',
        jsonBody({
          email: 'alice@example.com',
          username: 'alice',
          passphrase: PASSPHRASE,
        }),
      ),
      env as never,
    );
    expect(response.status).toBe(201);

    const row = await env.SYNC_DB.prepare('SELECT username FROM users WHERE email = ?')
      .bind('alice@example.com')
      .first<{ username: string }>();
    expect(row?.username).toBe('alice');
  });

  it('acepta un passhash SHA-256 calculado por el cliente', async () => {
    const env = makeEnv();
    const passhash = await sha256Hex(PASSPHRASE);
    const response = await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'alice@example.com', passhash })),
      env as never,
    );
    expect(response.status).toBe(201);

    // The stored digest is the one the client computed...
    const row = await env.SYNC_DB.prepare('SELECT passhash FROM users WHERE email = ?')
      .bind('alice@example.com')
      .first<{ passhash: string }>();
    expect(row?.passhash).toBe(passhash);

    // ...and it signs in.
    const login = await handleLogin(
      req('/api/auth/login', jsonBody({ email: 'alice@example.com', passhash })),
      env as never,
    );
    expect(login.status).toBe(200);
  });

  it('rechaza un passhash que no es un digest SHA-256', async () => {
    const env = makeEnv();
    const response = await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'alice@example.com', passhash: 'nope' })),
      env as never,
    );
    expect(response.status).toBe(400);
  });

  it('rechaza un passhash que no coincide con el almacenado', async () => {
    const env = makeEnv();
    await register(env, 'alice@example.com');
    const wrong = await sha256Hex('another passphrase');
    const response = await handleLogin(
      req('/api/auth/login', jsonBody({ email: 'alice@example.com', passhash: wrong })),
      env as never,
    );
    expect(response.status).toBe(401);
  });

  it('toda cuenta guarda el centinela en userkey, nunca un valor derivado de la credencial', async () => {
    const env = makeEnv();
    const passhash = await sha256Hex(PASSPHRASE);
    await handleRegister(
      req('/api/auth/register', jsonBody({ email: 'alice@example.com', passhash })),
      env as never,
    );
    await register(env, 'bob@example.com');

    for (const email of ['alice@example.com', 'bob@example.com']) {
      const row = await env.SYNC_DB.prepare('SELECT userkey FROM users WHERE email = ?')
        .bind(email)
        .first<{ userkey: string }>();
      expect(row?.userkey).toBe(UNUSED_USERKEY);
    }
  });
});

describe('el borrado de la cuenta y de la biblioteca', () => {
  it('borrar la biblioteca deja la cuenta en pie', async () => {
    const env = makeEnv();
    await register(env, 'alice@example.com');
    const user = await env.SYNC_DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind('alice@example.com')
      .first<{ id: string }>();
    await env.SYNC_DB.prepare(
      'INSERT INTO books (user_id, book_hash, title, synced_at) VALUES (?, ?, ?, ?)',
    )
      .bind(user!.id, 'hash-1', 'Un libro', new Date().toISOString())
      .run();

    const response = await handleDeleteLibrary(env as never, user!.id);
    expect(response.status).toBe(200);

    const books = await env.SYNC_DB.prepare('SELECT book_hash FROM books WHERE user_id = ?')
      .bind(user!.id)
      .all();
    expect(books.results).toHaveLength(0);

    const accounts = await env.SYNC_DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(user!.id)
      .all();
    expect(accounts.results).toHaveLength(1);
  });

  it('borrar la cuenta se lleva el progreso KOSync heredado', async () => {
    const env = makeEnv();
    await register(env, 'alice@example.com');
    const user = await env.SYNC_DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind('alice@example.com')
      .first<{ id: string }>();
    await env.SYNC_DB.prepare(
      'INSERT INTO kosync_progress (user_id, document, progress) VALUES (?, ?, ?)',
    )
      .bind(user!.id, 'doc-1', '/body/1')
      .run();

    const response = await handleDeleteAccount(env as never, user!.id);
    expect(response.status).toBe(200);

    const rows = await env.SYNC_DB.prepare('SELECT user_id FROM kosync_progress WHERE user_id = ?')
      .bind(user!.id)
      .all();
    expect(rows.results).toHaveLength(0);
  });
});

// H-04: the registration endpoint answers a repeated email with a 409, which
// is the answer an enumeration is built on. The status has to stay (the
// client shows it), so what bounds the enumeration is the rate limit — and
// it has to count the attempts that do NOT create an account, or the probe
// would be free.
describe('la enumeración de cuentas por el registro', () => {
  it('cuenta también los intentos que no crean la cuenta', async () => {
    const env = makeEnv();
    expect((await register(env, 'alice@example.com')).status).toBe(201);

    // Every one of these probes finds the account already there. They count
    // against the window like any other attempt.
    let conflicts = 0;
    let limited = 0;
    for (let i = 0; i < MAX_REGISTRATIONS_PER_GLOBAL_WINDOW + 5; i++) {
      const response = await register(env, 'alice@example.com');
      if (response.status === 409) conflicts += 1;
      if (response.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    // The window closes long before the probe list ends.
    expect(conflicts).toBeLessThan(MAX_REGISTRATIONS_PER_GLOBAL_WINDOW + 5);
  });
});
