-- Minerva self-hosted sync backend — KOSync progress and the reading views.
--
-- `kosync_progress` is also declared in 0001_init.sql for fresh installs; D1
-- applies each migration file once, so an already-migrated database needs this
-- one. The same holds for the `book_highlights` / `book_bookmarks` views,
-- which the spec lists as schema objects of their own.
--
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

-- The highlights and the bookmarks are the annotations of `book_notes`,
-- discriminated by the `type` column — the client's wire protocol sends them
-- in the SAME `notes` array. These views expose the same rows under the names
-- the spec uses.
CREATE VIEW IF NOT EXISTS book_highlights AS
  SELECT * FROM book_notes WHERE type IN ('annotation', 'excerpt') AND style IS NOT NULL;

CREATE VIEW IF NOT EXISTS book_bookmarks AS
  SELECT * FROM book_notes WHERE type = 'bookmark';
