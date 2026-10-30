/**
 * The pull half of the native sync API: `GET /api/sync`.
 *
 * The contract is the one the app already speaks (apps/minerva-app/src/pages/
 * api/sync.ts), so no client change is needed to use this backend:
 *
 * `GET /api/sync?since=<ms>&type=<books|configs|notes|stats>&book=<hash>
 *  &meta_hash=<hash>&limit=<n>`
 *
 * Books key on the server-assigned `synced_at` cursor; configs and notes on
 * `updated_at`. Rows are always filtered by `user_id`, so one account can
 * never read another's data.
 */

import { errorJson, json, type Env } from './http';
import {
  bookConfigRowToWire,
  bookNoteRowToWire,
  bookRowToWire,
  type BookConfigRow,
  type BookNoteRow,
  type BookRow,
} from './rows';

export interface AuthedRequest {
  request: Request;
  env: Env;
  userId: string;
}

const PAGE_SIZE = 1000;

/**
 * The largest number of rows one pull may answer.
 *
 * The client's `limit` parameter may lower the ceiling but never raise it:
 * without a ceiling, one request can ask for the whole library and the
 * Worker has to build a response it cannot hold in memory.
 */
const MAX_PULL_ROWS = PAGE_SIZE * 50;

/** Columns selected for a books row — explicit so the wire shape is stable. */
export const BOOK_COLUMNS = `user_id, book_hash, meta_hash, format, title, source_title, author,
  group_id, group_name, group_updated_at, tags, progress, reading_status,
  reading_status_updated_at, cover_hash, cover_updated_at, page_count, metadata,
  metadata_updated_at, created_at, updated_at, deleted_at, uploaded_at, synced_at`;

export const CONFIG_COLUMNS = `user_id, book_hash, meta_hash, location, xpointer, progress,
  rsvp_position, search_config, view_settings, created_at, updated_at, deleted_at`;

export const NOTE_COLUMNS = `user_id, book_hash, meta_hash, id, type, cfi, xpointer0, xpointer1,
  page, text, style, color, note, global_flag, ink, created_at, updated_at, deleted_at`;

/** The `WHERE` fragment selecting one book (by hash) and/or its meta hash. */
const bookFilter = (book: string | null, metaHash: string | null): string => {
  if (book && metaHash) return ' AND (book_hash = ? OR meta_hash = ?)';
  if (book) return ' AND book_hash = ?';
  if (metaHash) return ' AND meta_hash = ?';
  return '';
};

const bookFilterArgs = (book: string | null, metaHash: string | null): unknown[] => {
  if (book && metaHash) return [book, metaHash];
  if (book) return [book];
  if (metaHash) return [metaHash];
  return [];
};

/**
 * Pull the delta since `since` (epoch ms).
 *
 * The response mirrors the Postgres backend's shape: `{ books, configs, notes,
 * statBooks, statPages }`, each an array (never null) so the client can merge
 * unconditionally.
 */
export const handleSyncGet = async ({ request, env, userId }: AuthedRequest): Promise<Response> => {
  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('since');
  if (!sinceParam) {
    return errorJson('"since" query parameter is required', 400);
  }
  const sinceMs = Number(sinceParam);
  if (!Number.isFinite(sinceMs)) {
    return errorJson('Invalid "since" timestamp', 400);
  }
  const sinceIso = new Date(sinceMs).toISOString();

  const type = url.searchParams.get('type');
  const book = url.searchParams.get('book');
  const metaHash = url.searchParams.get('meta_hash');
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.floor(Number(limitParam))) : 0;
  const cap = limit > 0 ? Math.min(limit, MAX_PULL_ROWS) : MAX_PULL_ROWS;

  const db = env.SYNC_DB;
  const results: Record<string, unknown> = {
    books: [],
    configs: [],
    notes: [],
    statBooks: [],
    statPages: [],
  };

  try {
    if (!type || type === 'books') {
      // Books key on `synced_at` — the server-assigned cursor the Worker stamps
      // on every write, including deletes. A strict `>` on it never skips a
      // row (issue #4678).
      const clauses = ['user_id = ?', 'synced_at > ?'];
      const args: unknown[] = [userId, sinceIso];
      const filter = bookFilter(book, metaHash);
      if (filter) {
        clauses.push(filter.replace(/^ AND /, ''));
        args.push(...bookFilterArgs(book, metaHash));
      }
      args.push(cap);
      const { results: rows } = await db
        .prepare(
          `SELECT ${BOOK_COLUMNS} FROM books WHERE ${clauses.join(' AND ')}
           ORDER BY synced_at ASC LIMIT ?`,
        )
        .bind(...args)
        .all<Record<string, unknown>>();
      results['books'] = (rows ?? []).map((row) => bookRowToWire(row as unknown as BookRow));
    }

    if (!type || type === 'configs') {
      const clauses = ['user_id = ?', '(updated_at > ? OR deleted_at > ?)'];
      const args: unknown[] = [userId, sinceIso, sinceIso];
      const filter = bookFilter(book, metaHash);
      if (filter) {
        clauses.push(filter.replace(/^ AND /, ''));
        args.push(...bookFilterArgs(book, metaHash));
      }
      args.push(cap);
      const { results: rows } = await db
        .prepare(
          `SELECT ${CONFIG_COLUMNS} FROM book_configs WHERE ${clauses.join(' AND ')}
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .bind(...args)
        .all<Record<string, unknown>>();
      results['configs'] = (rows ?? []).map((row) =>
        bookConfigRowToWire(row as unknown as BookConfigRow),
      );
    }

    if (!type || type === 'notes') {
      const clauses = ['user_id = ?', '(updated_at > ? OR deleted_at > ?)'];
      const args: unknown[] = [userId, sinceIso, sinceIso];
      const filter = bookFilter(book, metaHash);
      if (filter) {
        clauses.push(filter.replace(/^ AND /, ''));
        args.push(...bookFilterArgs(book, metaHash));
      }
      args.push(cap);
      const { results: rows } = await db
        .prepare(
          `SELECT ${NOTE_COLUMNS} FROM book_notes WHERE ${clauses.join(' AND ')}
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .bind(...args)
        .all<Record<string, unknown>>();
      results['notes'] = (rows ?? []).map((row) =>
        bookNoteRowToWire(row as unknown as BookNoteRow),
      );
    }

    if (!type || type === 'stats') {
      const { results: statBooks } = await db
        .prepare(
          `SELECT user_id, book_hash, title, authors, updated_at, deleted_at
           FROM stat_books WHERE user_id = ? AND updated_at > ?
           ORDER BY updated_at ASC LIMIT ?`,
        )
        .bind(userId, sinceIso, cap)
        .all<Record<string, unknown>>();
      const { results: statPages } = await db
        .prepare(
          `SELECT user_id, book_hash, page, start_time, duration, total_pages, ext,
                  updated_at, deleted_at
           FROM stat_pages WHERE user_id = ? AND updated_at > ?
           ORDER BY updated_at ASC LIMIT ?`,
        )
        .bind(userId, sinceIso, cap)
        .all<Record<string, unknown>>();

      // The client computes the pull cursor from `updated_at_ms`; the Postgres
      // backend attaches it to every row it returns.
      const withMs = <T extends Record<string, unknown>>(rows: T[]) =>
        rows.map((row) => ({
          ...row,
          updated_at_ms: new Date(String(row['updated_at'])).getTime(),
        }));
      results['statBooks'] = withMs(statBooks ?? []);
      results['statPages'] = withMs(statPages ?? []);
    }
  } catch (error) {
    // The client gets a generic message; the details stay in the log.
    console.error('sync pull failed', error);
    return errorJson('Pull failed', 500);
  }

  return json(results);
};
