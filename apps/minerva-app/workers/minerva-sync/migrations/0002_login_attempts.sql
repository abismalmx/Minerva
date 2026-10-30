-- Minerva self-hosted sync backend — sign-in throttling.
--
-- The failed sign-in attempts of each account. The Worker refuses the sign-in
-- with 429 once the threshold is reached, so a passphrase cannot be guessed by
-- brute force (SEC-02). `locked_until` is a unix timestamp; NULL means "not
-- locked".
--
-- This table is also declared in 0001_init.sql for fresh installs; D1 applies
-- each migration file once, so an already-migrated database needs this one.
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_locked ON login_attempts (locked_until);
