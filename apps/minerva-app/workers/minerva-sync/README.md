# minerva-sync — self-hosted Minerva backend on Cloudflare

A self-hosted replacement for Minerva Cloud: your library, reading progress,
notes, settings and reading statistics, stored in **D1 (SQLite)** and **R2**,
served by a single **Cloudflare Worker**.

It serves two API surfaces:

| Surface | Routes | Who speaks it |
| --- | --- | --- |
| Native Minerva sync API | `/api/sync`, `/api/sync/replicas`, `/api/sync/replica-keys`, `/api/storage/*`, `/api/auth/*`, `/api/user/*` | The Minerva app (desktop, mobile, web) |

The native surface is the SAME contract the hosted backend exposes
(`apps/minerva-app/src/pages/api` and `src/app/api`), so an unmodified Minerva
build can talk to this Worker by pointing `API_BASE_URL` at it.

## Cost

Everything here fits in Cloudflare's **free tier**:

- Workers — 100k requests/day on the free plan.
- D1 — 5M rows read/day, 100k rows written/day.
- R2 — 10 GB stored, 1M Class A and 10M Class B operations/month. No egress
  fees.

No credit card is required to start.

## 1. Create the resources

```bash
cd apps/minerva-app/workers/minerva-sync

# The D1 database.
wrangler d1 create minerva-sync
# → prints a database_id; paste it into wrangler.toml

# The R2 bucket for the book files, covers and replica blobs.
wrangler r2 bucket create minerva-library
```

Then edit `wrangler.toml`:

```toml
[[d1_databases]]
binding = "SYNC_DB"
database_name = "minerva-sync"
database_id = "<the id wrangler printed>"
```

## 2. Apply the schema

```bash
# Locally, to try it out.
pnpm migrate

# Against the real database.
pnpm migrate:remote
```

The migrations are ordered and each one is applied exactly once:

| File | What it does |
| --- | --- |
| `0001_init.sql` | The whole schema: accounts, throttle, library, notes, files, stats, replicas, salts, KOSync progress (no longer written), and the `book_highlights` / `book_bookmarks` views. |
| `0002_login_attempts.sql` | The sign-in throttle table, for databases that ran the first schema before it had one. |
| `0003_kosync_progress.sql` | The KOSync progress table and the two views, for the same reason. The Worker no longer serves KOSync; the table stays so existing databases keep migrating and is emptied with the account. |
| `0004_replicas_canonical_row.sql` | Rebuilds `replicas` with one row per `(kind, replica_id)` and folds the versions a pre-release schema had appended. |

## 3. Set the signing secret

The Worker mints its own access tokens (HS256) and the signed URLs the
storage routes hand out. The secret lives in the Worker secret store —
**never** in `wrangler.toml`:

```bash
wrangler secret put JWT_SECRET
```

Use a long random value (32+ characters). Without it the Worker answers `503`
on every authenticated route — it fails closed rather than issue unsigned
tokens.

## 4. Deploy

```bash
pnpm deploy
```

The default `workers.dev` URL works out of the box. To use your own domain,
add a route to `wrangler.toml`:

```toml
[[routes]]
pattern = "sync.example.com"
zone_name = "example.com"
custom_domain = true
```

## 5. Point the app at it

In the app's environment (see `.env.local.example`):

```dotenv
# The Worker's origin. The app appends `/api` to it.
NEXT_PUBLIC_API_BASE_URL=https://sync.example.com

# Switch the account layer from Supabase to the Worker.
SELF_HOSTED_BACKEND=true
NEXT_PUBLIC_SELF_HOSTED_BACKEND=true
```

`SELF_HOSTED_BACKEND` and `SELF_HOSTED` are different switches:

- `SELF_HOSTED=true` unlocks the premium features (no store to buy from).
- `SELF_HOSTED_BACKEND=true` authenticates against your Worker instead of
  Minerva Cloud.

A deployment that only wants the premium unlock keeps `SELF_HOSTED_BACKEND`
off and continues to use Minerva Cloud.

## 6. Sign up

Open the app, go to **Sign in**, and create an account with an email and a
passphrase. The passphrase is what encrypts your synced credentials; the
server only ever stores its SHA-256 digest, so **it cannot recover it**. Keep
it somewhere safe — the same passphrase is what you enter in the app's
Settings → Sync passphrase section.

## The routes, in detail

### Accounts

| Route | Notes |
| --- | --- |
| `POST /api/auth/register` | `{ email, passphrase }` — or `{ email, passhash }` with a SHA-256 the client computed itself. An optional `username` names the account; otherwise one is derived from the email. |
| `POST /api/auth/login` | `{ email, passphrase }` — or `{ email, passhash }`. Answers `429` once the account is locked out. |
| `GET /api/auth/me` | The account and its plan. |
| `POST /api/auth/email` | Changes the email. |
| `DELETE /api/auth/account` | Removes the account and everything it owns. `DELETE /api/user/delete` is the same route under the name the client calls. |
| `DELETE /api/user/library` | Clears the cloud library, keeps the account. |

### Sync

| Route | Notes |
| --- | --- |
| `GET /api/sync` | `?since=<ms>&type=&book=&meta_hash=&limit=` — the incremental pull. Books key on the server-assigned `synced_at` cursor; configs and notes on `updated_at`. |
| `POST /api/sync` | Pushes books, configs, notes and reading statistics. The answer echoes the authoritative rows. |
| `GET /api/sync/replicas` | `?kind=&since=<hlc>` — pulls one replica kind. |
| `POST /api/sync/replicas` | `{ rows }` pushes, `{ cursors }` pulls several kinds in one round trip. |
| `GET /api/sync/replica-keys` | The account's passphrase salts. |
| `POST /api/sync/replica-keys` | `{ alg }` — the SERVER mints the salt. |
| `DELETE /api/sync/replica-keys` | Forgets every salt and envelope. |

### Storage

| Route | Notes |
| --- | --- |
| `POST /api/storage/upload` | Reserves a slot, enforces the quota and answers the signed upload URL (plus the matching download URL). |
| `GET /api/storage/download` | `?fileKey=` — one download URL. |
| `POST /api/storage/download` | `{ fileKeys }` — several download URLs. |
| `GET /api/storage/list` | `?page=&pageSize=&bookHash=&search=&sortBy=&sortOrder=` |
| `GET /api/storage/stats` | Usage, quota and the breakdown per book. |
| `DELETE /api/storage/delete` | `?fileKey=` (or a JSON body). |
| `DELETE /api/storage/purge` | `{ fileKeys }` — bulk delete, up to 100 keys. |

## How the replicas are merged

The client publishes **patches**, not full rows: a settings change carries
only the field that changed, and a manifest publication carries an empty field
set. So the server is the only place where two sides can be combined — a
server that merely stored the incoming row would drop every field the patch
did not mention.

The Worker therefore keeps **one row per `(kind, replica_id)`** and merges
every push into it with the same per-field last-writer-wins rules the client
uses (`src/crdt.ts`):

- a field is won by the envelope with the larger clock, ties by the device id;
- a tombstone is the largest tombstone seen, and a field write never revives
  a tombstoned row;
- a manifest is never cleared by a version that carries none;
- the row's clock never regresses, so the pull cursor stays monotonic.

Two devices pushing the same replica at the same time is safe: the write is a
compare-and-set on the row's clock, and a lost race re-reads and re-merges.

## How the account passphrase is stored

The Worker never stores the account passphrase. What it stores is derived from
it, and the derivation is deliberately slow:

- `PBKDF2-HMAC-SHA256` with a random 16-byte salt per
  account, 600 000 iterations by default (`PASSPHRASE_KDF_ITERATIONS` in
  `wrangler.toml`; the count is stored with each hash, so lowering it never
  invalidates the accounts that already exist). A dump of the `users` table is
  therefore not enough to recover a passphrase, not even a weak one.
Accounts created before this change hold an unsalted SHA-256 and, in the
`userkey` column, a digest of the passphrase left over from KOSync. They keep
working: the first sign-in with the passphrase re-stretches the first and clears
the second, so a deployment needs no migration.

## What is stored where

| Data | Where |
| --- | --- |
| Accounts (email, stretched digests) | D1 `users` |
| Failed sign-in attempts | D1 `login_attempts` |
| Library metadata (titles, authors, tags, status) | D1 `books` |
| Reading progress and view settings | D1 `book_configs` |
| Notes, highlights, bookmarks, ink | D1 `book_notes` (also readable through the `book_highlights` and `book_bookmarks` views) |
| Reading statistics | D1 `stat_books`, `stat_pages` |
| Synced settings, shelves, translators | D1 `replicas`, `replica_keys` |
| Book files, covers, replica blobs | R2 `minerva-library` |

Every row is scoped by `user_id` and every query filters on it, so one account
can never read another's data.

## Encryption

The app encrypts sensitive synced fields (catalog passwords and the like) with
a key derived from your **sync passphrase** before uploading them; the server
stores only the salt and the ciphertext. The passphrase is separate from the
**account passphrase** — the Worker never sees either of them.

## Notes and limitations

- **No email.** A self-hosted deployment has no mail server, so there is no
  magic link, no password-reset email and no OAuth sign-in. The sign-in page
  hides those options when `SELF_HOSTED_BACKEND` is on.
- **Upload size.** Cloudflare's Worker body limit is 100 MB on the free plan.
  The Worker rejects a larger upload with `413` rather than truncating it.
- **Token verification.** The client cannot verify a token locally (it does
  not hold the signing secret), so each authenticated request is verified by
  the Worker. That is one extra round trip per request, already counted in
  the request above.
- **Per-kind payload schemas.** The server checks the kind allowlist, the
  schema version bounds, the field-count and payload-size caps, the envelope
  shape and the clock skew. The per-kind field schemas (what a dictionary
  entry looks like, and so on) are checked by the client before it publishes.

## Building the Android app

Minerva is a **Tauri v2** app, not a Gradle project — there is no
`./gradlew assembleRelease`. The Android APK is built with the Tauri CLI
from `apps/minerva-app`:

```bash
cd apps/minerva-app

# The APK lands in
# src-tauri/gen/android/app/build/outputs/apk/universal/release/
pnpm tauri android build -t aarch64
```

To install it on a connected device:

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

The app reads its API base URL from the runtime config, so the APK built this
way talks to whatever `NEXT_PUBLIC_API_BASE_URL` was set to at build time —
point it at your Worker's origin before building.

## Development

```bash
pnpm install          # inside this directory
pnpm typecheck        # tsc --noEmit
pnpm dev              # wrangler dev (local D1 + local R2)
pnpm migrate          # apply the migrations to the local D1
```

The Worker's pure logic (hashing, token minting, the merge rules) and its
route contracts are covered by the app's unit suite, which runs the real
migrations against a real SQLite database:

```bash
cd ../..
pnpm test --run src/__tests__/workers/
```
