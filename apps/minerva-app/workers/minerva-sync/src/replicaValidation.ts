/**
 * Validation for the replica surface.
 *
 * A port of the hosted backend's API-layer checks
 * (apps/minerva-app/src/libs/replicaSyncServer.ts and
 * src/libs/replicaSchemas.ts), minus the per-kind Zod field schemas: those
 * describe the shape of each kind's payload (a dictionary entry, a font
 * record, …) and are the client's own contract. The server checks what it can
 * check without understanding the payload — the kind allowlist, the schema
 * version bounds, the field-count and payload-size caps, the envelope shape
 * and the clock skew — and the client checks the rest before it publishes.
 *
 * The failure codes are the client's `SyncErrorCode` vocabulary verbatim: the
 * client reads `body.code` and only falls back to mapping the HTTP status
 * when the server does not send one, so the codes have to be spelled exactly
 * as the client expects.
 */

import { isHlc, isHlcWithinSkew } from './crdt';

/** The replica kinds the server accepts. */
export interface KindSpec {
  minSchemaVersion: number;
  maxSchemaVersion: number;
  maxRowsPerUser: number;
  /** Whether the kind's payload is backed by binary files in a manifest. */
  binary: boolean;
}

/**
 * The server-side kind allowlist.
 *
 * Adding a kind is a coordinated client + server change: the client's
 * adapter has to exist and this list has to be widened in the same release.
 */
export const KIND_ALLOWLIST: Record<string, KindSpec> = {
  bookshelf: { minSchemaVersion: 1, maxSchemaVersion: 1, maxRowsPerUser: 200, binary: false },
  dictionary: { minSchemaVersion: 1, maxSchemaVersion: 1, maxRowsPerUser: 200, binary: true },
  font: { minSchemaVersion: 1, maxSchemaVersion: 1, maxRowsPerUser: 500, binary: true },
  texture: { minSchemaVersion: 1, maxSchemaVersion: 1, maxRowsPerUser: 200, binary: true },
  opds_catalog: { minSchemaVersion: 1, maxSchemaVersion: 1, maxRowsPerUser: 50, binary: false },
  abs_server: { minSchemaVersion: 1, maxSchemaVersion: 1, maxRowsPerUser: 50, binary: false },
  custom_translator: {
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    maxRowsPerUser: 50,
    binary: false,
  },
  translation_prompt: {
    minSchemaVersion: 1,
    maxSchemaVersion: 1,
    maxRowsPerUser: 100,
    binary: false,
  },
  custom_tts: { minSchemaVersion: 1, maxSchemaVersion: 1, maxRowsPerUser: 50, binary: false },
  settings: { minSchemaVersion: 1, maxSchemaVersion: 1, maxRowsPerUser: 1, binary: false },
};

/** Whether the kind is on the server allowlist. */
export const isAllowedKind = (kind: string): boolean => Object.hasOwn(KIND_ALLOWLIST, kind);

/** The largest number of rows one push may carry. */
export const MAX_PUSH_BATCH = 100;

/** The largest number of cursors one batched pull may carry. */
export const MAX_PULL_BATCH = 50;

/** The largest serialized payload one row may carry. */
export const MAX_JSON_BYTES = 64 * 1024;

/** The largest number of fields one row may carry. */
export const MAX_FIELD_COUNT = 64;

/** The longest manifest filename one row may carry. */
export const MAX_FILENAME_LEN = 255;

/** A validation failure, in the shape the client's error reader expects. */
export interface ValidationFailure {
  status: number;
  code: string;
  message: string;
  offendingIndex?: number;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ValidationFailure };

const fail = (
  status: number,
  code: string,
  message: string,
  offendingIndex?: number,
): { ok: false; failure: ValidationFailure } => ({
  ok: false,
  failure: {
    status,
    code,
    message,
    ...(typeof offendingIndex === 'number' ? { offendingIndex } : {}),
  },
});

/** Whether a value is a plain object. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The serialized size of a JSON value, in bytes. */
export const measureJsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Whether a field envelope has the shape the client writes.
 *
 * Both the plaintext envelope (`{v, t, s}`) and the encrypted one
 * (`{c, i, s, alg, h}`) are accepted; the server compares their clocks and
 * never looks inside them.
 */
export const isFieldEnvelope = (value: unknown): boolean => {
  if (!isPlainObject(value)) return false;
  const hasPlain = 'v' in value && 't' in value && 's' in value;
  const hasCipher = 'c' in value && 'i' in value && 's' in value && 'alg' in value && 'h' in value;
  if (!hasPlain && !hasCipher) return false;
  if (typeof value['s'] !== 'string') return false;
  if (hasPlain && typeof value['t'] !== 'string') return false;
  return true;
};

/** Whether a manifest filename is acceptable. */
export const isValidFilename = (name: unknown): boolean => {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > MAX_FILENAME_LEN) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes('..')) return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
};

/** Whether a manifest has the shape the client writes. */
export const isValidManifest = (value: unknown): boolean => {
  if (!isPlainObject(value)) return false;
  const files = value['files'];
  if (!Array.isArray(files)) return false;
  if (!Number.isInteger(value['schemaVersion'])) return false;
  return files.every(
    (file) =>
      isPlainObject(file) &&
      isValidFilename(file['filename']) &&
      Number.isInteger(file['byteSize']) &&
      (file['byteSize'] as number) >= 0 &&
      typeof file['partialMd5'] === 'string' &&
      (file['sha256'] === undefined || /^[0-9a-f]{64}$/.test(String(file['sha256']))),
  );
};

export interface PushRowInput {
  kind: string;
  replica_id: string;
  fields_jsonb: Record<string, unknown>;
  manifest_jsonb: unknown;
  deleted_at_ts: string | null;
  reincarnation: string | null;
  updated_at_ts: string;
  schema_version: number;
}

/**
 * Validate one pushed row.
 *
 * The checks are ordered from the cheapest to the most expensive so a
 * malformed batch fails on the first offending row rather than after the
 * whole payload has been walked.
 */
export const validatePushRow = (
  row: unknown,
  userId: string,
  index: number,
  nowMs: number,
): ValidationResult<PushRowInput> => {
  if (!isPlainObject(row)) {
    return fail(400, 'VALIDATION', `row[${index}] must be an object`, index);
  }
  if (row['user_id'] !== userId) {
    return fail(403, 'AUTH', `row[${index}].user_id does not match authenticated user`, index);
  }
  const kind = row['kind'];
  if (typeof kind !== 'string' || !isAllowedKind(kind)) {
    return fail(
      422,
      'UNKNOWN_KIND',
      `row[${index}].kind=${String(kind)} is not in the server allowlist`,
      index,
    );
  }
  const spec = KIND_ALLOWLIST[kind]!;
  const replicaId = row['replica_id'];
  if (typeof replicaId !== 'string' || replicaId.length === 0 || replicaId.length > 512) {
    return fail(400, 'VALIDATION', `row[${index}].replica_id must be a non-empty string`, index);
  }
  const schemaVersion = row['schema_version'];
  if (
    !Number.isInteger(schemaVersion) ||
    (schemaVersion as number) < spec.minSchemaVersion ||
    (schemaVersion as number) > spec.maxSchemaVersion
  ) {
    return fail(
      422,
      'SCHEMA_TOO_NEW',
      `row[${index}].schema_version ${String(schemaVersion)} out of bounds [${spec.minSchemaVersion}, ${spec.maxSchemaVersion}] for kind ${kind}`,
      index,
    );
  }
  const updatedAt = row['updated_at_ts'];
  if (typeof updatedAt !== 'string' || updatedAt.length === 0) {
    return fail(400, 'VALIDATION', `row[${index}].updated_at_ts must be a non-empty string`, index);
  }
  if (!isHlc(updatedAt)) {
    return fail(400, 'VALIDATION', `row[${index}].updated_at_ts is not a well-formed clock`, index);
  }
  if (!isHlcWithinSkew(updatedAt, nowMs)) {
    return fail(
      409,
      'CLOCK_SKEW',
      `row[${index}].updated_at_ts physical time is outside the accepted skew of server`,
      index,
    );
  }
  const deletedAt = row['deleted_at_ts'];
  if (deletedAt !== null && deletedAt !== undefined) {
    if (typeof deletedAt !== 'string') {
      return fail(400, 'VALIDATION', `row[${index}].deleted_at_ts must be a string or null`, index);
    }
    if (!isHlc(deletedAt)) {
      return fail(
        400,
        'VALIDATION',
        `row[${index}].deleted_at_ts is not a well-formed clock`,
        index,
      );
    }
    if (!isHlcWithinSkew(deletedAt, nowMs)) {
      return fail(
        409,
        'CLOCK_SKEW',
        `row[${index}].deleted_at_ts physical time is outside the accepted skew of server`,
        index,
      );
    }
  }
  const fields = row['fields_jsonb'];
  if (!isPlainObject(fields)) {
    return fail(400, 'VALIDATION', `row[${index}].fields_jsonb must be an object`, index);
  }
  const fieldKeys = Object.keys(fields);
  if (fieldKeys.length > MAX_FIELD_COUNT) {
    return fail(
      422,
      'VALIDATION',
      `field count ${fieldKeys.length} exceeds MAX_FIELD_COUNT=${MAX_FIELD_COUNT}`,
      index,
    );
  }
  if (measureJsonBytes(fields) > MAX_JSON_BYTES) {
    return fail(
      422,
      'VALIDATION',
      `fields_jsonb size exceeds MAX_JSON_BYTES=${MAX_JSON_BYTES}`,
      index,
    );
  }
  if (!fieldKeys.every((key) => isFieldEnvelope(fields[key]))) {
    return fail(422, 'VALIDATION', `row[${index}] malformed field envelope`, index);
  }
  // The row's own clock is checked above, but the row's CONTENT clock is
  // computed from the field envelopes (`computeUpdatedAt`), and that is what
  // the account's pull cursor follows. A field clock far in the future would
  // push the stored clock — and with it the cursor — into the future, and the
  // cursor only moves forward: the sync of the whole account would freeze for
  // ever. The plaintext envelope carries its clock, so it can be checked here.
  // The encrypted one keeps it inside the ciphertext, so the server cannot
  // see it (the client checks its own clocks before publishing).
  for (const key of fieldKeys) {
    const envelope = fields[key] as Record<string, unknown>;
    const clock = envelope['t'];
    if (typeof clock !== 'string') continue;
    if (!isHlc(clock)) {
      return fail(
        400,
        'VALIDATION',
        `row[${index}].fields_jsonb[${key}].t is not a well-formed clock`,
        index,
      );
    }
    if (!isHlcWithinSkew(clock, nowMs)) {
      return fail(
        409,
        'CLOCK_SKEW',
        `row[${index}].fields_jsonb[${key}].t physical time is outside the accepted skew of server`,
        index,
      );
    }
  }
  const manifest = row['manifest_jsonb'];
  if (manifest !== null && manifest !== undefined) {
    if (!isValidManifest(manifest)) {
      return fail(422, 'VALIDATION', `row[${index}] malformed manifest_jsonb`, index);
    }
  }
  const reincarnation = row['reincarnation'];
  if (reincarnation !== null && reincarnation !== undefined && typeof reincarnation !== 'string') {
    return fail(400, 'VALIDATION', `row[${index}].reincarnation must be a string or null`, index);
  }

  return {
    ok: true,
    value: {
      kind,
      replica_id: replicaId,
      fields_jsonb: fields,
      manifest_jsonb: manifest === undefined ? null : manifest,
      deleted_at_ts: typeof deletedAt === 'string' ? deletedAt : null,
      reincarnation: typeof reincarnation === 'string' ? reincarnation : null,
      updated_at_ts: updatedAt,
      schema_version: schemaVersion as number,
    },
  };
};

/**
 * Validate a push body: `{ rows: [...] }`.
 *
 * The row-level checks are the same ones the hosted backend applies, so a
 * self-hosted deployment rejects the same payloads the hosted one does.
 */
export const validatePushBatch = (
  body: unknown,
  userId: string,
  nowMs: number,
): ValidationResult<PushRowInput[]> => {
  if (!isPlainObject(body)) {
    return fail(400, 'VALIDATION', 'body must be an object');
  }
  const rows = body['rows'];
  if (!Array.isArray(rows)) {
    return fail(400, 'VALIDATION', 'body.rows must be an array');
  }
  if (rows.length === 0) return { ok: true, value: [] };
  if (rows.length > MAX_PUSH_BATCH) {
    return fail(
      413,
      'VALIDATION',
      `batch size ${rows.length} exceeds MAX_PUSH_BATCH=${MAX_PUSH_BATCH}`,
    );
  }
  const out: PushRowInput[] = [];
  for (let i = 0; i < rows.length; i++) {
    const result = validatePushRow(rows[i], userId, i, nowMs);
    if (!result.ok) return result;
    out.push(result.value);
  }
  return { ok: true, value: out };
};

/** Validate the query parameters of a per-kind pull. */
export const validatePullParams = (
  kind: string | null,
  since: string | null,
): ValidationResult<{ kind: string; since: string | null }> => {
  if (!kind) {
    return fail(400, 'VALIDATION', 'kind query parameter required');
  }
  if (!isAllowedKind(kind)) {
    return fail(422, 'UNKNOWN_KIND', `kind=${kind} is not in the server allowlist`);
  }
  return { ok: true, value: { kind, since: since || null } };
};

export interface PullCursor {
  kind: string;
  since: string | null;
}

/**
 * Validate a batched-pull body: `{ cursors: [{kind, since}] }`.
 *
 * A kind may appear only once: the batch answers one result per cursor, and a
 * duplicated kind would make the answer ambiguous.
 */
export const validatePullBatch = (body: unknown): ValidationResult<PullCursor[]> => {
  if (!isPlainObject(body)) {
    return fail(400, 'VALIDATION', 'body must be an object');
  }
  const cursors = body['cursors'];
  if (!Array.isArray(cursors)) {
    return fail(400, 'VALIDATION', 'body.cursors must be an array');
  }
  if (cursors.length === 0) return { ok: true, value: [] };
  if (cursors.length > MAX_PULL_BATCH) {
    return fail(
      413,
      'VALIDATION',
      `cursors.length ${cursors.length} exceeds MAX_PULL_BATCH=${MAX_PULL_BATCH}`,
    );
  }
  const seen = new Set<string>();
  const out: PullCursor[] = [];
  for (let i = 0; i < cursors.length; i++) {
    const cursor = cursors[i];
    if (!isPlainObject(cursor)) {
      return fail(400, 'VALIDATION', `cursors[${i}] must be an object`, i);
    }
    const kind = cursor['kind'];
    if (typeof kind !== 'string' || kind.length === 0) {
      return fail(400, 'VALIDATION', `cursors[${i}].kind must be a non-empty string`, i);
    }
    if (!isAllowedKind(kind)) {
      return fail(
        422,
        'UNKNOWN_KIND',
        `cursors[${i}].kind=${kind} is not in the server allowlist`,
        i,
      );
    }
    if (seen.has(kind)) {
      return fail(400, 'VALIDATION', `cursors[${i}].kind=${kind} is duplicated in the batch`, i);
    }
    seen.add(kind);
    const since = cursor['since'];
    if (since !== null && since !== undefined && typeof since !== 'string') {
      return fail(400, 'VALIDATION', `cursors[${i}].since must be a string or null`, i);
    }
    out.push({ kind, since: typeof since === 'string' && since.length > 0 ? since : null });
  }
  return { ok: true, value: out };
};
