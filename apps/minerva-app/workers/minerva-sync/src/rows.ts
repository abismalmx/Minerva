/**
 * Row mapping between the D1 tables and the wire shape the client speaks.
 *
 * The client transforms a `Book` into a `DBBook` before pushing and transforms
 * the response back with `transformBookFromDB` / `transformBookConfigFromDB` /
 * `transformBookNoteFromDB`. Those transforms read snake_case column names, so
 * the Worker answers with the same column names the Postgres backend does.
 *
 * Two conventions differ between SQLite and Postgres and are handled here:
 *
 * - `tags` and `progress` are `jsonb` in Postgres; SQLite has no JSON type,
 *   so they are stored as TEXT. The wire keeps the Postgres shape: `tags` is
 *   an ARRAY, `progress` is a `[number, number]` tuple.
 * - `global` is a reserved word in SQL, so the column is `global_flag`; the
 *   wire still calls it `global`.
 * - `notes.progress` etc. keep `null` rather than `undefined`, so a missing
 *   column never wipes a value the client holds.
 */

export interface BookRow {
  user_id: string;
  book_hash: string;
  meta_hash: string | null;
  format: string;
  title: string;
  source_title: string | null;
  author: string;
  group_id: string | null;
  group_name: string | null;
  group_updated_at: string | null;
  tags: string | null;
  progress: string | null;
  reading_status: string | null;
  reading_status_updated_at: string | null;
  cover_hash: string | null;
  cover_updated_at: string | null;
  page_count: number | null;
  metadata: string | null;
  metadata_updated_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  uploaded_at: string | null;
  synced_at: string;
}

export interface BookConfigRow {
  user_id: string;
  book_hash: string;
  meta_hash: string | null;
  location: string | null;
  xpointer: string | null;
  progress: string | null;
  rsvp_position: string | null;
  search_config: string | null;
  view_settings: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface BookNoteRow {
  user_id: string;
  book_hash: string;
  meta_hash: string | null;
  id: string;
  type: string | null;
  cfi: string | null;
  xpointer0: string | null;
  xpointer1: string | null;
  page: number | null;
  text: string | null;
  style: string | null;
  color: string | null;
  note: string | null;
  global_flag: number | null;
  ink: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Parse a JSON column, tolerating malformed text (returns null). */
const parseJson = <T>(value: string | null | undefined): T | null => {
  if (value == null || value === '') return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

/** A book row as the client expects to receive it. */
export const bookRowToWire = (row: BookRow) => ({
  ...row,
  tags: parseJson<string[]>(row.tags),
  progress: parseJson<[number, number]>(row.progress),
});

export const bookConfigRowToWire = (row: BookConfigRow) => ({ ...row });

export const bookNoteRowToWire = (row: BookNoteRow) => ({
  ...row,
  global: row.global_flag == null ? null : row.global_flag === 1,
  ink: parseJson<unknown[]>(row.ink),
});

/** Serialize the `tags` array for storage. */
export const serializeTags = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  return JSON.stringify(value);
};

/** Parse the stored `tags` column back into an array. */
export const parseTags = (value: string | null | undefined): string[] | null => {
  const parsed = parseJson<unknown>(value);
  return Array.isArray(parsed) ? (parsed as string[]) : null;
};

/**
 * Serialize the `progress` tuple. The Postgres column is `jsonb` holding
 * `[current, total]`; the client sends it already JSON-encoded.
 */
export const serializeProgress = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'string') {
    // Already JSON (the client encodes before sending); keep it as-is but
    // reject anything that is not a 2-number tuple.
    const parsed = parseJson<unknown>(value);
    return isProgressTuple(parsed) ? JSON.stringify(parsed) : null;
  }
  return isProgressTuple(value) ? JSON.stringify(value) : null;
};

export const isProgressTuple = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'number' &&
  typeof value[1] === 'number';

/** Serialize the `ink` strokes column. */
export const serializeInk = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};
