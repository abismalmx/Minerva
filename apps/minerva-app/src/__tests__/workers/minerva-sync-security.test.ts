import { describe, it, expect } from 'vitest';

// Security regression tests for the self-hosted sync Worker
// (apps/minerva-app/workers/minerva-sync).
//
// Each test encodes an invariant that an audit (auditor_security, 2026-10-28)
// found broken. They fail on the vulnerable code and pass on the fixed one:
//
// - SEC-01: no digest of the passphrase besides the stretched `passhash` may be
//   stored: `users.userkey` holds only a sentinel.
// - SEC-02: a failed sign-in must eventually be refused (429), so a passphrase
//   cannot be guessed by brute force.
// - SEC-03: the bytes actually written must respect MAX_UPLOAD_BYTES, not only
//   the size the client declared when reserving the slot.
// - SEC-04: STORAGE_FIXED_QUOTA must be enforced on upload, not merely
//   reported by /api/storage/stats.
// - SEC-05: two accounts sharing an email prefix must not break the native
//   registration with an uncaught UNIQUE violation.

import {
  deriveUsername,
  isUniqueViolation,
  MAX_LOGIN_ATTEMPTS,
  normalizeEmail,
  UNUSED_USERKEY,
} from '../../../workers/minerva-sync/src/accounts';
import { mintTicket } from '../../../workers/minerva-sync/src/storageTicket';

/* ------------------------------------------------------------------ */
/* Test doubles: D1 (subset of the SQL the Worker uses) and R2.        */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

class FakeStatement {
  private readonly db: FakeD1;
  private readonly query: string;
  private readonly values: unknown[];

  constructor(db: FakeD1, query: string, values: unknown[] = []) {
    this.db = db;
    this.query = query;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new FakeStatement(this.db, this.query, values);
  }

  private select(sql: string, args: unknown[]): Row[] {
    const t = sql.trim();
    let m = t.match(/FROM\s+users\s+WHERE\s+email\s*=\s*\?/i);
    if (m) return this.db.users.filter((r) => r['email'] === args[0]);
    m = t.match(/FROM\s+users\s+WHERE\s+username\s*=\s*\?/i);
    if (m) return this.db.users.filter((r) => r['username'] === args[0]);
    m = t.match(/FROM\s+users\s+WHERE\s+id\s*=\s*\?/i);
    if (m) return this.db.users.filter((r) => r['id'] === args[0]);
    m = t.match(/FROM\s+login_attempts\s+WHERE\s+email\s*=\s*\?/i);
    if (m) return this.db.attempts.filter((r) => r['email'] === args[0]);
    m = t.match(/FROM\s+files\s+WHERE\s+user_id\s*=\s*\?\s+AND\s+file_key\s*=\s*\?/i);
    if (m)
      return this.db.files.filter((r) => r['user_id'] === args[0] && r['file_key'] === args[1]);
    m = t.match(/FROM\s+files\s+WHERE\s+user_id\s*=\s*\?/i);
    if (m) return this.db.files.filter((r) => r['user_id'] === args[0]);
    // The write path looks the reservation up by its key (and only accepts a
    // row that is not soft-deleted), so the double has to answer that query
    // too — otherwise the size guard would be exercised against a
    // reservation the fake never found.
    m = t.match(/FROM\s+files\s+WHERE\s+file_key\s*=\s*\?/i);
    if (m) {
      const rows = this.db.files.filter((r) => r['file_key'] === args[0]);
      return /deleted_at\s+IS\s+NULL/i.test(t) ? rows.filter((r) => !r['deleted_at']) : rows;
    }
    return [];
  }

  async first<T = Row>(): Promise<T | null> {
    const t = this.query.trim();
    // An aggregate over the account's files: the usage the quota is checked
    // against.
    if (/SUM\s*\(\s*file_size\s*\)/i.test(t)) {
      if (/FROM\s+files\s+WHERE\s+user_id\s*=\s*\?/i.test(t)) {
        const rows = this.db.files.filter((r) => r['user_id'] === this.values[0]);
        const total = rows.reduce((acc, r) => acc + Number(r['file_size'] ?? 0), 0);
        return { total_size: total } as T;
      }
    }
    return (this.select(this.query, this.values)[0] as T) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.select(this.query, this.values) as T[], success: true };
  }

  async run() {
    const t = this.query.trim();
    const args = this.values;
    let m = t.match(/INSERT\s+INTO\s+users\s*\(([^)]+)\)/i);
    if (m) {
      const cols = (m[1] ?? '').split(',').map((c) => c.trim());
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = args[i]));
      const dup = this.db.users.find(
        (u) => u['email'] === row['email'] || u['username'] === row['username'],
      );
      if (dup) {
        throw new Error('D1_ERROR: UNIQUE constraint failed: users.email');
      }
      this.db.users.push(row);
      return { results: [], success: true };
    }
    m = t.match(/INSERT\s+INTO\s+files\s*\(([^)]+)\)/i);
    if (m) {
      const cols = (m[1] ?? '').split(',').map((c) => c.trim());
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = args[i]));
      this.db.files.push(row);
      return { results: [], success: true };
    }
    m = t.match(/INSERT\s+INTO\s+login_attempts\s*\(([^)]+)\)/i);
    if (m) {
      const cols = (m[1] ?? '').split(',').map((c) => c.trim());
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = args[i]));
      const existing = this.db.attempts.find((a) => a['email'] === row['email']);
      if (existing) Object.assign(existing, row);
      else this.db.attempts.push(row);
      return { results: [], success: true };
    }
    m = t.match(/DELETE\s+FROM\s+login_attempts\s+WHERE\s+email\s*=\s*\?/i);
    if (m) {
      this.db.attempts = this.db.attempts.filter((a) => a['email'] !== args[0]);
      return { results: [], success: true };
    }
    return { results: [], success: true };
  }
}
class FakeD1 {
  users: Row[] = [];
  files: Row[] = [];
  attempts: Row[] = [];
  prepare(query: string) {
    return new FakeStatement(this, query);
  }
  async batch(statements: FakeStatement[]) {
    const out = [];
    for (const s of statements) out.push(await s.run());
    return out;
  }
}

class FakeR2 {
  objects = new Map<string, string>();
  async get(key: string) {
    const body = this.objects.get(key);
    if (body === undefined) return null;
    return {
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(body));
          c.close();
        },
      }),
      httpEtag: '"etag"',
      httpMetadata: { contentType: 'application/octet-stream' },
      size: body.length,
    };
  }
  async put(key: string, value: unknown) {
    this.objects.set(key, typeof value === 'string' ? value : '');
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const SECRET = 'test-secret-value-32-chars-minimum!!';

const makeEnv = () => ({
  JWT_SECRET: SECRET,
  PASSPHRASE_KDF_ITERATIONS: '10000',
  ALLOWED_ORIGINS: '*',
  SYNC_DB: new FakeD1(),
  LIBRARY_BUCKET: new FakeR2(),
});

const req = (url: string, init: RequestInit = {}) =>
  new Request(url.startsWith('http') ? url : `https://worker.test${url}`, init);

const jsonBody = (obj: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

/* ------------------------------------------------------------------ */

describe('SEC-01: la cuenta solo guarda el hash estirado de la passphrase', () => {
  it('el alta nativa guarda un hash estirado en passhash, no el MD5', async () => {
    const { handleRegister } = await import('../../../workers/minerva-sync/src/accounts');
    const env = makeEnv();
    const res = await handleRegister(
      req(
        '/api/auth/register',
        jsonBody({ email: 'alice@example.com', passphrase: 'correct horse battery' }),
      ),
      env,
    );
    expect(res.status).toBe(201);
    const stored = env.SYNC_DB.users[0]!;
    // The passphrase is stretched with PBKDF2 and salted, so the table holds
    // neither the passphrase nor a digest of it that a GPU could attack.
    expect(String(stored['passhash'])).toMatch(/^(argon2id|pbkdf2-sha256)\$/);
    expect(stored['userkey']).toBe(UNUSED_USERKEY);
    expect(stored['passhash']).not.toBe(stored['userkey']);
  });
});

describe('SEC-02: el login limita los intentos fallidos', () => {
  it('bloquea la cuenta tras varios intentos fallidos', async () => {
    const { handleLogin, handleRegister } = await import(
      '../../../workers/minerva-sync/src/accounts'
    );
    const env = makeEnv();
    await handleRegister(
      req(
        '/api/auth/register',
        jsonBody({ email: 'bob@example.com', passphrase: 'correct horse battery' }),
      ),
      env,
    );

    let locked = false;
    let status = 0;
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS + 2; i++) {
      const res = await handleLogin(
        req('/api/auth/login', jsonBody({ email: 'bob@example.com', passphrase: `wrong-${i}` })),
        env,
      );
      status = res.status;
      if (status === 429) {
        locked = true;
        break;
      }
    }
    expect(locked, `ultimo status ${status}`).toBe(true);
  });

  it('una contrasena correcta sigue funcionando tras un intento fallido', async () => {
    const { handleLogin, handleRegister } = await import(
      '../../../workers/minerva-sync/src/accounts'
    );
    const env = makeEnv();
    await handleRegister(
      req(
        '/api/auth/register',
        jsonBody({ email: 'carol@example.com', passphrase: 'correct horse battery' }),
      ),
      env,
    );
    await handleLogin(
      req('/api/auth/login', jsonBody({ email: 'carol@example.com', passphrase: 'wrong' })),
      env,
    );
    const ok = await handleLogin(
      req(
        '/api/auth/login',
        jsonBody({ email: 'carol@example.com', passphrase: 'correct horse battery' }),
      ),
      env,
    );
    expect(ok.status).toBe(200);
  });
});

describe('SEC-03: la escritura real respeta MAX_UPLOAD_BYTES', () => {
  it('rechaza un cuerpo que excede el limite, aunque la reserva fuese pequena', async () => {
    const { handleStorageUpload } = await import('../../../workers/minerva-sync/src/storage');
    const { routeRequest } = await import('../../../workers/minerva-sync/src/routes');
    const env = { ...makeEnv(), MAX_UPLOAD_BYTES: '1024' };
    const userId = 'user-1';

    const reserve = await handleStorageUpload(
      req('/api/storage/upload', jsonBody({ fileName: 'book.epub', fileSize: 1 })),
      env,
      userId,
    );
    expect(reserve.status).toBe(200);
    const { uploadUrl } = (await reserve.json()) as { uploadUrl: string };
    const url = new URL(uploadUrl);
    const key = url.searchParams.get('key') ?? '';
    const ticket = url.searchParams.get('ticket') ?? '';

    const big = 'x'.repeat(4096);
    const put = await routeRequest(
      req(
        `/api/storage/object?key=${encodeURIComponent(key)}&ticket=${encodeURIComponent(ticket)}`,
        { method: 'PUT', body: big, headers: { 'content-length': String(big.length) } },
      ),
      env,
      '/api/storage/object',
    );
    expect(put.status).toBe(413);
  });

  it('acepta un cuerpo dentro del limite', async () => {
    const { handleStorageUpload } = await import('../../../workers/minerva-sync/src/storage');
    const { routeRequest } = await import('../../../workers/minerva-sync/src/routes');
    const env = { ...makeEnv(), MAX_UPLOAD_BYTES: '1024' };
    const userId = 'user-1';
    const reserve = await handleStorageUpload(
      req('/api/storage/upload', jsonBody({ fileName: 'book.epub', fileSize: 10 })),
      env,
      userId,
    );
    const { uploadUrl } = (await reserve.json()) as { uploadUrl: string };
    const url = new URL(uploadUrl);
    const key = url.searchParams.get('key') ?? '';
    const ticket = url.searchParams.get('ticket') ?? '';
    const body = 'x'.repeat(10);
    const put = await routeRequest(
      req(
        `/api/storage/object?key=${encodeURIComponent(key)}&ticket=${encodeURIComponent(ticket)}`,
        { method: 'PUT', body, headers: { 'content-length': String(body.length) } },
      ),
      env,
      '/api/storage/object',
    );
    expect(put.status).toBe(200);
  });
});
describe('SEC-04: la cuota del operador se aplica al subir', () => {
  it('rechaza la subida que supera STORAGE_FIXED_QUOTA', async () => {
    const { handleStorageUpload } = await import('../../../workers/minerva-sync/src/storage');
    const env = { ...makeEnv(), STORAGE_FIXED_QUOTA: '1000' };
    const userId = 'user-1';

    const first = await handleStorageUpload(
      req('/api/storage/upload', jsonBody({ fileName: 'a.epub', fileSize: 900 })),
      env,
      userId,
    );
    expect(first.status).toBe(200);

    const second = await handleStorageUpload(
      req('/api/storage/upload', jsonBody({ fileName: 'b.epub', fileSize: 900 })),
      env,
      userId,
    );
    expect(second.status).toBe(507);
  });

  it('sin cuota configurada no hay limite', async () => {
    const { handleStorageUpload } = await import('../../../workers/minerva-sync/src/storage');
    const env = makeEnv();
    const res = await handleStorageUpload(
      req('/api/storage/upload', jsonBody({ fileName: 'a.epub', fileSize: 900 })),
      env,
      'user-1',
    );
    expect(res.status).toBe(200);
  });
});

describe('SEC-05: el alta nativa no colisiona por el prefijo del email', () => {
  it('dos cuentas con el mismo prefijo de email se registran sin error no controlado', async () => {
    const { handleRegister } = await import('../../../workers/minerva-sync/src/accounts');
    const env = makeEnv();
    const first = await handleRegister(
      req(
        '/api/auth/register',
        jsonBody({ email: 'alice@corp.example', passphrase: 'correct horse battery' }),
      ),
      env,
    );
    expect(first.status).toBe(201);

    // The second registration must not throw: the Worker answers 409 (or
    // creates the account) instead of letting the UNIQUE violation escape.
    let status = 0;
    await expect(
      handleRegister(
        req(
          '/api/auth/register',
          jsonBody({ email: 'alice@other.example', passphrase: 'correct horse battery' }),
        ),
        env,
      ),
    ).resolves.toBeDefined();
    const second = await handleRegister(
      req(
        '/api/auth/register',
        jsonBody({ email: 'alice@third.example', passphrase: 'correct horse battery' }),
      ),
      env,
    );
    status = second.status;
    expect(status).toBe(201);
    expect(env.SYNC_DB.users).toHaveLength(3);
  });

  it('el username derivado es unico por cuenta', () => {
    const a = deriveUsername('alice@corp.example', '11111111-2222-3333-4444-555555555555');
    const b = deriveUsername('alice@other.example', '66666666-7777-8888-9999-000000000000');
    expect(a).not.toBe(b);
    expect(a.startsWith('alice-')).toBe(true);
  });

  it('reconoce una violacion UNIQUE de D1', () => {
    expect(isUniqueViolation(new Error('D1_ERROR: UNIQUE constraint failed: users.email'))).toBe(
      true,
    );
    expect(isUniqueViolation(new Error('some other failure'))).toBe(false);
  });
});

describe('helpers del Worker', () => {
  it('el ticket sigue ligado a su clave', async () => {
    const { verifyTicket } = await import('../../../workers/minerva-sync/src/storageTicket');
    const ticket = await mintTicket(SECRET, 'user-1/book.epub');
    await expect(verifyTicket(SECRET, 'user-1/book.epub', ticket)).resolves.toBe(true);
    await expect(verifyTicket(SECRET, 'user-2/book.epub', ticket)).resolves.toBe(false);
  });

  it('normalizeEmail deja el email en minusculas y sin espacios', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });
});
