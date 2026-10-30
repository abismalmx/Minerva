/**
 * @vitest-environment node
 *
 * The replica tests need the Node environment: they run the Worker's own
 * migrations on a real SQLite database, so the canonical primary key, the
 * compare-and-set write and the pull cursor behave exactly as they do in D1.
 */
import { describe, it, expect } from 'vitest';

import { handleReplicaPost, handleReplicaPull } from '../../../workers/minerva-sync/src/replicas';
import {
  handleReplicaKeysCreate,
  handleReplicaKeysForget,
  handleReplicaKeysList,
} from '../../../workers/minerva-sync/src/replicaKeys';
import { mergeReplica } from '../../../workers/minerva-sync/src/crdt';
import { MemoryR2, SqliteD1, TEST_SECRET } from './minerva-sync-doubles';

interface TestEnv {
  JWT_SECRET: string;
  ALLOWED_ORIGINS: string;
  MAX_UPLOAD_BYTES: string;
  STORAGE_FIXED_QUOTA: string;
  SYNC_DB: SqliteD1;
  LIBRARY_BUCKET: MemoryR2;
}

const makeEnv = (): TestEnv => ({
  JWT_SECRET: TEST_SECRET,
  ALLOWED_ORIGINS: '*',
  MAX_UPLOAD_BYTES: '104857600',
  STORAGE_FIXED_QUOTA: '0',
  SYNC_DB: SqliteD1.withMigrations(),
  LIBRARY_BUCKET: new MemoryR2(),
});

const USER_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_USER_ID = '99999999-8888-7777-6666-555555555555';

const req = (url: string, init: RequestInit = {}) =>
  new Request(url.startsWith('http') ? url : `https://worker.test${url}`, init);

const jsonBody = (obj: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

/** A hybrid logical clock stamped now, so it passes the skew check. */
const hlc = (deviceId: string, counter = 0, offsetMs = 0): string => {
  const ms = Date.now() + offsetMs;
  return `${ms.toString(16).padStart(13, '0')}-${counter.toString(16).padStart(8, '0')}-${deviceId}`;
};

/** A field envelope, the shape the client writes. */
const field = (value: unknown, clock: string, deviceId: string) => ({
  v: value,
  t: clock,
  s: deviceId,
});

interface WireRow {
  user_id: string;
  kind: string;
  replica_id: string;
  fields_jsonb: Record<string, { v: unknown; t: string; s: string }>;
  manifest_jsonb: unknown;
  deleted_at_ts: string | null;
  reincarnation: string | null;
  updated_at_ts: string;
  schema_version: number;
}

const push = async (env: TestEnv, rows: unknown[], userId = USER_ID) =>
  handleReplicaPost(req('/api/sync/replicas', jsonBody({ rows })), env as never, userId);

const pullBatch = async (env: TestEnv, cursors: unknown[], userId = USER_ID) =>
  handleReplicaPost(req('/api/sync/replicas', jsonBody({ cursors })), env as never, userId);

describe('la superficie de réplicas', () => {
  it('fusiona un parche sobre la fila canónica sin perder los campos previos', async () => {
    const env = makeEnv();
    const first = hlc('device-a');
    const second = hlc('device-a', 1);

    const pushResponse = await push(env, [
      {
        user_id: USER_ID,
        kind: 'settings',
        replica_id: 'singleton',
        fields_jsonb: { alpha: field('a', first, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: first,
        schema_version: 1,
      },
    ]);
    expect(pushResponse.status).toBe(200);

    // The client publishes PATCHES: the second push carries only the field it
    // changed. The stored row must keep the first one.
    await push(env, [
      {
        user_id: USER_ID,
        kind: 'settings',
        replica_id: 'singleton',
        fields_jsonb: { beta: field('b', second, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: second,
        schema_version: 1,
      },
    ]);

    const pull = await handleReplicaPull(
      req('/api/sync/replicas?kind=settings'),
      env as never,
      USER_ID,
    );
    const body = (await pull.json()) as { rows: WireRow[] };
    expect(body.rows).toHaveLength(1);
    expect(Object.keys(body.rows[0]!.fields_jsonb).sort()).toEqual(['alpha', 'beta']);
    expect(body.rows[0]!.fields_jsonb['alpha']!.v).toBe('a');
    expect(body.rows[0]!.fields_jsonb['beta']!.v).toBe('b');
  });

  it('la publicación de un manifiesto no borra los campos de la fila', async () => {
    const env = makeEnv();
    const stamp = hlc('device-a');

    await push(env, [
      {
        user_id: USER_ID,
        kind: 'font',
        replica_id: 'font-1',
        fields_jsonb: { name: field('Inter', stamp, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: stamp,
        schema_version: 1,
      },
    ]);

    // `publishReplicaManifest()` sends an EMPTY field set: the manifest is
    // the only thing that changed.
    const manifestClock = hlc('device-a', 1);
    await push(env, [
      {
        user_id: USER_ID,
        kind: 'font',
        replica_id: 'font-1',
        fields_jsonb: {},
        manifest_jsonb: {
          files: [{ filename: 'Inter.ttf', byteSize: 10, partialMd5: 'x' }],
          schemaVersion: 1,
        },
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: manifestClock,
        schema_version: 1,
      },
    ]);

    const pull = await handleReplicaPull(
      req('/api/sync/replicas?kind=font'),
      env as never,
      USER_ID,
    );
    const body = (await pull.json()) as { rows: WireRow[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]!.fields_jsonb['name']!.v).toBe('Inter');
    expect(body.rows[0]!.manifest_jsonb).not.toBeNull();
  });

  it('el push devuelve las filas fusionadas', async () => {
    const env = makeEnv();
    const stamp = hlc('device-a');
    const response = await push(env, [
      {
        user_id: USER_ID,
        kind: 'settings',
        replica_id: 'singleton',
        fields_jsonb: { alpha: field('a', stamp, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: stamp,
        schema_version: 1,
      },
    ]);
    const body = (await response.json()) as { rows: WireRow[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]!.replica_id).toBe('singleton');
    expect(body.rows[0]!.fields_jsonb['alpha']!.v).toBe('a');
  });

  it('el pull por lotes responde un resultado por cursor', async () => {
    const env = makeEnv();
    const stamp = hlc('device-a');
    await push(env, [
      {
        user_id: USER_ID,
        kind: 'settings',
        replica_id: 'singleton',
        fields_jsonb: { alpha: field('a', stamp, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: stamp,
        schema_version: 1,
      },
      {
        user_id: USER_ID,
        kind: 'bookshelf',
        replica_id: 'shelf-1',
        fields_jsonb: { name: field('Favoritos', stamp, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: stamp,
        schema_version: 1,
      },
    ]);

    // The batched pull is the client's incremental auto-sync path. It must
    // answer one entry per cursor — an empty answer would silently wipe
    // every replica kind on the client.
    const response = await pullBatch(env, [
      { kind: 'settings', since: null },
      { kind: 'bookshelf', since: null },
      { kind: 'font', since: null },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: { kind: string; rows: WireRow[] }[] };
    expect(body.results).toHaveLength(3);
    expect(body.results[0]!.kind).toBe('settings');
    expect(body.results[0]!.rows).toHaveLength(1);
    expect(body.results[1]!.kind).toBe('bookshelf');
    expect(body.results[1]!.rows).toHaveLength(1);
    // A kind the account never wrote to answers an empty list, not a gap.
    expect(body.results[2]!.kind).toBe('font');
    expect(body.results[2]!.rows).toEqual([]);
  });

  it('el cursor del pull solo entrega lo que hay despues de el', async () => {
    const env = makeEnv();
    const first = hlc('device-a');
    const second = hlc('device-a', 1);
    const base = {
      user_id: USER_ID,
      kind: 'settings',
      replica_id: 'singleton',
      manifest_jsonb: null,
      deleted_at_ts: null,
      reincarnation: null,
      schema_version: 1,
    };
    await push(env, [
      { ...base, fields_jsonb: { alpha: field('a', first, 'device-a') }, updated_at_ts: first },
    ]);
    await push(env, [
      { ...base, fields_jsonb: { beta: field('b', second, 'device-a') }, updated_at_ts: second },
    ]);

    const pull = await handleReplicaPull(
      req(`/api/sync/replicas?kind=settings&since=${encodeURIComponent(first)}`),
      env as never,
      USER_ID,
    );
    const body = (await pull.json()) as { rows: WireRow[] };
    expect(body.rows).toHaveLength(1);
    // The row is the canonical one, so it carries both fields even though
    // only the newer change is past the cursor.
    expect(Object.keys(body.rows[0]!.fields_jsonb).sort()).toEqual(['alpha', 'beta']);
  });

  it('un kind fuera de la lista blanca responde 422 UNKNOWN_KIND', async () => {
    const env = makeEnv();
    const response = await handleReplicaPull(
      req('/api/sync/replicas?kind=not_a_kind'),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe('UNKNOWN_KIND');
  });

  it('un reloj fuera de la desviacion admitida responde 409 CLOCK_SKEW', async () => {
    const env = makeEnv();
    const skewed = hlc('device-a', 0, 10 * 60 * 1000);
    const response = await push(env, [
      {
        user_id: USER_ID,
        kind: 'settings',
        replica_id: 'singleton',
        fields_jsonb: { alpha: field('a', skewed, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: skewed,
        schema_version: 1,
      },
    ]);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe('CLOCK_SKEW');
  });

  it('una fila de otra cuenta responde 403 AUTH', async () => {
    const env = makeEnv();
    const stamp = hlc('device-a');
    const response = await push(env, [
      {
        user_id: OTHER_USER_ID,
        kind: 'settings',
        replica_id: 'singleton',
        fields_jsonb: { alpha: field('a', stamp, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: stamp,
        schema_version: 1,
      },
    ]);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe('AUTH');
  });

  it('un kind repetido en el lote responde 400', async () => {
    const env = makeEnv();
    const response = await pullBatch(env, [
      { kind: 'settings', since: null },
      { kind: 'settings', since: null },
    ]);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe('VALIDATION');
  });

  it('un lote mas grande que el maximo responde 413', async () => {
    const env = makeEnv();
    const cursors = Array.from({ length: 51 }, () => ({ kind: 'settings', since: null }));
    const response = await pullBatch(env, cursors);
    expect(response.status).toBe(413);
  });

  it('las cuentas no ven las filas de la otra', async () => {
    const env = makeEnv();
    const stamp = hlc('device-a');
    await push(env, [
      {
        user_id: USER_ID,
        kind: 'settings',
        replica_id: 'singleton',
        fields_jsonb: { alpha: field('a', stamp, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: stamp,
        schema_version: 1,
      },
    ]);

    const pull = await handleReplicaPull(
      req('/api/sync/replicas?kind=settings'),
      env as never,
      OTHER_USER_ID,
    );
    const body = (await pull.json()) as { rows: WireRow[] };
    expect(body.rows).toEqual([]);
  });

  it('una lapida gana a una escritura posterior de campos', async () => {
    const env = makeEnv();
    const tombstone = hlc('device-a');
    await push(env, [
      {
        user_id: USER_ID,
        kind: 'bookshelf',
        replica_id: 'shelf-1',
        fields_jsonb: { name: field('Favoritos', tombstone, 'device-a') },
        manifest_jsonb: null,
        deleted_at_ts: tombstone,
        reincarnation: null,
        updated_at_ts: tombstone,
        schema_version: 1,
      },
    ]);

    // A later field write must NOT revive a tombstoned row.
    const later = hlc('device-b', 0, 1000);
    await push(env, [
      {
        user_id: USER_ID,
        kind: 'bookshelf',
        replica_id: 'shelf-1',
        fields_jsonb: { name: field('Renombrado', later, 'device-b') },
        manifest_jsonb: null,
        deleted_at_ts: null,
        reincarnation: null,
        updated_at_ts: later,
        schema_version: 1,
      },
    ]);

    const pull = await handleReplicaPull(
      req('/api/sync/replicas?kind=bookshelf'),
      env as never,
      USER_ID,
    );
    const body = (await pull.json()) as { rows: WireRow[] };
    expect(body.rows[0]!.deleted_at_ts).toBe(tombstone);
  });

  it('dos pushes concurrentes del mismo campo convergen al mismo valor', async () => {
    const env = makeEnv();
    const base = {
      user_id: USER_ID,
      kind: 'settings',
      replica_id: 'singleton',
      manifest_jsonb: null,
      deleted_at_ts: null,
      reincarnation: null,
      schema_version: 1,
    };
    const clockA = hlc('device-a');
    const clockB = hlc('device-b', 0, 10);
    await Promise.all([
      push(env, [
        { ...base, fields_jsonb: { alpha: field('a', clockA, 'device-a') }, updated_at_ts: clockA },
      ]),
      push(env, [
        { ...base, fields_jsonb: { alpha: field('b', clockB, 'device-b') }, updated_at_ts: clockB },
      ]),
    ]);

    const pull = await handleReplicaPull(
      req('/api/sync/replicas?kind=settings'),
      env as never,
      USER_ID,
    );
    const body = (await pull.json()) as { rows: WireRow[] };
    expect(body.rows).toHaveLength(1);
    // The larger clock wins, whoever wrote last.
    expect(body.rows[0]!.fields_jsonb['alpha']!.v).toBe('b');
  });
});

describe('la fusion CRDT', () => {
  it('el reloj de la fila nunca retrocede', () => {
    const older = hlc('device-a');
    const newer = hlc('device-a', 5);
    const base = {
      user_id: USER_ID,
      kind: 'settings',
      replica_id: 'singleton',
      fields_jsonb: {},
      manifest_jsonb: null,
      deleted_at_ts: null,
      reincarnation: null,
      schema_version: 1,
    };
    const merged = mergeReplica(
      { ...base, updated_at_ts: newer },
      { ...base, updated_at_ts: older, fields_jsonb: { alpha: field('a', older, 'device-a') } },
    );
    expect(merged.updated_at_ts).toBe(newer);
  });

  it('el mismo reloj se desempata por el id de dispositivo', () => {
    const stamp = hlc('device-a');
    const base = {
      user_id: USER_ID,
      kind: 'settings',
      replica_id: 'singleton',
      manifest_jsonb: null,
      deleted_at_ts: null,
      reincarnation: null,
      updated_at_ts: stamp,
      schema_version: 1,
      fields_jsonb: {},
    };
    const merged = mergeReplica(
      { ...base, fields_jsonb: { alpha: field('a', stamp, 'device-a') } },
      { ...base, fields_jsonb: { alpha: field('b', stamp, 'device-b') } },
    );
    expect(merged.fields_jsonb['alpha']!.v).toBe('b');
  });
});

describe('las sales de la passphrase', () => {
  it('el listado usa el formato camelCase que el cliente lee', async () => {
    const env = makeEnv();
    await handleReplicaKeysCreate(
      req('/api/sync/replica-keys', jsonBody({ alg: 'pbkdf2-600k-sha256' })),
      env as never,
      USER_ID,
    );

    const response = await handleReplicaKeysList(env as never, USER_ID);
    const body = (await response.json()) as {
      rows: { saltId: string; alg: string; salt: string; createdAt: string }[];
    };
    expect(body.rows).toHaveLength(1);
    expect(typeof body.rows[0]!.saltId).toBe('string');
    expect(typeof body.rows[0]!.createdAt).toBe('string');
    expect(body.rows[0]!.alg).toBe('pbkdf2-600k-sha256');
  });

  it('el alta acuña la sal en el servidor, en base64', async () => {
    const env = makeEnv();
    const response = await handleReplicaKeysCreate(
      req('/api/sync/replica-keys', jsonBody({ alg: 'pbkdf2-600k-sha256' })),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { row: { saltId: string; salt: string } };
    // The client decodes the salt with `atob`, so it has to be base64 of the
    // raw 32 bytes.
    expect(body.row.salt.length).toBeGreaterThan(0);
    expect(atob(body.row.salt).length).toBe(32);
  });

  it('un algoritmo no admitido responde 422 UNSUPPORTED_ALG', async () => {
    const env = makeEnv();
    const response = await handleReplicaKeysCreate(
      req('/api/sync/replica-keys', jsonBody({ alg: 'rot13' })),
      env as never,
      USER_ID,
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('UNSUPPORTED_ALG');
  });

  it('el olvido borra todas las sales de la cuenta', async () => {
    const env = makeEnv();
    await handleReplicaKeysCreate(
      req('/api/sync/replica-keys', jsonBody({ alg: 'pbkdf2-600k-sha256' })),
      env as never,
      USER_ID,
    );
    const forget = await handleReplicaKeysForget(env as never, USER_ID);
    expect(forget.status).toBe(200);
    const list = await handleReplicaKeysList(env as never, USER_ID);
    const body = (await list.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]);
  });
});
