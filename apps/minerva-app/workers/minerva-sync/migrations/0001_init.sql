-- Minerva self-hosted sync backend — initial schema.
--
-- Mirrors the Postgres schema the hosted backend uses (docker/volumes/db/init/
-- schema.sql plus its migrations), reduced to the columns the sync API reads
-- and writes. SQLite dialect: no uuid type (text), no jsonb (text), no
-- triggers that need plpgsql (the cursor is stamped in the Worker instead).
--
-- Every table is scoped by user_id; the Worker always filters on it, so a
-- user can never read another user's rows.

-- --- accounts -------------------------------------------------------------

-- One row per account. `passhash` is the SHA-256 of the passphrase, hex
-- encoded; `userkey` is the KOSync-compatible MD5 of the passphrase.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  passhash TEXT NOT NULL,
  userkey TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  storage_usage_bytes INTEGER NOT NULL DEFAULT 0,
  storage_purchased_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Email and username are unique, but a UNIQUE index (rather than a UNIQUE
-- constraint) so the Worker can look up with `WHERE email = ?` and get an
-- index scan. Emails are stored lower-cased.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- --- sign-in throttling ----------------------------------------------------

-- Failed sign-in attempts per account. The Worker refuses the sign-in with
-- 429 once the threshold is reached, so a passphrase cannot be guessed by
-- brute force. `locked_until` is a unix timestamp; NULL means "not locked".
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_locked ON login_attempts (locked_until);

-- --- library --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS books (
  user_id TEXT NOT NULL,
  book_hash TEXT NOT NULL,
  meta_hash TEXT,
  format TEXT NOT NULL DEFAULT 'EPUB',
  title TEXT NOT NULL DEFAULT '',
  source_title TEXT,
  author TEXT NOT NULL DEFAULT '',
  group_id TEXT,
  group_name TEXT,
  group_updated_at TEXT,
  tags TEXT,
  progress TEXT,
  reading_status TEXT,
  reading_status_updated_at TEXT,
  cover_hash TEXT,
  cover_updated_at TEXT,
  page_count INTEGER,
  metadata TEXT,
  metadata_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  uploaded_at TEXT,
  -- Server-assigned incremental-pull cursor, bumped on every write including
  -- deletes. The Postgres backend does this with a trigger; here the Worker
  -- stamps it explicitly so the pull cursor stays monotonic (issue #4678).
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_hash)
);

CREATE INDEX IF NOT EXISTS idx_books_user_synced ON books (user_id, synced_at);
CREATE INDEX IF NOT EXISTS idx_books_user_updated ON books (user_id, updated_at);
CREATE TABLE IF NOT EXISTS book_configs (
  user_id TEXT NOT NULL,
  book_hash TEXT NOT NULL,
  meta_hash TEXT,
  location TEXT,
  xpointer TEXT,
  progress TEXT,
  rsvp_position TEXT,
  search_config TEXT,
  view_settings TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  PRIMARY KEY (user_id, book_hash)
);

CREATE INDEX IF NOT EXISTS idx_book_configs_user_updated ON book_configs (user_id, updated_at);

CREATE TABLE IF NOT EXISTS book_notes (
  user_id TEXT NOT NULL,
  book_hash TEXT NOT NULL,
  meta_hash TEXT,
  id TEXT NOT NULL,
  type TEXT,
  cfi TEXT,
  xpointer0 TEXT,
  xpointer1 TEXT,
  page INTEGER,
  text TEXT,
  style TEXT,
  color TEXT,
  note TEXT,
  global_flag INTEGER,
  ink TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  PRIMARY KEY (user_id, book_hash, id)
);

CREATE INDEX IF NOT EXISTS idx_book_notes_user_updated ON book_notes (user_id, updated_at);

-- --- object storage bookkeeping ------------------------------------------

-- One row per stored object. `file_key` is the R2 object key, which is
-- `<user_id>/<fileName>` for the native sync API.
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_hash TEXT,
  replica_kind TEXT,
  replica_id TEXT,
  file_key TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_files_key ON files (file_key);
CREATE INDEX IF NOT EXISTS idx_files_user ON files (user_id, deleted_at);

-- --- reading statistics ---------------------------------------------------

CREATE TABLE IF NOT EXISTS stat_books (
  user_id TEXT NOT NULL,
  book_hash TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  authors TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  PRIMARY KEY (user_id, book_hash)
);

CREATE INDEX IF NOT EXISTS idx_stat_books_user_updated ON stat_books (user_id, updated_at);

CREATE TABLE IF NOT EXISTS stat_pages (
  user_id TEXT NOT NULL,
  book_hash TEXT NOT NULL,
  page INTEGER NOT NULL,
  start_time INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  total_pages INTEGER NOT NULL DEFAULT 0,
  ext TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  PRIMARY KEY (user_id, book_hash, page)
);

CREATE INDEX IF NOT EXISTS idx_stat_pages_user_updated ON stat_pages (user_id, updated_at);

-- --- replicas (settings, shelves, translators) ----------------------------

-- The CRDT replica rows the client pushes and pulls. `kind` selects the
-- replica family (settings, bookshelf, custom_translator, …) and `hlc` is the
-- hybrid logical clock used as the pull cursor.
--
-- ONE row per (user_id, kind, replica_id): the client publishes PATCHES (only
-- the fields it changed, and sometimes an empty field set when it publishes a
-- manifest), so the server has to merge every push into the account's
-- canonical row instead of appending a new version of it. `payload` holds the
-- JSON columns (`fields_jsonb`, `manifest_jsonb`) plus the non-JSON ones, and
-- `hlc` is the merged row's clock — the value the pull cursor compares
-- against.
CREATE TABLE IF NOT EXISTS replicas (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  replica_id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, replica_id)
);

CREATE INDEX IF NOT EXISTS idx_replicas_user_kind_hlc ON replicas (user_id, kind, hlc);

-- The passphrase salts. `salt` and `envelope` are opaque blobs minted by the
-- client; the Worker never interprets them.
CREATE TABLE IF NOT EXISTS replica_keys (
  user_id TEXT NOT NULL,
  salt_id TEXT NOT NULL,
  alg TEXT NOT NULL,
  salt TEXT NOT NULL,
  envelope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, salt_id)
);

CREATE INDEX IF NOT EXISTS idx_replica_keys_user_created ON replica_keys (user_id, created_at);

-- --- KOSync (KOReader-compatible) progress --------------------------------

-- The KOSync protocol stores one progress row per (user, document hash).
CREATE TABLE IF NOT EXISTS kosync_progress (
  user_id TEXT NOT NULL,
  document TEXT NOT NULL,
  progress TEXT NOT NULL DEFAULT '',
  percentage REAL NOT NULL DEFAULT 0,
  device TEXT,
  device_id TEXT,
  metadata TEXT,
  timestamp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, document)
);

CREATE INDEX IF NOT EXISTS idx_kosync_progress_user ON kosync_progress (user_id);

-- --- highlights and bookmarks ---------------------------------------------

-- The spec lists the highlights and the bookmarks as tables of their own.
-- Physically they are the annotations of `book_notes`, discriminated by the
-- `type` column — the client's wire protocol sends them in the SAME `notes`
-- array, so a separate table would need a second round trip and a second
-- merge rule for no gain. These views expose the same rows under the names
-- the spec uses, and cost nothing.
CREATE VIEW IF NOT EXISTS book_highlights AS
  SELECT * FROM book_notes WHERE type IN ('annotation', 'excerpt') AND style IS NOT NULL;

CREATE VIEW IF NOT EXISTS book_bookmarks AS
  SELECT * FROM book_notes WHERE type = 'bookmark';
