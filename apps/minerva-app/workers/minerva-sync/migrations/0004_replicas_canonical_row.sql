-- Minerva self-hosted sync backend — one canonical row per replica.
--
-- The first schema stored one row per (user, kind, replica, hlc): an
-- append-only log of every version a device ever pushed. That was wrong. The
-- client publishes PATCHES — `publishReplicaUpsert()` stamps only the fields
-- it changed, and `publishReplicaManifest()` publishes an EMPTY field set
-- with just a new manifest — so the server has to MERGE a push into the
-- account's canonical row. An append-only log would drop every field the
-- patch did not mention, and a manifest publication would wipe the row.
--
-- The table is rebuilt with the canonical primary key and the versions that
-- are already stored are folded into it with the same per-field
-- last-writer-wins rule the Worker applies at runtime: for every field the
-- envelope with the largest clock wins, ties are broken by the device id, a
-- tombstone is the largest tombstone seen, and a manifest is never cleared
-- by a version that carries none.
--
-- The fold is written in plain SQLite (JSON1 + window functions, no
-- PostgreSQL-only constructs), so it runs on D1 exactly as it runs in the
-- test suite.

CREATE TABLE IF NOT EXISTS replicas_canonical (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  replica_id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, replica_id)
);

INSERT INTO replicas_canonical (user_id, kind, replica_id, hlc, payload, updated_at)
WITH versions AS (
  SELECT user_id, kind, replica_id, hlc, payload, updated_at FROM replicas
),
per_replica AS (
  SELECT
    user_id,
    kind,
    replica_id,
    MAX(hlc) AS max_hlc,
    MAX(json_extract(payload, '$.deleted_at_ts')) AS deleted_at_ts,
    MAX(json_extract(payload, '$.schema_version')) AS schema_version
  FROM versions
  GROUP BY user_id, kind, replica_id
),
newest AS (
  SELECT v.*
  FROM versions v
  JOIN per_replica p
    ON p.user_id = v.user_id
   AND p.kind = v.kind
   AND p.replica_id = v.replica_id
   AND v.hlc = p.max_hlc
),
expanded AS (
  SELECT
    v.user_id,
    v.kind,
    v.replica_id,
    j.key AS field_key,
    j.value AS envelope,
    json_extract(j.value, '$.t') AS field_t,
    json_extract(j.value, '$.s') AS field_s
  FROM versions v
  JOIN json_each(json_extract(v.payload, '$.fields_jsonb')) j
),
winners AS (
  SELECT user_id, kind, replica_id, field_key, envelope, field_t
  FROM (
    SELECT
      e.*,
      ROW_NUMBER() OVER (
        PARTITION BY e.user_id, e.kind, e.replica_id, e.field_key
        ORDER BY e.field_t DESC, e.field_s DESC
      ) AS rn
    FROM expanded e
  )
  WHERE rn = 1
),
merged_fields AS (
  SELECT
    user_id,
    kind,
    replica_id,
    -- `json(envelope)` is not optional: a window function drops the JSON
    -- subtype, and without the explicit wrap the envelope would be embedded
    -- as a JSON STRING instead of a JSON object.
    json_group_object(field_key, json(envelope)) AS fields_jsonb,
    MAX(field_t) AS max_field_t
  FROM winners
  GROUP BY user_id, kind, replica_id
),
manifest_pick AS (
  SELECT user_id, kind, replica_id, json_extract(payload, '$.manifest_jsonb') AS manifest_jsonb
  FROM (
    SELECT
      v.*,
      ROW_NUMBER() OVER (
        PARTITION BY v.user_id, v.kind, v.replica_id
        ORDER BY v.hlc DESC
      ) AS rn
    FROM versions v
    WHERE json_extract(v.payload, '$.manifest_jsonb') IS NOT NULL
  )
  WHERE rn = 1
),
reincarnation_pick AS (
  SELECT user_id, kind, replica_id, json_extract(payload, '$.reincarnation') AS reincarnation
  FROM (
    SELECT
      v.*,
      ROW_NUMBER() OVER (
        PARTITION BY v.user_id, v.kind, v.replica_id
        ORDER BY v.hlc DESC
      ) AS rn
    FROM versions v
    WHERE json_extract(payload, '$.reincarnation') IS NOT NULL
  )
  WHERE rn = 1
)
SELECT
  p.user_id,
  p.kind,
  p.replica_id,
  -- The clock of the folded row never regresses: it is the largest of every
  -- version's clock, every field clock and the tombstone, so the pull cursor
  -- stays monotonic for the peers that already synced.
  MAX(p.max_hlc, COALESCE(mf.max_field_t, ''), COALESCE(p.deleted_at_ts, '')) AS hlc,
  json_set(
    json_patch(
      json(n.payload),
      json_object('fields_jsonb', json(COALESCE(mf.fields_jsonb, '{}')))
    ),
    '$.deleted_at_ts', p.deleted_at_ts,
    '$.reincarnation', rp.reincarnation,
    -- `json(...)` keeps the manifest a JSON OBJECT: `json_extract` returns its
    -- text form, and a bare text would be embedded as a JSON string.
    '$.manifest_jsonb', json(mp.manifest_jsonb),
    '$.schema_version', COALESCE(p.schema_version, 1)
  ) AS payload,
  n.updated_at
FROM per_replica p
JOIN newest n
  ON n.user_id = p.user_id AND n.kind = p.kind AND n.replica_id = p.replica_id
LEFT JOIN merged_fields mf
  ON mf.user_id = p.user_id AND mf.kind = p.kind AND mf.replica_id = p.replica_id
LEFT JOIN manifest_pick mp
  ON mp.user_id = p.user_id AND mp.kind = p.kind AND mp.replica_id = p.replica_id
LEFT JOIN reincarnation_pick rp
  ON rp.user_id = p.user_id AND rp.kind = p.kind AND rp.replica_id = p.replica_id;

DROP TABLE IF EXISTS replicas;

ALTER TABLE replicas_canonical RENAME TO replicas;

CREATE INDEX IF NOT EXISTS idx_replicas_user_kind_hlc ON replicas (user_id, kind, hlc);
