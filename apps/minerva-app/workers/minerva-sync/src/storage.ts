/**
 * The storage API: `POST /api/storage/upload`, `GET|POST /api/storage/download`,
 * `GET /api/storage/list`, `DELETE /api/storage/delete`.
 *
 * The client contract is the one the hosted backend exposes (apps/minerva-app/
 * src/pages/api/storage/*): the upload route answers a presigned URL the
 * client PUTs the bytes to, and the download route answers a URL the client
 * fetches.
 *
 * On Cloudflare the R2 **binding** is available inside the Worker, so no
 * SigV4 presigning is needed. The routes therefore answer URLs that point back
 * at the Worker itself:
 *
 * - Upload → `PUT /api/storage/object?key=<key>` (the client PUTs the bytes).
 * - Download → `GET /api/storage/object?key=<key>` (the client GETs the bytes).
 *
 * Both object routes require the caller's bearer token, and the key is checked
 * against the caller's own prefix, so a user can never reach another user's
 * objects.
 */

import { errorJson, json, nowIso, readJson, type Env } from './http';
import { mintTicket, verifyTicket } from './storageTicket';

const FILE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The largest number of files one purge request may carry. */
const MAX_PURGE_FILES = 100;

/**
 * The largest number of files one delete request may carry.
 *
 * The client deletes one file at a time (`DELETE /api/storage/delete?fileKey=…`),
 * so a hundred is already far more than it needs; the ceiling is here so a
 * script cannot turn one request into an unbounded number of D1 writes and R2
 * deletes.
 */
const MAX_DELETE_FILES = 100;

/**
 * The largest number of files one bulk-download request may carry.
 *
 * The client asks for the download URLs of every cover of the library in one
 * request (`batchGetDownloadUrls`), so the ceiling has to be well above the
 * size of a real library. What it must not be is unbounded: the request walks
 * its keys, and every key used to cost one D1 query.
 */
const MAX_DOWNLOAD_FILES = 1000;

/**
 * The largest number of bound parameters one D1 query may carry.
 *
 * D1 admits 100 bound parameters per query. A lookup that walks the keys one
 * by one spends one query per key and exhausts the per-invocation budget
 * (1000 queries on the paid plan, 50 on the free one) long before the array
 * is done, so the lookup is done in chunks of `IN (?, …)` instead.
 */
const MAX_BINDINGS_PER_QUERY = 100;
const MAX_KEYS_PER_QUERY = MAX_BINDINGS_PER_QUERY - 1;

/**
 * The largest number of bytes a search term may carry.
 *
 * D1 caps a `LIKE` pattern at 50 bytes and the pattern carries the two
 * wildcards, so a longer term would make the query fail with an error the
 * client cannot explain. The term is truncated instead of refused: it is a
 * convenience filter, not a contract.
 */
const MAX_SEARCH_BYTES = 48;

/** Truncates a search term to the bytes a D1 `LIKE` pattern can carry. */
const clampSearch = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= MAX_SEARCH_BYTES) return value;
  return new TextDecoder().decode(bytes.slice(0, MAX_SEARCH_BYTES));
};

/**
 * The live (not soft-deleted) file keys of `keys` that belong to `userId`.
 *
 * One chunked query per `MAX_KEYS_PER_QUERY` keys instead of one query per
 * key: a bulk download of a thousand covers costs eleven queries, not a
 * thousand.
 */
const findLiveFileKeys = async (env: Env, userId: string, keys: string[]): Promise<Set<string>> => {
  const live = new Set<string>();
  const owned = keys.filter((key) => key.startsWith(`${userId}/`));
  for (let i = 0; i < owned.length; i += MAX_KEYS_PER_QUERY) {
    const chunk = owned.slice(i, i + MAX_KEYS_PER_QUERY);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await env.SYNC_DB.prepare(
      `SELECT file_key FROM files
        WHERE user_id = ? AND deleted_at IS NULL AND file_key IN (${placeholders})`,
    )
      .bind(userId, ...chunk)
      .all<{ file_key: string }>();
    for (const row of results ?? []) live.add(String(row.file_key));
  }
  return live;
};

/**
 * Reject an object key that could escape the caller's prefix.
 *
 * `fileName` is fully client-controlled and is interpolated into
 * `<user_id>/<fileName>`; without this an attacker escapes their own prefix
 * into another user's namespace (GHSA-mfmj-2frf-vhgw).
 */
export const isSafeObjectKeyName = (name: unknown): name is string => {
  if (typeof name !== 'string' || !name) return false;
  if (name.length > 512) return false;
  if (name.includes('..')) return false;
  if (name.startsWith('/') || name.endsWith('/')) return false;
  return FILE_KEY_PATTERN.test(name);
};

/** `POST /api/storage/upload` — reserve a slot and answer the upload URL. */
export const handleStorageUpload = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const body = await readJson<{
    fileName?: string;
    fileSize?: number;
    bookHash?: string;
    replicaKind?: string;
    replicaId?: string;
    temp?: boolean;
    media?: string;
  }>(request);
  if (!body) return errorJson('Invalid JSON body', 400);

  const { fileName, fileSize, bookHash, replicaKind, replicaId } = body;
  if (!isSafeObjectKeyName(fileName)) {
    return errorJson('Invalid fileName', 400);
  }
  if (!Number.isSafeInteger(fileSize) || (fileSize as number) <= 0) {
    return errorJson('Invalid fileSize', 400);
  }
  const maxBytes = Number(env.MAX_UPLOAD_BYTES ?? 104857600);
  if ((fileSize as number) > maxBytes) {
    return errorJson('File too large', 413);
  }

  const fileKey = `${userId}/${fileName}`;
  // The lookup ignores `deleted_at`: `files.file_key` carries a UNIQUE index,
  // so a soft-deleted row still occupies the key and the upload has to revive
  // it instead of inserting a second row for the same key.
  const existing = await env.SYNC_DB.prepare(
    'SELECT id, file_size, deleted_at FROM files WHERE user_id = ? AND file_key = ?',
  )
    .bind(userId, fileKey)
    .first<{ id: string; file_size: number; deleted_at: string | null }>();

  // The operator's quota has to be ENFORCED here, not merely reported by
  // `/api/storage/stats`: otherwise `STORAGE_FIXED_QUOTA` is a number the app
  // shows to the user while the backend accepts an unbounded upload. 0 means
  // "no limit configured".
  const quota = Number(env.STORAGE_FIXED_QUOTA ?? 0) || 0;
  if (quota > 0) {
    const usageRow = await env.SYNC_DB.prepare(
      `SELECT COALESCE(SUM(file_size), 0) AS total_size
       FROM files WHERE user_id = ? AND deleted_at IS NULL`,
    )
      .bind(userId)
      .first<{ total_size: number }>();
    const usage = Number(usageRow?.total_size ?? 0);
    // Re-uploading the same key does not add to the usage: the existing row is
    // replaced, so only the difference counts. A soft-deleted row is not part
    // of the usage at all, so it counts as zero.
    const alreadyCounted = existing && !existing.deleted_at ? Number(existing.file_size) : 0;
    const projected = usage - alreadyCounted + (fileSize as number);
    if (projected > quota) {
      return errorJson('Insufficient storage quota', 507, { usage, quota });
    }
  }

  if (!existing) {
    await env.SYNC_DB.prepare(
      `INSERT INTO files (id, user_id, book_hash, replica_kind, replica_id, file_key, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        bookHash ?? null,
        replicaKind ?? null,
        replicaId ?? null,
        fileKey,
        fileSize,
      )
      .run();
  } else {
    // The reservation is re-stamped with the size the client is about to
    // write: the write path caps the body at this size, so a stale size would
    // refuse the upload (or, worse, let a smaller declared size be charged
    // while a bigger body is stored).
    await env.SYNC_DB.prepare(
      `UPDATE files SET file_size = ?, deleted_at = NULL, updated_at = ?,
         book_hash = COALESCE(?, book_hash),
         replica_kind = COALESCE(?, replica_kind),
         replica_id = COALESCE(?, replica_id)
       WHERE id = ?`,
    )
      .bind(
        fileSize,
        nowIso(),
        bookHash ?? null,
        replicaKind ?? null,
        replicaId ?? null,
        existing.id,
      )
      .run();
  }

  // Two tickets, two purposes. The write ticket belongs to the uploader that
  // made the reservation; the read ticket is the one the client hands to
  // third parties (Discord, an `<img>` tag), so it must not be able to
  // replace the object.
  const writeTicket = await mintTicket(env.JWT_SECRET, fileKey, undefined, 'write');
  const readTicket = await mintTicket(env.JWT_SECRET, fileKey, undefined, 'read');
  if (!writeTicket || !readTicket) {
    // Without a signing secret the Worker cannot mint a usable upload URL, so
    // it fails here rather than handing the client a URL that would 401.
    return errorJson('Server is not configured: JWT_SECRET is missing', 503);
  }
  const origin = new URL(request.url).origin;
  const objectUrl = (ticket: string) =>
    `${origin}/api/storage/object?key=${encodeURIComponent(fileKey)}&ticket=${encodeURIComponent(
      ticket,
    )}`;
  // The client reads `downloadUrl` for the `temp` and `media` uploads (book
  // covers): those need a URL they can hand to a third party — Discord Rich
  // Presence, an <img> tag — and that URL has to work without the bearer
  // token. The signed object URL is exactly that.
  return json({ uploadUrl: objectUrl(writeTicket), downloadUrl: objectUrl(readTicket), fileKey });
};

/**
 * The largest body the Worker buffers when the length is unknown.
 *
 * R2 only accepts a stream whose length it knows, so an upload that arrives
 * without a `Content-Length` has to be read into memory first. A Worker has a
 * 128 MB memory limit and buffering a 100 MB book in chunks needs about twice
 * that, so the buffered path is capped well below it: a client that streams
 * without a `Content-Length` must send less than this. Every real client
 * (browser `fetch` with a `File`, Tauri's HTTP client) sends the header.
 */
export const MAX_BUFFERED_BODY_BYTES = 32 * 1024 * 1024;

/**
 * Read a body of unknown length, refusing to buffer more than `limit` bytes.
 *
 * Returns `null` when the body is over the limit — the limit applies to the
 * bytes that are actually written, not to the size the client declared.
 */
const readCappedBody = async (body: ReadableStream, limit: number): Promise<Uint8Array | null> => {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/**
 * `PUT /api/storage/object?key=<key>` — store the uploaded bytes.
 *
 * The key must belong to the caller; the route is the target of the upload
 * URL the client received.
 */
export const handleStorageObjectPut = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') ?? '';
  const ticket = url.searchParams.get('ticket');
  // The ticket is the credential: the client PUTs the bytes without an
  // Authorization header, exactly as it does against a presigned R2 URL. It
  // is bound to this key AND to the write scope, so the download URL — which
  // the client hands to third parties — cannot write: that URL only opens
  // the object.
  const authorized = await verifyTicket(env.JWT_SECRET, key, ticket, undefined, 'write');
  if (!authorized) {
    return errorJson('Forbidden', 403);
  }
  const body = request.body;
  if (!body) return errorJson('Empty body', 400);

  // The size limit must hold on the bytes that are actually WRITTEN, not only
  // on the size the client declared when it reserved the slot: otherwise a
  // client reserves 1 byte and uploads the platform maximum.
  const maxUploadBytes = Number(env.MAX_UPLOAD_BYTES ?? 104857600);
  // The reservation has to be alive: a soft-deleted row is a file the user
  // threw away, and its ticket must not write anything. Without this check
  // the write fell back to the global maximum (the reservation was gone) and
  // the bytes landed in R2 outside the account's quota.
  const reserved = await env.SYNC_DB.prepare(
    'SELECT file_size FROM files WHERE file_key = ? AND deleted_at IS NULL',
  )
    .bind(key)
    .first<{ file_size: number }>();
  if (!reserved) {
    return errorJson('No active reservation for this object', 403);
  }
  const reservedBytes = Number(reserved.file_size);
  // A reserved slot is the size the quota was charged for, so the body may
  // never exceed it — otherwise a 1-byte reservation would let a 100 MB body
  // through and the quota would be a lie.
  const maxBytes = Math.min(maxUploadBytes, reservedBytes);

  const declaredHeader = request.headers.get('content-length');
  const declared = declaredHeader === null ? null : Number(declaredHeader);
  const hasKnownLength = declared !== null && Number.isFinite(declared) && declared >= 0;
  if (hasKnownLength && (declared as number) > maxBytes) {
    return errorJson('File too large', 413);
  }

  const httpMetadata = {
    contentType: request.headers.get('content-type') ?? 'application/octet-stream',
  };

  let written: number;
  if (hasKnownLength) {
    // The runtime hands over a body of exactly `Content-Length` bytes, so
    // the limit holds on the bytes that are really written and the upload
    // streams straight into R2 without being buffered in memory.
    await env.LIBRARY_BUCKET.put(key, body, { httpMetadata });
    written = declared as number;
  } else {
    // Chunked upload: R2 needs a known length, so the body is read with a
    // cap and handed over as a buffer.
    const bytes = await readCappedBody(body, Math.min(maxBytes, MAX_BUFFERED_BODY_BYTES));
    if (!bytes) {
      return errorJson('File too large', 413);
    }
    await env.LIBRARY_BUCKET.put(key, bytes, { httpMetadata });
    written = bytes.length;
  }

  if (written > 0 && written !== reservedBytes) {
    // The quota is charged on the bytes actually stored, so a body smaller
    // than the reservation stops counting against the limit.
    await env.SYNC_DB.prepare(
      'UPDATE files SET file_size = ?, updated_at = ? WHERE file_key = ? AND deleted_at IS NULL',
    )
      .bind(written, nowIso(), key)
      .run();
  } else {
    await env.SYNC_DB.prepare(
      'UPDATE files SET updated_at = ? WHERE file_key = ? AND deleted_at IS NULL',
    )
      .bind(nowIso(), key)
      .run();
  }

  return json({ ok: true });
};

/** `GET /api/storage/object?key=<key>` — stream the stored bytes back. */
export const handleStorageObjectGet = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') ?? '';
  const ticket = url.searchParams.get('ticket');
  // The read scope is the one the download URL carries: it opens the object
  // and nothing else.
  const authorized = await verifyTicket(env.JWT_SECRET, key, ticket, undefined, 'read');
  if (!authorized) {
    return errorJson('Forbidden', 403);
  }
  const object = await env.LIBRARY_BUCKET.get(key);
  if (!object) return errorJson('File not found', 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (object.size != null) headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(object.body, { headers });
};

/** `GET|POST /api/storage/download` — answer the download URL(s) for key(s). */
export const handleStorageDownload = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const origin = new URL(request.url).origin;
  const buildUrl = async (key: string): Promise<string | undefined> => {
    // A download URL is a read URL: it travels to third parties, so it must
    // not carry the write scope.
    const ticket = await mintTicket(env.JWT_SECRET, key, undefined, 'read');
    if (!ticket) return undefined;
    return `${origin}/api/storage/object?key=${encodeURIComponent(
      key,
    )}&ticket=${encodeURIComponent(ticket)}`;
  };

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const fileKey = url.searchParams.get('fileKey') ?? '';
    if (!fileKey) return errorJson('Missing or invalid fileKey', 400);
    if (!fileKey.startsWith(`${userId}/`)) return errorJson('Forbidden', 403);
    const exists = await env.SYNC_DB.prepare(
      'SELECT id FROM files WHERE user_id = ? AND file_key = ? AND deleted_at IS NULL',
    )
      .bind(userId, fileKey)
      .first();
    if (!exists) return errorJson('File not found', 404);
    const downloadUrl = await buildUrl(fileKey);
    if (!downloadUrl) {
      return errorJson('Server is not configured: JWT_SECRET is missing', 503);
    }
    return json({ downloadUrl });
  }

  const body = await readJson<{ fileKeys?: unknown }>(request);
  const fileKeys = body?.fileKeys;
  if (!Array.isArray(fileKeys) || fileKeys.length === 0) {
    return errorJson('Missing or invalid fileKeys array', 400);
  }
  if (fileKeys.length > MAX_DOWNLOAD_FILES) {
    return errorJson(`Cannot request more than ${MAX_DOWNLOAD_FILES} files at once`, 400);
  }
  if (!fileKeys.every((key) => typeof key === 'string')) {
    return errorJson('All fileKeys must be strings', 400);
  }
  // One chunked lookup for the whole batch: a query per key would spend the
  // runtime's per-invocation query budget on a single request.
  const live = await findLiveFileKeys(env, userId, fileKeys as string[]);
  const downloadUrls: Record<string, string | undefined> = {};
  for (const key of fileKeys as string[]) {
    downloadUrls[key] = live.has(key) ? await buildUrl(key) : undefined;
  }
  return json({ downloadUrls });
};

/** `GET /api/storage/list` — the account's stored files, paginated. */
export const handleStorageList = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(1000, Math.max(1, Number(url.searchParams.get('pageSize')) || 50));
  const bookHash = url.searchParams.get('bookHash');
  const rawSearch = url.searchParams.get('search');
  const search = rawSearch ? clampSearch(rawSearch) : null;
  const sortBy = url.searchParams.get('sortBy') ?? 'created_at';
  const sortOrder = url.searchParams.get('sortOrder') === 'asc' ? 'ASC' : 'DESC';
  const sortColumn = ['created_at', 'updated_at', 'file_size', 'file_key'].includes(sortBy)
    ? sortBy
    : 'created_at';

  const clauses = ['user_id = ?', 'deleted_at IS NULL'];
  const args: unknown[] = [userId];
  if (bookHash) {
    clauses.push('book_hash = ?');
    args.push(bookHash);
  }
  if (search) {
    clauses.push('file_key LIKE ?');
    args.push(`%${search}%`);
  }
  const where = clauses.join(' AND ');

  const totalRow = await env.SYNC_DB.prepare(`SELECT COUNT(*) AS count FROM files WHERE ${where}`)
    .bind(...args)
    .first<{ count: number }>();
  const total = Number(totalRow?.count ?? 0);

  const offset = (page - 1) * pageSize;
  const { results } = await env.SYNC_DB.prepare(
    `SELECT file_key, file_size, book_hash, replica_kind, replica_id, created_at, updated_at
     FROM files WHERE ${where}
     ORDER BY ${sortColumn} ${sortOrder} LIMIT ? OFFSET ?`,
  )
    .bind(...args, pageSize, offset)
    .all<{
      file_key: string;
      file_size: number;
      book_hash: string | null;
      replica_kind: string | null;
      replica_id: string | null;
      created_at: string;
      updated_at: string | null;
    }>();

  return json({
    files: results ?? [],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
};

/** `GET /api/storage/stats` — the account's storage usage, grouped by book. */
export const handleStorageStats = async (env: Env, userId: string): Promise<Response> => {
  const row = await env.SYNC_DB.prepare(
    `SELECT COUNT(*) AS total_files, COALESCE(SUM(file_size), 0) AS total_size
     FROM files WHERE user_id = ? AND deleted_at IS NULL`,
  )
    .bind(userId)
    .first<{ total_files: number; total_size: number }>();

  const totalFiles = Number(row?.total_files ?? 0);
  const totalSize = Number(row?.total_size ?? 0);

  // A self-hosted deployment has no store to buy from, so the quota is the
  // operator's own limit: the fixed quota when it is configured, and
  // effectively unlimited otherwise.
  const quota = Number(env.STORAGE_FIXED_QUOTA ?? 0) || 0;
  const usagePercentage = quota > 0 ? Math.round((totalSize / quota) * 100) : 0;

  const { results } = await env.SYNC_DB.prepare(
    `SELECT book_hash, COUNT(*) AS file_count, COALESCE(SUM(file_size), 0) AS total_size
     FROM files WHERE user_id = ? AND deleted_at IS NULL
     GROUP BY book_hash ORDER BY total_size DESC`,
  )
    .bind(userId)
    .all<{ book_hash: string | null; file_count: number; total_size: number }>();

  return json({
    totalFiles,
    totalSize,
    usage: totalSize,
    quota,
    usagePercentage,
    byBookHash: (results ?? []).map((row) => ({
      bookHash: row.book_hash,
      fileCount: Number(row.file_count ?? 0),
      totalSize: Number(row.total_size ?? 0),
    })),
  });
};

/**
 * `DELETE /api/storage/delete` — soft-delete the account's stored files.
 *
 * The key travels in the QUERY STRING: that is what the client sends
 * (`DELETE /api/storage/delete?fileKey=…`) and what the hosted backend reads
 * (`const { fileKey } = req.query`). The JSON body is accepted as well, so a
 * caller that prefers it is not turned away.
 */
export const handleStorageDelete = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const body = await readJson<{ fileKey?: string; fileKeys?: unknown }>(request);
  const queryKey = url.searchParams.get('fileKey');
  const keys = Array.isArray(body?.fileKeys)
    ? (body.fileKeys as string[])
    : typeof body?.fileKey === 'string'
      ? [body.fileKey]
      : typeof queryKey === 'string' && queryKey
        ? [queryKey]
        : [];
  if (keys.length === 0) return errorJson('Missing or invalid fileKey', 400);
  if (keys.length > MAX_DELETE_FILES) {
    return errorJson(`Cannot delete more than ${MAX_DELETE_FILES} files at once`, 400);
  }

  const deleted: string[] = [];
  for (const key of keys) {
    if (!key.startsWith(`${userId}/`)) continue;
    await env.SYNC_DB.prepare(
      'UPDATE files SET deleted_at = ? WHERE user_id = ? AND file_key = ? AND deleted_at IS NULL',
    )
      .bind(nowIso(), userId, key)
      .run();
    await env.LIBRARY_BUCKET.delete(key);
    deleted.push(key);
  }
  return json({ deleted: deleted.length, fileKeys: deleted });
};

/**
 * `DELETE /api/storage/purge` — bulk-delete the account's stored files.
 *
 * The client sends `{ fileKeys }` and reads the breakdown out of the answer,
 * so the response always carries `{ success, failed, deletedCount,
 * failedCount }` with a 200 — including when every deletion failed, because
 * the breakdown IS the answer. (The hosted backend answers 207/500 for a
 * partial or total failure, which makes the client throw away the breakdown
 * it came for.)
 *
 * A key that does not belong to the caller, or that no longer exists, is
 * reported in `failed` rather than silently dropped: the caller asked for a
 * specific set of keys and deserves to know which of them are gone.
 */
export const handleStoragePurge = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const body = await readJson<{ fileKeys?: unknown }>(request);
  const fileKeys = body?.fileKeys;
  if (!Array.isArray(fileKeys) || fileKeys.length === 0) {
    return errorJson('Missing or invalid fileKeys array', 400);
  }
  if (fileKeys.length > MAX_PURGE_FILES) {
    return errorJson(`Cannot delete more than ${MAX_PURGE_FILES} files at once`, 400);
  }
  if (!fileKeys.every((key) => typeof key === 'string')) {
    return errorJson('All fileKeys must be strings', 400);
  }

  const success: string[] = [];
  const failed: Array<{ fileKey: string; error: string }> = [];

  for (const key of fileKeys as string[]) {
    if (!key.startsWith(`${userId}/`)) {
      failed.push({ fileKey: key, error: 'Unauthorized access to one or more files' });
      continue;
    }
    const record = await env.SYNC_DB.prepare(
      'SELECT id FROM files WHERE user_id = ? AND file_key = ? AND deleted_at IS NULL',
    )
      .bind(userId, key)
      .first<{ id: string }>();
    if (!record) {
      failed.push({ fileKey: key, error: 'File not found or already deleted' });
      continue;
    }
    try {
      await env.LIBRARY_BUCKET.delete(key);
      await env.SYNC_DB.prepare(
        'UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      )
        .bind(nowIso(), nowIso(), record.id)
        .run();
      success.push(key);
    } catch (error) {
      failed.push({
        fileKey: key,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return json({
    success,
    failed,
    deletedCount: success.length,
    failedCount: failed.length,
  });
};
