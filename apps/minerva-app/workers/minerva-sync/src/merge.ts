/**
 * Last-writer-wins merge rules for the native sync API.
 *
 * Ported from the hosted backend (apps/minerva-app/src/pages/api/sync.ts) so a
 * self-hosted deployment resolves concurrent edits exactly like the hosted
 * one. The rules are subtle on purpose — each field group carries its own
 * clock so that a page turn cannot clobber a cover edit, a metadata edit or a
 * group move:
 *
 * - `reading_status` / `reading_status_updated_at` — own clock (#4634).
 * - `cover_hash` / `cover_updated_at` — own clock (#4544).
 * - `title` / `author` / `tags` / `metadata` — own clock (#5438). A metadata
 *   blob that is ABSENT means "this device never had one", never "the user
 *   cleared it", so it must not overwrite a copy that has one (#5912).
 * - `group_id` / `group_name` — own clock (#5911). On a tie the side that HAS
 *   a group wins, because an absent group is ambiguous.
 * - `page_count` — resolved with the row winner.
 *
 * Every input type accepts `undefined` (a column the client never sent) and
 * every resolved type is concrete, so the result can be written straight back
 * to a NOT NULL-tolerant column without a narrowing cast.
 */

const ms = (value?: string | number | null): number => (value ? new Date(value).getTime() : 0);

export interface BookStatusFields {
  reading_status?: string | null;
  reading_status_updated_at?: string | null;
}

export interface BookCoverFields {
  cover_hash?: string | null;
  cover_updated_at?: string | null;
}

export interface BookMetadataFields {
  title: string;
  author: string;
  tags?: string[] | null;
  metadata?: string | null;
  metadata_updated_at?: string | null;
}

export interface BookGroupFields {
  group_id?: string | null;
  group_name?: string | null;
  group_updated_at?: string | null;
}

export interface BookPageCountFields {
  page_count?: number | null;
}

/** The resolved status fields. */
export interface ResolvedStatus {
  reading_status: string | null;
  reading_status_updated_at: string | null;
}

/** The resolved cover fields. */
export interface ResolvedCover {
  cover_hash: string | null;
  cover_updated_at: string | null;
}

/** The resolved metadata fields. */
export interface ResolvedMetadata {
  title: string;
  author: string;
  tags: string[] | null;
  metadata: string | null;
  metadata_updated_at: string | null;
}

/** The resolved group fields. */
export interface ResolvedGroup {
  group_id: string | null;
  group_name: string | null;
  group_updated_at: string | null;
}

/** Whether the reading status actually differs (a timestamp-only diff is not a change). */
export const readingStatusChanged = (client?: string | null, server?: string | null): boolean =>
  (client ?? null) !== (server ?? null);

export const resolveReadingStatusMerge = (
  client: BookStatusFields,
  server: BookStatusFields,
): ResolvedStatus =>
  ms(client.reading_status_updated_at) >= ms(server.reading_status_updated_at)
    ? {
        reading_status: client.reading_status ?? null,
        reading_status_updated_at: client.reading_status_updated_at ?? null,
      }
    : {
        reading_status: server.reading_status ?? null,
        reading_status_updated_at: server.reading_status_updated_at ?? null,
      };

export const resolveCoverMerge = (
  client: BookCoverFields,
  server: BookCoverFields,
): ResolvedCover =>
  ms(client.cover_updated_at) >= ms(server.cover_updated_at)
    ? {
        cover_hash: client.cover_hash ?? null,
        cover_updated_at: client.cover_updated_at ?? null,
      }
    : {
        cover_hash: server.cover_hash ?? null,
        cover_updated_at: server.cover_updated_at ?? null,
      };

const pickMetadataFields = (b: BookMetadataFields): ResolvedMetadata => ({
  title: b.title,
  author: b.author,
  tags: b.tags ?? null,
  metadata: b.metadata ?? null,
  metadata_updated_at: b.metadata_updated_at ?? null,
});

export const resolveMetadataMerge = (
  client: BookMetadataFields,
  server: BookMetadataFields,
  clientRowWins: boolean,
): ResolvedMetadata => {
  const clientMs = ms(client.metadata_updated_at);
  const serverMs = ms(server.metadata_updated_at);
  const clientWins = clientMs === serverMs ? clientRowWins : clientMs > serverMs;
  const winner = clientWins ? client : server;
  const loser = clientWins ? server : client;
  const fields = pickMetadataFields(winner);
  // An absent `metadata` blob means "this device never had one" — a cloud-shelf
  // row, a file-sync discovery row, an old client — never "the user cleared
  // it": nothing in the app empties book.metadata. So it must never overwrite
  // a copy that has one, on any clock (#5912).
  fields.metadata = fields.metadata ?? loser.metadata ?? null;
  return fields;
};

/** Value-level change check: a timestamp-only difference on identical values is a no-op. */
export const bookMetadataChanged = (
  a: Omit<BookMetadataFields, 'metadata_updated_at'>,
  b: Omit<BookMetadataFields, 'metadata_updated_at'>,
): boolean =>
  a.title !== b.title ||
  a.author !== b.author ||
  (a.metadata ?? null) !== (b.metadata ?? null) ||
  JSON.stringify(a.tags ?? null) !== JSON.stringify(b.tags ?? null);

const pickGroupFields = (b: BookGroupFields): ResolvedGroup => ({
  group_id: b.group_id ?? null,
  group_name: b.group_name ?? null,
  group_updated_at: b.group_updated_at ?? null,
});

const hasGroup = (g: BookGroupFields): boolean => !!(g.group_id || g.group_name);

export const resolveGroupMerge = (
  client: BookGroupFields,
  server: BookGroupFields,
  clientRowWins: boolean,
): ResolvedGroup => {
  const clientMs = ms(client.group_updated_at);
  const serverMs = ms(server.group_updated_at);
  if (clientMs !== serverMs) return pickGroupFields(clientMs > serverMs ? client : server);
  if (hasGroup(client) !== hasGroup(server)) {
    return pickGroupFields(hasGroup(client) ? client : server);
  }
  return pickGroupFields(clientRowWins ? client : server);
};

export const bookGroupChanged = (a: BookGroupFields, b: BookGroupFields): boolean =>
  (a.group_id ?? null) !== (b.group_id ?? null) ||
  (a.group_name ?? null) !== (b.group_name ?? null);

export const resolvePageCountMerge = (
  client: BookPageCountFields,
  server: BookPageCountFields,
  clientRowWins: boolean,
): number | null => {
  const clientValue = client.page_count ?? null;
  const serverValue = server.page_count ?? null;
  if (clientValue === serverValue) return serverValue;
  // An absent page count means "this device never knew it" — the reader
  // computes it lazily and pushes it once; it must not erase a known count.
  if (clientValue == null) return serverValue;
  if (serverValue == null) return clientValue;
  return clientRowWins ? clientValue : serverValue;
};
