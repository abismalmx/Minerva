/**
 * The CRDT primitives the replica surface is built on.
 *
 * A replica row is a bag of independently-versioned fields: every field
 * carries its own hybrid logical clock (HLC) and the device id that wrote it.
 * Merging two rows is therefore a per-field last-writer-wins operation, and
 * the whole thing is commutative, associative and idempotent — which is what
 * lets several devices push concurrently without a coordinator.
 *
 * This is a faithful port of the client's merge rules
 * (apps/minerva-app/src/libs/crdt.ts), which in turn mirror the hosted
 * backend's `crdt_merge_replica()` SQL function. The Worker needs its own
 * copy because the merge has to happen SERVER-SIDE: the client pushes a
 * PATCH (only the fields it changed, and sometimes an empty field set when it
 * publishes a manifest), so a server that merely stored the incoming row
 * would drop every field the patch did not mention.
 *
 * The HLC format is `${physicalMs:13-hex}-${counter:8-hex}-${deviceId}`, and
 * the fixed-width hex prefix makes a plain lexicographic comparison match
 * temporal order — which is what lets the pull cursor be a `>` on a TEXT
 * column.
 */

export type Hlc = string;

/** One field of a replica row: the value, the clock and the writer. */
export interface FieldEnvelope {
  /** The field value. `unknown` — the server never interprets it. */
  v: unknown;
  /** The HLC of the write. */
  t: Hlc;
  /** The device id of the writer. The tiebreak when two clocks are equal. */
  s: string;
}

/**
 * A field that carries an encrypted payload instead of a plaintext value.
 *
 * The server treats it as an opaque envelope: it only compares the clocks, so
 * the ciphertext never has to be decrypted to merge two rows.
 */
export interface CipherEnvelope {
  c: string;
  i: string;
  s: string;
  alg: string;
  h: string;
}

/** The field bag of a replica row. */
export type FieldsObject = Record<string, FieldEnvelope>;
/** One binary file listed in a manifest. */
export interface ManifestFile {
  filename: string;
  byteSize: number;
  partialMd5: string;
  sha256?: string;
  mtime?: number;
}

/** The committed binary manifest of a replica row. */
export interface Manifest {
  files: ManifestFile[];
  schemaVersion: number;
}

/** A replica row, in the shape the client speaks. */
export interface ReplicaRow {
  user_id: string;
  kind: string;
  replica_id: string;
  fields_jsonb: FieldsObject;
  manifest_jsonb: Manifest | null;
  deleted_at_ts: Hlc | null;
  reincarnation: string | null;
  updated_at_ts: Hlc;
  schema_version: number;
}

/** The zero HLC — sorts below every real clock. */
export const HLC_ZERO = '0000000000000-00000000-';

/** The largest clock a device may be behind the server by, in milliseconds. */
export const HLC_SKEW_TOLERANCE_MS = 60_000;

/** Compare two clocks. Lexicographic order matches temporal order. */
export const hlcCompare = (a: Hlc, b: Hlc): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);

/** The larger of two clocks. `null` loses against any clock. */
export const hlcMax = (a: Hlc | null, b: Hlc | null): Hlc | null => {
  if (!a) return b;
  if (!b) return a;
  return hlcCompare(a, b) >= 0 ? a : b;
};

/** The physical time (epoch ms) an HLC was minted at. */
export const hlcPhysicalMs = (hlc: Hlc): number => {
  const dash = hlc.indexOf('-');
  if (dash <= 0) return Number.NaN;
  return Number.parseInt(hlc.slice(0, dash), 16);
};

/**
 * Whether a clock is well-formed enough to be stored and compared.
 *
 * The format is `${physicalMs:13-hex}-${counter:8-hex}-${deviceId}`; the
 * fixed-width hex prefix is what makes the lexicographic order match the
 * temporal one.
 */
export const isHlc = (value: unknown): value is Hlc => {
  if (typeof value !== 'string' || value.length === 0) return false;
  const first = value.indexOf('-');
  const second = value.indexOf('-', first + 1);
  if (first !== 13 || second < 0) return false;
  if (!/^[0-9a-f]{13}$/.test(value.slice(0, first))) return false;
  if (!/^[0-9a-f]{8}$/.test(value.slice(first + 1, second))) return false;
  return value.length > second + 1;
};

/**
 * The physical time of a clock must not drift too far from the server's.
 *
 * A device with a broken clock would otherwise stamp HLCs in the far future
 * and poison the pull cursor for every other device of that account: the
 * cursor would jump past rows the other devices never saw.
 */
export const isHlcWithinSkew = (
  hlc: Hlc,
  nowMs: number,
  toleranceMs = HLC_SKEW_TOLERANCE_MS,
): boolean => {
  const physical = hlcPhysicalMs(hlc);
  if (!Number.isFinite(physical)) return false;
  return Math.abs(physical - nowMs) <= toleranceMs;
};

/** The envelope that wins a field conflict: the larger clock, ties by device. */
const pickWinner = (a: FieldEnvelope, b: FieldEnvelope): FieldEnvelope => {
  const cmp = hlcCompare(a.t, b.t);
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  return a.s >= b.s ? a : b;
};

/**
 * Merge two field bags.
 *
 * Per key: the envelope with the larger clock wins; on an exact clock tie the
 * larger device id wins, so the merge is deterministic on every device. Keys
 * present on only one side are kept — that is what makes the merge
 * forwards-compatible across schema version bumps.
 */
export const mergeFields = (local: FieldsObject, remote: FieldsObject): FieldsObject => {
  const out: FieldsObject = { ...local };
  for (const key of Object.keys(remote)) {
    const lo = local[key];
    const re = remote[key]!;
    out[key] = lo ? pickWinner(lo, re) : re;
  }
  return out;
};

/**
 * The content clock of a merged row: the largest clock among its fields and
 * its tombstone.
 */
export const computeUpdatedAt = (fields: FieldsObject, deletedAt: Hlc | null): Hlc => {
  let max: Hlc | null = deletedAt;
  for (const key of Object.keys(fields)) {
    max = hlcMax(max, fields[key]!.t);
  }
  return max ?? HLC_ZERO;
};

/**
 * Merge two versions of the same replica row.
 *
 * The rules, in the order they matter:
 *
 * - **Fields** merge per field (larger clock wins).
 * - **The tombstone wins.** `deleted_at_ts` is the larger of the two, and a
 *   field write never revives a tombstoned row — only an explicit
 *   reincarnation token does.
 * - **The manifest** is replaced by the side with the larger ROW clock; a null
 *   manifest never clears a committed one (a manifest is published after the
 *   binaries are uploaded, so a null one is "not yet", not "removed").
 * - **The reincarnation token** is the one whose ROW clock is larger, and it
 *   is dropped when the tombstone is at least as new as it.
 * - **The row clock never regresses**: it is the largest of the content clock
 *   and the two incoming row clocks, so the pull cursor stays monotonic.
 */
export const mergeReplica = (local: ReplicaRow, remote: ReplicaRow): ReplicaRow => {
  const fields = mergeFields(local.fields_jsonb, remote.fields_jsonb);
  const deletedAt = hlcMax(local.deleted_at_ts, remote.deleted_at_ts);

  const reincarnationCandidates = [
    local.reincarnation ? { token: local.reincarnation, t: local.updated_at_ts } : null,
    remote.reincarnation ? { token: remote.reincarnation, t: remote.updated_at_ts } : null,
  ].filter((candidate): candidate is { token: string; t: Hlc } => candidate !== null);
  const winningReincarnation =
    reincarnationCandidates.length === 0
      ? null
      : reincarnationCandidates.reduce((a, b) => (hlcCompare(a.t, b.t) >= 0 ? a : b));
  const reincarnation =
    winningReincarnation && (!deletedAt || hlcCompare(winningReincarnation.t, deletedAt) > 0)
      ? winningReincarnation.token
      : null;

  const manifest =
    remote.manifest_jsonb === null
      ? local.manifest_jsonb
      : local.manifest_jsonb === null
        ? remote.manifest_jsonb
        : hlcCompare(remote.updated_at_ts, local.updated_at_ts) > 0
          ? remote.manifest_jsonb
          : local.manifest_jsonb;

  const contentUpdatedAt = computeUpdatedAt(fields, deletedAt);
  const updatedAt =
    hlcMax(hlcMax(contentUpdatedAt, local.updated_at_ts), remote.updated_at_ts) ?? contentUpdatedAt;

  return {
    user_id: local.user_id,
    kind: local.kind,
    replica_id: local.replica_id,
    fields_jsonb: fields,
    manifest_jsonb: manifest,
    deleted_at_ts: deletedAt,
    reincarnation,
    updated_at_ts: updatedAt,
    schema_version: Math.max(local.schema_version, remote.schema_version),
  };
};

/** The row a push creates when the account has no stored version yet. */
export const emptyReplicaRow = (userId: string, kind: string, replicaId: string): ReplicaRow => ({
  user_id: userId,
  kind,
  replica_id: replicaId,
  fields_jsonb: {},
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC_ZERO,
  schema_version: 1,
});
