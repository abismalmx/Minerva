/**
 * @vitest-environment node
 *
 * The migration test runs the REAL migration SQL against a real SQLite
 * database, because the fold it performs (JSON1 + window functions) is the
 * kind of statement that only fails at runtime.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

import { readMigrationFile } from './minerva-sync-doubles';

const USER_ID = '11111111-2222-3333-4444-555555555555';

const hlc = (deviceId: string, counter = 0): string => {
  const ms = Date.now();
  return `${ms.toString(16).padStart(13, '0')}-${counter.toString(16).padStart(8, '0')}-${deviceId}`;
};

const field = (value: unknown, clock: string, deviceId: string) => ({
  v: value,
  t: clock,
  s: deviceId,
});

/**
 * The shape the FIRST schema had: one row per (user, kind, replica, clock) —
 * an append-only log of every pushed version.
 */
const OLD_SCHEMA = `
  CREATE TABLE replicas (
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    replica_id TEXT NOT NULL,
    hlc TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    PRIMARY KEY (user_id, kind, replica_id, hlc)
  );
`;

describe('la migracion que consolida las replicas', () => {
  it('pliega las versiones append-only en una fila canonica por replica', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(OLD_SCHEMA);

    const first = hlc('device-a');
    const second = hlc('device-b', 1);
    const third = hlc('device-a', 2);

    const insert = db.prepare(
      'INSERT INTO replicas (user_id, kind, replica_id, hlc, payload) VALUES (?, ?, ?, ?, ?)',
    );
    // Version 1: the field "alpha".
    insert.run(
      USER_ID,
      'settings',
      'singleton',
      first,
      JSON.stringify({
        fields_jsonb: { alpha: field('a', first, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        schema_version: 1,
      }),
    );
    // Version 2: the field "beta", from another device, plus a manifest.
    insert.run(
      USER_ID,
      'settings',
      'singleton',
      second,
      JSON.stringify({
        fields_jsonb: { beta: field('b', second, 'device-b') },
        manifest_jsonb: {
          files: [{ filename: 'a.txt', byteSize: 1, partialMd5: 'x' }],
          schemaVersion: 1,
        },
        deleted_at_ts: null,
        reincarnation: null,
        schema_version: 1,
      }),
    );
    // Version 3: an empty field set — a manifest publication. It must NOT
    // wipe the fields the earlier versions carried.
    insert.run(
      USER_ID,
      'settings',
      'singleton',
      third,
      JSON.stringify({
        fields_jsonb: {},
        manifest_jsonb: {
          files: [{ filename: 'b.txt', byteSize: 2, partialMd5: 'y' }],
          schemaVersion: 1,
        },
        deleted_at_ts: null,
        reincarnation: null,
        schema_version: 2,
      }),
    );

    db.exec(readMigrationFile('0004_replicas_canonical_row.sql'));

    const rows = db
      .prepare('SELECT user_id, kind, replica_id, hlc, payload FROM replicas')
      .all() as {
      user_id: string;
      kind: string;
      replica_id: string;
      hlc: string;
      payload: string;
    }[];

    // One row per replica, not one per pushed version.
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.replica_id).toBe('singleton');

    const payload = JSON.parse(row.payload) as {
      fields_jsonb: Record<string, { v: unknown }>;
      manifest_jsonb: { files: { filename: string }[] } | null;
      deleted_at_ts: string | null;
      reincarnation: string | null;
      schema_version: number;
    };

    // The per-field last-writer-wins union of every version.
    expect(Object.keys(payload.fields_jsonb).sort()).toEqual(['alpha', 'beta']);
    expect(payload.fields_jsonb['alpha']!.v).toBe('a');
    expect(payload.fields_jsonb['beta']!.v).toBe('b');

    // The manifest of the newest version that carries one.
    expect(payload.manifest_jsonb?.files[0]?.filename).toBe('b.txt');

    // The schema version is the largest one seen.
    expect(payload.schema_version).toBe(2);

    // The clock is the largest of the version clocks and the field clocks.
    expect(row.hlc >= third).toBe(true);

    // The table now has the canonical primary key.
    const index = db.prepare("SELECT name FROM pragma_index_list('replicas')").all() as {
      name: string;
    }[];
    expect(index.map((row) => row.name)).toContain('idx_replicas_user_kind_hlc');
  });

  it('consolida tambien las filas con una lapida', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(OLD_SCHEMA);

    const stamp = hlc('device-a');
    const insert = db.prepare(
      'INSERT INTO replicas (user_id, kind, replica_id, hlc, payload) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run(
      USER_ID,
      'bookshelf',
      'shelf-1',
      stamp,
      JSON.stringify({
        fields_jsonb: { name: field('Favoritos', stamp, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: stamp,
        reincarnation: null,
        schema_version: 1,
      }),
    );

    db.exec(readMigrationFile('0004_replicas_canonical_row.sql'));

    const row = db.prepare('SELECT payload FROM replicas').get() as { payload: string };
    const payload = JSON.parse(row.payload) as { deleted_at_ts: string | null };
    expect(payload.deleted_at_ts).toBe(stamp);
  });
});
