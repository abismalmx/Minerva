/**
 * The replica API: `GET|POST /api/sync/replicas`.
 *
 * The replica rows carry the account-level data that is not part of a book:
 * the app settings, the bookshelves, the custom translators and the custom TTS
 * configurations. Each row is a CRDT document identified by
 * `(kind, replica_id)`.
 *
 * ## Why the merge happens here
 *
 * The client publishes a PATCH, not a full row: `publishReplicaUpsert()`
 * stamps only the fields it packed, and `publishReplicaManifest()` publishes
 * an EMPTY field set with just a new manifest. The server is therefore the
 * only place where the two sides can be combined — a server that merely
 * stored the incoming row would drop every field the patch did not mention,
 * and a manifest publication would wipe the row's fields.
 *
 * So the Worker stores ONE canonical row per `(kind, replica_id)` and merges
 * every push into it with the same per-field last-writer-wins rules the
 * client and the hosted backend use (`crdt.ts`). The row's clock is the pull
 * cursor: it never regresses, so a peer that pulls with `since` sees every
 * change exactly once.
 *
 * ## Concurrency
 *
 * Two devices can push the same replica at the same time. The merge is
 * commutative, so the result is the same whoever wins — but a naive
 * read-merge-write would let the loser's write overwrite the winner's merge.
 * The write is therefore a compare-and-set on the row's clock: the statement
 * only applies when the stored clock is still the one the merge was computed
 * from, and a lost race re-reads and re-merges.
 *
 * The wire shape is the client's `ReplicaRow`
 * (apps/minerva-app/src/types/replica.ts): `{user_id, kind, replica_id,
 * fields_jsonb, manifest_jsonb, deleted_at_ts, reincarnation, updated_at_ts,
 * schema_version}`. SQLite has no `jsonb`, so the two JSON columns live in a
 * TEXT `payload` alongside the non-JSON fields.
 */

import { errorJson, json, nowIso, readJson, type Env } from './http';
import {
  emptyReplicaRow,
  mergeReplica,
  type FieldsObject,
  type Hlc,
  type Manifest,
  type ReplicaRow,
} from './crdt';
import {
  validatePullBatch,
  validatePullParams,
  validatePushBatch,
  type PullCursor,
} from './replicaValidation';

/** How many rows one pull answers at most. */
const PULL_LIMIT = 1000;

/** How many times a push retries after losing a compare-and-set race. */
const MAX_MERGE_ATTEMPTS = 5;

/** The stored form of a replica row. */
interface StoredReplicaRow {
  user_id: string;
  kind: string;
  replica_id: string;
  hlc: string;
  payload: string;
  updated_at: string;
}

/** The JSON payload the Worker stores next to the row's clock. */
interface ReplicaPayload {
  fields_jsonb: FieldsObject;
  manifest_jsonb: Manifest | null;
  deleted_at_ts: Hlc | null;
  reincarnation: string | null;
  schema_version: number;
}

const parseJson = (value: string | null): unknown => {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** Rebuild the client-facing row from the stored form. */
const storedToReplicaRow = (row: StoredReplicaRow): ReplicaRow => {
  const payload = (parseJson(row.payload) ?? {}) as Partial<ReplicaPayload>;
  const fields = (payload.fields_jsonb ?? {}) as FieldsObject;
  return {
    user_id: row.user_id,
    kind: row.kind,
    replica_id: row.replica_id,
    fields_jsonb: fields,
    manifest_jsonb: (payload.manifest_jsonb ?? null) as Manifest | null,
    deleted_at_ts: payload.deleted_at_ts ?? null,
    reincarnation: payload.reincarnation ?? null,
    updated_at_ts: row.hlc,
    schema_version: typeof payload.schema_version === 'number' ? payload.schema_version : 1,
  };
};

/** The wire shape of a row — exactly the client's `ReplicaRow`. */
const toWire = (row: ReplicaRow): ReplicaRow => ({
  user_id: row.user_id,
  kind: row.kind,
  replica_id: row.replica_id,
  fields_jsonb: row.fields_jsonb,
  manifest_jsonb: row.manifest_jsonb,
  deleted_at_ts: row.deleted_at_ts,
  reincarnation: row.reincarnation,
  updated_at_ts: row.updated_at_ts,
  schema_version: row.schema_version,
});

/** Read the stored row of one replica. */
const readStoredRow = async (
  env: Env,
  userId: string,
  kind: string,
  replicaId: string,
): Promise<StoredReplicaRow | null> =>
  env.SYNC_DB.prepare(
    `SELECT user_id, kind, replica_id, hlc, payload, updated_at
     FROM replicas WHERE user_id = ? AND kind = ? AND replica_id = ?`,
  )
    .bind(userId, kind, replicaId)
    .first<StoredReplicaRow>();

/**
 * Write the merged row, but only when the stored clock is still the one the
 * merge was computed from.
 *
 * Returns `true` when the row was written, `false` when another writer got
 * there first (the caller re-reads and re-merges).
 */
const writeMergedRow = async (
  env: Env,
  row: ReplicaRow,
  expectedHlc: string | null,
): Promise<boolean> => {
  const payload: ReplicaPayload = {
    fields_jsonb: row.fields_jsonb,
    manifest_jsonb: row.manifest_jsonb,
    deleted_at_ts: row.deleted_at_ts,
    reincarnation: row.reincarnation,
    schema_version: row.schema_version,
  };
  const result = await env.SYNC_DB.prepare(
    `INSERT INTO replicas (user_id, kind, replica_id, hlc, payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET
       hlc = excluded.hlc, payload = excluded.payload, updated_at = excluded.updated_at
     WHERE replicas.hlc = ?`,
  )
    .bind(
      row.user_id,
      row.kind,
      row.replica_id,
      row.updated_at_ts,
      JSON.stringify(payload),
      nowIso(),
      expectedHlc,
    )
    .run();
  const changes = Number(result?.meta?.['changes'] ?? 0);
  return changes > 0;
};

/**
 * Merge one incoming row into the account's canonical row and persist it.
 *
 * The compare-and-set loop is what makes concurrent pushes safe: the merge is
 * recomputed against the freshest stored row whenever another writer wins the
 * race.
 */
const mergeAndStore = async (
  env: Env,
  userId: string,
  incoming: ReplicaRow,
): Promise<ReplicaRow> => {
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    const stored = await readStoredRow(env, userId, incoming.kind, incoming.replica_id);
    const base = stored
      ? storedToReplicaRow(stored)
      : emptyReplicaRow(userId, incoming.kind, incoming.replica_id);
    const merged = mergeReplica(base, incoming);
    const written = await writeMergedRow(env, merged, stored ? stored.hlc : null);
    if (written) return merged;
  }
  throw new Error('Failed to store the replica row: too many concurrent writes');
};

/**
 * `POST /api/sync/replicas` — push replica rows, or run a batched pull.
 *
 * The body discriminates the two operations:
 *
 * - `{ rows: [...] }` — a push. Each row is merged into the account's
 *   canonical row and the merged rows are echoed back, exactly like the
 *   hosted backend does.
 * - `{ cursors: [...] }` — a batched pull. It collapses what used to be N
 *   parallel `GET ?kind=K&since=…` requests (one per replica kind, fired on
 *   every focus / online / periodic trigger) into a single round trip. The
 *   answer is `{ results: [{ kind, rows }] }`.
 */
export const handleReplicaPost = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const body = await readJson<Record<string, unknown>>(request);
  if (!body || typeof body !== 'object') {
    return errorJson('Invalid JSON body', 400, { code: 'VALIDATION' });
  }

  if ('cursors' in body) {
    const validation = validatePullBatch(body);
    if (!validation.ok) {
      const { status, code, message, offendingIndex } = validation.failure;
      return errorJson(message, status, {
        code,
        ...(offendingIndex !== undefined ? { offendingIndex } : {}),
      });
    }
    const results = await Promise.all(
      validation.value.map(async (cursor) => ({
        kind: cursor.kind,
        rows: await pullRows(env, userId, cursor),
      })),
    );
    return json({ results });
  }

  const validation = validatePushBatch(body, userId, Date.now());
  if (!validation.ok) {
    const { status, code, message, offendingIndex } = validation.failure;
    return errorJson(message, status, {
      code,
      ...(offendingIndex !== undefined ? { offendingIndex } : {}),
    });
  }

  const merged: ReplicaRow[] = [];
  for (const input of validation.value) {
    const incoming: ReplicaRow = {
      user_id: userId,
      kind: input.kind,
      replica_id: input.replica_id,
      fields_jsonb: input.fields_jsonb as FieldsObject,
      manifest_jsonb: input.manifest_jsonb as Manifest | null,
      deleted_at_ts: input.deleted_at_ts,
      reincarnation: input.reincarnation,
      updated_at_ts: input.updated_at_ts,
      schema_version: input.schema_version,
    };
    merged.push(toWire(await mergeAndStore(env, userId, incoming)));
  }

  return json({ rows: merged });
};

/** `GET /api/sync/replicas?kind=<kind>&since=<hlc>` — pull one kind. */
export const handleReplicaPull = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const validation = validatePullParams(
    url.searchParams.get('kind'),
    url.searchParams.get('since'),
  );
  if (!validation.ok) {
    const { status, code, message } = validation.failure;
    return errorJson(message, status, { code });
  }
  const rows = await pullRows(env, userId, validation.value);
  return json({ rows });
};

/**
 * Read the rows of one kind past the cursor.
 *
 * The cursor is an HLC string; because HLCs sort lexicographically by
 * temporal order, a plain `>` comparison is the correct cursor test.
 */
const pullRows = async (env: Env, userId: string, cursor: PullCursor): Promise<ReplicaRow[]> => {
  const clauses = ['user_id = ?', 'kind = ?'];
  const args: unknown[] = [userId, cursor.kind];
  if (cursor.since) {
    clauses.push('hlc > ?');
    args.push(cursor.since);
  }
  const { results } = await env.SYNC_DB.prepare(
    `SELECT user_id, kind, replica_id, hlc, payload, updated_at
     FROM replicas WHERE ${clauses.join(' AND ')} ORDER BY hlc ASC LIMIT ?`,
  )
    .bind(...args, PULL_LIMIT)
    .all<StoredReplicaRow>();
  return (results ?? []).map((row) => toWire(storedToReplicaRow(row)));
};
