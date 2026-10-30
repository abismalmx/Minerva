/**
 * The push half of the native sync API: `POST /api/sync`.
 *
 * The client posts `{ books, configs, notes, statBooks, statPages }` and the
 * Worker resolves each row against the stored one with the field-level
 * last-writer-wins rules in `merge.ts`, then writes it back. The response
 * echoes the authoritative rows, exactly like the Postgres backend does, so
 * the client can merge the server's resolved values straight in.
 */

import { errorJson, json, nowIso, readJson, type Env } from './http';
import {
  bookConfigRowToWire,
  bookNoteRowToWire,
  bookRowToWire,
  parseTags,
  serializeInk,
  serializeProgress,
  serializeTags,
  type BookConfigRow,
  type BookNoteRow,
  type BookRow,
} from './rows';
import { BOOK_COLUMNS, CONFIG_COLUMNS, NOTE_COLUMNS } from './pull';
import {
  bookGroupChanged,
  bookMetadataChanged,
  readingStatusChanged,
  resolveCoverMerge,
  resolveGroupMerge,
  resolveMetadataMerge,
  resolvePageCountMerge,
  resolveReadingStatusMerge,
} from './merge';
import type { D1Database, D1PreparedStatement } from './types';

export interface PushRecord {
  book_hash?: string;
  id?: string;
  meta_hash?: string;
  [key: string]: unknown;
}

export interface PushBody {
  books?: PushRecord[];
  configs?: PushRecord[];
  notes?: PushRecord[];
  statBooks?: PushRecord[];
  statPages?: PushRecord[];
}

export const asArray = (value: unknown): PushRecord[] =>
  Array.isArray(value) ? (value as PushRecord[]) : [];

export const isoOr = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
};

export const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Read rows with a bound parameter list. */
const readRows = async (
  db: D1Database,
  sql: string,
  args: unknown[],
): Promise<Record<string, unknown>[]> => {
  const { results } = await db
    .prepare(sql)
    .bind(...args)
    .all<Record<string, unknown>>();
  return results ?? [];
};

/** Resolve one books row against the stored row and return the row to write. */
export const mergeBook = (client: PushRecord, server: BookRow | null, stamp: string): BookRow => {
  const clientUpdatedAt = client['updated_at']
    ? new Date(String(client['updated_at'])).getTime()
    : 0;
  const serverUpdatedAt = server?.updated_at ? new Date(server.updated_at).getTime() : 0;
  const clientDeletedAt = client['deleted_at']
    ? new Date(String(client['deleted_at'])).getTime()
    : 0;
  const serverDeletedAt = server?.deleted_at ? new Date(server.deleted_at).getTime() : 0;
  const clientIsNewer = clientDeletedAt > serverDeletedAt || clientUpdatedAt > serverUpdatedAt;

  const base: BookRow = {
    user_id: '',
    book_hash: String(client['book_hash'] ?? ''),
    meta_hash: str(client['meta_hash']),
    format: str(client['format']) ?? 'EPUB',
    title: str(client['title']) ?? '',
    source_title: str(client['source_title']),
    author: str(client['author']) ?? '',
    group_id: str(client['group_id']),
    group_name: str(client['group_name']),
    group_updated_at: str(client['group_updated_at']),
    tags: serializeTags(client['tags']),
    progress: serializeProgress(client['progress']),
    reading_status: str(client['reading_status']),
    reading_status_updated_at: str(client['reading_status_updated_at']),
    cover_hash: str(client['cover_hash']),
    cover_updated_at: str(client['cover_updated_at']),
    page_count: num(client['page_count']),
    metadata: str(client['metadata']),
    metadata_updated_at: str(client['metadata_updated_at']),
    created_at: isoOr(client['created_at'], stamp),
    updated_at: isoOr(client['updated_at'], stamp),
    deleted_at: str(client['deleted_at']),
    uploaded_at: str(client['uploaded_at']),
    synced_at: stamp,
  };

  if (!server) return base;

  // The server row wins the whole row, but each field group below carries its
  // OWN clock: a page turn must not clobber a cover edit, a metadata edit or
  // a group move.
  const status = resolveReadingStatusMerge(base, server);
  const cover = resolveCoverMerge(base, server);
  const metadata = resolveMetadataMerge(
    {
      title: base.title,
      author: base.author,
      tags: parseTags(base.tags),
      metadata: base.metadata,
      metadata_updated_at: base.metadata_updated_at,
    },
    {
      title: server.title,
      author: server.author,
      tags: parseTags(server.tags),
      metadata: server.metadata,
      metadata_updated_at: server.metadata_updated_at,
    },
    clientIsNewer,
  );
  const group = resolveGroupMerge(base, server, clientIsNewer);
  const pageCount = resolvePageCountMerge(base, server, clientIsNewer);

  if (clientIsNewer) {
    // The client wins the row; graft the fresher field groups onto it.
    return {
      ...base,
      reading_status: status.reading_status,
      reading_status_updated_at: status.reading_status_updated_at,
      cover_hash: cover.cover_hash,
      cover_updated_at: cover.cover_updated_at,
      title: metadata.title,
      author: metadata.author,
      tags: metadata.tags === null ? null : serializeTags(metadata.tags),
      metadata: metadata.metadata,
      metadata_updated_at: metadata.metadata_updated_at,
      group_id: group.group_id,
      group_name: group.group_name,
      group_updated_at: group.group_updated_at,
      page_count: pageCount,
    };
  }

  // The server wins the row. Rewrite only when a resolved field VALUE
  // differs — a timestamp-only difference on the same value is a no-op, and
  // rewriting it would churn updated_at and re-propagate needlessly.
  const statusChanged = readingStatusChanged(status.reading_status, server.reading_status);
  const coverChanged = (cover.cover_hash ?? null) !== (server.cover_hash ?? null);
  const metadataChanged = bookMetadataChanged(
    {
      title: metadata.title,
      author: metadata.author,
      tags: metadata.tags,
      metadata: metadata.metadata,
    },
    {
      title: server.title,
      author: server.author,
      tags: parseTags(server.tags),
      metadata: server.metadata,
    },
  );
  const groupChanged = bookGroupChanged(group, server);
  const pageCountChanged = pageCount !== (server.page_count ?? null);

  if (!statusChanged && !coverChanged && !metadataChanged && !groupChanged && !pageCountChanged) {
    return server;
  }

  // Graft the fresher fields onto the server row and leave updated_at
  // untouched; `synced_at` advances so peers re-pull via the synced_at cursor
  // without reordering the date-read library (#4678, #4544, #5438).
  return {
    ...server,
    reading_status: status.reading_status,
    reading_status_updated_at: status.reading_status_updated_at,
    cover_hash: cover.cover_hash,
    cover_updated_at: cover.cover_updated_at,
    title: metadata.title,
    author: metadata.author,
    tags: metadata.tags === null ? null : serializeTags(metadata.tags),
    metadata: metadata.metadata,
    metadata_updated_at: metadata.metadata_updated_at,
    group_id: group.group_id,
    group_name: group.group_name,
    group_updated_at: group.group_updated_at,
    page_count: pageCount,
    synced_at: stamp,
  };
};

/** Resolve a book_configs row against the stored row. */
export const mergeConfig = (
  client: PushRecord,
  server: BookConfigRow | null,
  stamp: string,
): BookConfigRow => {
  const base: BookConfigRow = {
    user_id: '',
    book_hash: String(client['book_hash'] ?? ''),
    meta_hash: str(client['meta_hash']),
    location: str(client['location']),
    xpointer: str(client['xpointer']),
    progress: str(client['progress']),
    rsvp_position: str(client['rsvp_position']),
    search_config: str(client['search_config']),
    view_settings: str(client['view_settings']),
    created_at: isoOr(client['created_at'], stamp),
    updated_at: isoOr(client['updated_at'], stamp),
    deleted_at: str(client['deleted_at']),
  };
  if (!server) return base;
  const clientMs = new Date(base.updated_at).getTime();
  const serverMs = new Date(server.updated_at).getTime();
  const clientDeletedAt = base.deleted_at ? new Date(base.deleted_at).getTime() : 0;
  const serverDeletedAt = server.deleted_at ? new Date(server.deleted_at).getTime() : 0;
  // The client wins when it is newer, or when it deletes and the server has
  // not.
  if (clientMs > serverMs || clientDeletedAt > serverDeletedAt) return base;
  return server;
};

/** Resolve a book_notes row against the stored row. */
export const mergeNote = (
  client: PushRecord,
  server: BookNoteRow | null,
  stamp: string,
): BookNoteRow => {
  const base: BookNoteRow = {
    user_id: '',
    book_hash: String(client['book_hash'] ?? ''),
    meta_hash: str(client['meta_hash']),
    id: String(client['id'] ?? ''),
    type: str(client['type']),
    cfi: str(client['cfi']),
    xpointer0: str(client['xpointer0']),
    xpointer1: str(client['xpointer1']),
    page: num(client['page']),
    text: str(client['text']),
    style: str(client['style']),
    color: str(client['color']),
    note: str(client['note']),
    global_flag: typeof client['global'] === 'boolean' ? (client['global'] ? 1 : 0) : null,
    ink: serializeInk(client['ink']),
    created_at: isoOr(client['created_at'], stamp),
    updated_at: isoOr(client['updated_at'], stamp),
    deleted_at: str(client['deleted_at']),
  };
  if (!server) return base;
  const clientMs = new Date(base.updated_at).getTime();
  const serverMs = new Date(server.updated_at).getTime();
  const clientDeletedAt = base.deleted_at ? new Date(base.deleted_at).getTime() : 0;
  const serverDeletedAt = server.deleted_at ? new Date(server.deleted_at).getTime() : 0;
  if (clientMs > serverMs || clientDeletedAt > serverDeletedAt) return base;
  return server;
};

/** D1 accepts at most 100 bound parameters in a single query. */
const MAX_BINDINGS_PER_QUERY = 100;

/** How many hashes one resolution query may carry (one slot is the user id). */
const MAX_HASHES_PER_QUERY = MAX_BINDINGS_PER_QUERY - 1;

/**
 * Resolve a set of hashes with as many queries as needed.
 *
 * The resolution used to be a single `book_hash IN (?,?,…)` query with one
 * placeholder per hash, so a library with more than 99 books could not be
 * resolved at all: D1 refused the query ("too many SQL variables") and the
 * whole push answered 500. The hashes are resolved in chunks instead.
 */
const resolveHashes = async <T>(
  db: D1Database,
  sql: (placeholders: string) => string,
  userId: string,
  hashes: string[],
): Promise<T[]> => {
  const rows: T[] = [];
  for (let i = 0; i < hashes.length; i += MAX_HASHES_PER_QUERY) {
    const chunk = hashes.slice(i, i + MAX_HASHES_PER_QUERY);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db
      .prepare(sql(placeholders))
      .bind(userId, ...chunk)
      .all<T>();
    rows.push(...(results ?? []));
  }
  return rows;
};

/**
 * Handle `POST /api/sync`.
 *
 * Rows are written with `db.batch()`, which runs the statements in order and
 * rolls the whole batch back on failure — so a push never leaves the library
 * half-updated.
 */
export const handleSyncPost = async (
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> => {
  const body = await readJson<PushBody>(request);
  if (!body) return errorJson('Invalid JSON body', 400);

  const books = asArray(body.books);
  const configs = asArray(body.configs);
  const notes = asArray(body.notes);
  const statBooks = asArray(body.statBooks);
  const statPages = asArray(body.statPages);

  const db = env.SYNC_DB;
  const stamp = nowIso();

  try {
    if (books.length > 0) {
      const hashes = books.map((b) => String(b['book_hash'] ?? '')).filter(Boolean);
      const existing = await resolveHashes<Record<string, unknown>>(
        db,
        (placeholders) =>
          `SELECT ${BOOK_COLUMNS} FROM books WHERE user_id = ? AND book_hash IN (${placeholders})`,
        userId,
        hashes,
      );
      const serverByHash = new Map(
        (existing ?? []).map((row) => [String(row['book_hash']), row as unknown as BookRow]),
      );

      const statements: D1PreparedStatement[] = [];
      for (const client of books) {
        const hash = String(client['book_hash'] ?? '');
        if (!hash) continue;
        const merged = mergeBook(client, serverByHash.get(hash) ?? null, stamp);
        merged.user_id = userId;
        statements.push(
          db
            .prepare(
              `INSERT INTO books (user_id, book_hash, meta_hash, format, title, source_title,
                 author, group_id, group_name, group_updated_at, tags, progress,
                 reading_status, reading_status_updated_at, cover_hash, cover_updated_at,
                 page_count, metadata, metadata_updated_at, created_at, updated_at,
                 deleted_at, uploaded_at, synced_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id, book_hash) DO UPDATE SET
                 meta_hash = excluded.meta_hash, format = excluded.format,
                 title = excluded.title, source_title = excluded.source_title,
                 author = excluded.author, group_id = excluded.group_id,
                 group_name = excluded.group_name, group_updated_at = excluded.group_updated_at,
                 tags = excluded.tags, progress = excluded.progress,
                 reading_status = excluded.reading_status,
                 reading_status_updated_at = excluded.reading_status_updated_at,
                 cover_hash = excluded.cover_hash, cover_updated_at = excluded.cover_updated_at,
                 page_count = excluded.page_count, metadata = excluded.metadata,
                 metadata_updated_at = excluded.metadata_updated_at,
                 created_at = excluded.created_at, updated_at = excluded.updated_at,
                 deleted_at = excluded.deleted_at, uploaded_at = excluded.uploaded_at,
                 synced_at = excluded.synced_at`,
            )
            .bind(
              merged.user_id,
              merged.book_hash,
              merged.meta_hash,
              merged.format,
              merged.title,
              merged.source_title,
              merged.author,
              merged.group_id,
              merged.group_name,
              merged.group_updated_at,
              merged.tags,
              merged.progress,
              merged.reading_status,
              merged.reading_status_updated_at,
              merged.cover_hash,
              merged.cover_updated_at,
              merged.page_count,
              merged.metadata,
              merged.metadata_updated_at,
              merged.created_at,
              merged.updated_at,
              merged.deleted_at,
              merged.uploaded_at,
              merged.synced_at,
            ),
        );
      }
      if (statements.length > 0) await db.batch(statements);
    }

    if (configs.length > 0) {
      const hashes = configs.map((c) => String(c['book_hash'] ?? '')).filter(Boolean);
      const existing = await resolveHashes<Record<string, unknown>>(
        db,
        (placeholders) =>
          `SELECT ${CONFIG_COLUMNS} FROM book_configs
           WHERE user_id = ? AND book_hash IN (${placeholders})`,
        userId,
        hashes,
      );
      const serverByHash = new Map(
        (existing ?? []).map((row) => [String(row['book_hash']), row as unknown as BookConfigRow]),
      );

      const statements: D1PreparedStatement[] = [];
      for (const client of configs) {
        const hash = String(client['book_hash'] ?? '');
        if (!hash) continue;
        const merged = mergeConfig(client, serverByHash.get(hash) ?? null, stamp);
        merged.user_id = userId;
        statements.push(
          db
            .prepare(
              `INSERT INTO book_configs (user_id, book_hash, meta_hash, location, xpointer,
                 progress, rsvp_position, search_config, view_settings, created_at,
                 updated_at, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id, book_hash) DO UPDATE SET
                 meta_hash = excluded.meta_hash, location = excluded.location,
                 xpointer = excluded.xpointer, progress = excluded.progress,
                 rsvp_position = excluded.rsvp_position,
                 search_config = excluded.search_config,
                 view_settings = excluded.view_settings,
                 created_at = excluded.created_at, updated_at = excluded.updated_at,
                 deleted_at = excluded.deleted_at`,
            )
            .bind(
              merged.user_id,
              merged.book_hash,
              merged.meta_hash,
              merged.location,
              merged.xpointer,
              merged.progress,
              merged.rsvp_position,
              merged.search_config,
              merged.view_settings,
              merged.created_at,
              merged.updated_at,
              merged.deleted_at,
            ),
        );
      }
      if (statements.length > 0) await db.batch(statements);

      // Piggyback the per-book reading progress from the configs push onto
      // the matching `books` row, so a peer reading the library sees the
      // position without waiting for the next books push. The `.lt` predicate
      // keeps last-writer-wins: a concurrent newer books push is never
      // downgraded.
      for (const client of configs) {
        const hash = String(client['book_hash'] ?? '');
        const progress = str(client['progress']);
        const updatedAt = str(client['updated_at']);
        if (!hash || !progress || !updatedAt) continue;
        await db
          .prepare(
            `UPDATE books SET progress = ?, updated_at = ?, synced_at = ?
             WHERE user_id = ? AND book_hash = ? AND updated_at < ?`,
          )
          .bind(progress, updatedAt, stamp, userId, hash, updatedAt)
          .run();
      }
    }

    if (notes.length > 0) {
      const statements: D1PreparedStatement[] = [];
      for (const client of notes) {
        const hash = String(client['book_hash'] ?? '');
        const id = String(client['id'] ?? '');
        if (!hash || !id) continue;
        const { results: existing } = await db
          .prepare(
            `SELECT ${NOTE_COLUMNS} FROM book_notes
             WHERE user_id = ? AND book_hash = ? AND id = ?`,
          )
          .bind(userId, hash, id)
          .all<Record<string, unknown>>();
        const server = (existing?.[0] as unknown as BookNoteRow) ?? null;
        const merged = mergeNote(client, server, stamp);
        merged.user_id = userId;
        statements.push(
          db
            .prepare(
              `INSERT INTO book_notes (user_id, book_hash, meta_hash, id, type, cfi,
                 xpointer0, xpointer1, page, text, style, color, note, global_flag, ink,
                 created_at, updated_at, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id, book_hash, id) DO UPDATE SET
                 meta_hash = excluded.meta_hash, type = excluded.type, cfi = excluded.cfi,
                 xpointer0 = excluded.xpointer0, xpointer1 = excluded.xpointer1,
                 page = excluded.page, text = excluded.text, style = excluded.style,
                 color = excluded.color, note = excluded.note,
                 global_flag = excluded.global_flag, ink = excluded.ink,
                 created_at = excluded.created_at, updated_at = excluded.updated_at,
                 deleted_at = excluded.deleted_at`,
            )
            .bind(
              merged.user_id,
              merged.book_hash,
              merged.meta_hash,
              merged.id,
              merged.type,
              merged.cfi,
              merged.xpointer0,
              merged.xpointer1,
              merged.page,
              merged.text,
              merged.style,
              merged.color,
              merged.note,
              merged.global_flag,
              merged.ink,
              merged.created_at,
              merged.updated_at,
              merged.deleted_at,
            ),
        );
      }
      if (statements.length > 0) await db.batch(statements);
    }

    if (statBooks.length > 0) {
      const statements: D1PreparedStatement[] = [];
      for (const row of statBooks) {
        const hash = String(row['book_hash'] ?? '');
        if (!hash) continue;
        statements.push(
          db
            .prepare(
              `INSERT INTO stat_books (user_id, book_hash, title, authors, updated_at, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id, book_hash) DO UPDATE SET
                 title = excluded.title, authors = excluded.authors,
                 updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
            )
            .bind(
              userId,
              hash,
              str(row['title']) ?? '',
              str(row['authors']) ?? '',
              stamp,
              str(row['deleted_at']),
            ),
        );
      }
      if (statements.length > 0) await db.batch(statements);
    }

    if (statPages.length > 0) {
      // The "longer-duration-wins" merge runs inside the Postgres backend's
      // upsert_stat_pages RPC (migration 019). Here it is expressed inline:
      // a new key inserts, an existing key updates only when the incoming
      // duration is strictly longer.
      const statements: D1PreparedStatement[] = [];
      for (const row of statPages) {
        const hash = String(row['book_hash'] ?? '');
        const page = num(row['page']);
        if (!hash || page == null) continue;
        const duration = num(row['duration']) ?? 0;
        statements.push(
          db
            .prepare(
              `INSERT INTO stat_pages (user_id, book_hash, page, start_time, duration,
                 total_pages, ext, updated_at, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id, book_hash, page) DO UPDATE SET
                 start_time = excluded.start_time, duration = excluded.duration,
                 total_pages = excluded.total_pages, ext = excluded.ext,
                 updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
               WHERE excluded.duration > stat_pages.duration`,
            )
            .bind(
              userId,
              hash,
              page,
              num(row['start_time']) ?? 0,
              duration,
              num(row['total_pages']) ?? 0,
              str(row['ext']),
              stamp,
              str(row['deleted_at']),
            ),
        );
      }
      if (statements.length > 0) await db.batch(statements);
    }

    // Echo the authoritative rows back, exactly like the Postgres backend: the
    // client merges the server's resolved values straight in.
    const [booksOut, configsOut, notesOut] = await Promise.all([
      readRows(db, `SELECT ${BOOK_COLUMNS} FROM books WHERE user_id = ?`, [userId]),
      readRows(db, `SELECT ${CONFIG_COLUMNS} FROM book_configs WHERE user_id = ?`, [userId]),
      readRows(db, `SELECT ${NOTE_COLUMNS} FROM book_notes WHERE user_id = ?`, [userId]),
    ]);

    return json({
      books: booksOut.map((row) => bookRowToWire(row as unknown as BookRow)),
      configs: configsOut.map((row) => bookConfigRowToWire(row as unknown as BookConfigRow)),
      notes: notesOut.map((row) => bookNoteRowToWire(row as unknown as BookNoteRow)),
    });
  } catch (error) {
    // The client gets a generic message; the details stay in the log.
    console.error('sync push failed', error);
    return errorJson('Push failed', 500);
  }
};
