/**
 * Test doubles for the self-hosted sync Worker.
 *
 * The storage routes are exactly where the SCHEMA matters: the
 * `files.file_key` UNIQUE index, the soft-delete flag and the
 * `SUM(file_size)` quota arithmetic all behave differently in a hand-written
 * fake than in real SQLite. These doubles therefore run the real migrations
 * on an in-memory SQLite database, so the tests exercise the same SQL the
 * deployed Worker runs — and a broken migration fails the suite instead of
 * failing in production.
 *
 * The R2 double CONSUMES the body stream, like the real binding does: a fake
 * that ignored the stream could not tell a capped write from a truncated one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

/**
 * Node still flags `node:sqlite` as experimental and prints the warning on
 * every run. It is noise here (the API is stable enough for a test double),
 * so it is filtered out — and only that warning: every other one still gets
 * through.
 */
const silenceSqliteExperimentalWarning = (): void => {
  const listeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning: Error) => {
    if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
    for (const listener of listeners) listener(warning);
  });
};

silenceSqliteExperimentalWarning();

/** The migrations, in the order D1 applies them. */
const MIGRATION_FILES = [
  '../../../workers/minerva-sync/migrations/0001_init.sql',
  '../../../workers/minerva-sync/migrations/0002_login_attempts.sql',
  '../../../workers/minerva-sync/migrations/0003_kosync_progress.sql',
  '../../../workers/minerva-sync/migrations/0004_replicas_canonical_row.sql',
];

/** Read one migration from disk. */
const readMigration = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

/**
 * Read one migration by file name, so a test can apply a single migration on
 * top of a hand-built schema.
 */
export const readMigrationFile = (name: string): string =>
  readMigration(`../../../workers/minerva-sync/migrations/${name}`);

/** A value SQLite accepts as a bound parameter. */
type SqlValue = null | number | bigint | string | Uint8Array;

/** Normalize a bound value: SQLite knows no booleans and no `undefined`. */
const toSqlValue = (value: unknown): SqlValue => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
};

/** A D1 prepared statement, backed by a real SQLite statement. */
export class D1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1Statement {
    return new D1Statement(this.db, this.sql, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values.map(toSqlValue));
    return (row as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }> {
    const rows = this.db.prepare(this.sql).all(...this.values.map(toSqlValue));
    return { results: rows as T[], success: true };
  }

  async run(): Promise<{ results: unknown[]; success: boolean; meta: { changes: number } }> {
    // The row count matters: the Worker's replica merge is a compare-and-set
    // on the row's clock, and it detects a lost race from `meta.changes`.
    const result = this.db.prepare(this.sql).run(...this.values.map(toSqlValue));
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }
}

/** The D1 binding, backed by an in-memory SQLite database. */
export class SqliteD1 {
  constructor(readonly db: DatabaseSync) {}

  prepare(sql: string): D1Statement {
    return new D1Statement(this.db, sql);
  }

  /** Run the statements in order, rolling the whole batch back on failure. */
  async batch<T = Record<string, unknown>>(
    statements: D1Statement[],
  ): Promise<{ results: T[]; success: boolean }[]> {
    this.db.exec('BEGIN');
    try {
      const out: { results: T[]; success: boolean }[] = [];
      for (const statement of statements) {
        out.push((await statement.run()) as { results: T[]; success: boolean });
      }
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Apply the Worker's migrations, exactly as `wrangler d1 migrations apply` does. */
  static withMigrations(): SqliteD1 {
    const db = new DatabaseSync(':memory:');
    for (const file of MIGRATION_FILES) {
      db.exec(readMigration(file));
    }
    return new SqliteD1(db);
  }
}

/** A stored R2 object. */
interface StoredObject {
  body: Uint8Array;
  contentType: string;
  etag: string;
}

/** Read whatever the R2 binding was handed into bytes. */
const readBody = async (value: unknown): Promise<Uint8Array> => {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (!chunk) continue;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
  return new Uint8Array();
};

/** The R2 binding, backed by a Map. It consumes the body stream. */
export class MemoryR2 {
  readonly objects = new Map<string, StoredObject>();

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(object.body);
          controller.close();
        },
      }),
      httpEtag: object.etag,
      httpMetadata: { contentType: object.contentType },
      size: object.body.length,
    };
  }

  async put(
    key: string,
    value: unknown,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    // A capped body fails the stream: the write is aborted and nothing is
    // committed, exactly like the real binding.
    const body = await readBody(value);
    this.objects.set(key, {
      body,
      contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
      etag: `"${key.length}-${body.length}"`,
    });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** The signing secret the tests use. */
export const TEST_SECRET = 'test-secret-value-32-chars-minimum!!';
