import { describe, it, expect } from 'vitest';

// The push-side merge of a books row: the field-level last-writer-wins rules
// that keep a page turn from clobbering a cover edit, a metadata edit or a
// group move. These mirror the hosted backend (src/pages/api/sync.ts).
import { mergeBook } from '../../../workers/minerva-sync/src/push';
import type { BookRow } from '../../../workers/minerva-sync/src/rows';

const STAMP = '2026-06-01T00:00:00.000Z';

const serverRow = (overrides: Partial<BookRow> = {}): BookRow => ({
  user_id: 'u1',
  book_hash: 'h1',
  meta_hash: null,
  format: 'EPUB',
  title: 'Server Title',
  source_title: null,
  author: 'Server Author',
  group_id: null,
  group_name: null,
  group_updated_at: null,
  tags: null,
  progress: null,
  reading_status: null,
  reading_status_updated_at: null,
  cover_hash: null,
  cover_updated_at: null,
  page_count: null,
  metadata: null,
  metadata_updated_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  uploaded_at: null,
  synced_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('mergeBook', () => {
  it('inserts when the row does not exist yet', () => {
    const merged = mergeBook(
      { book_hash: 'h1', title: 'New', author: 'A', updated_at: '2026-02-01T00:00:00.000Z' },
      null,
      STAMP,
    );
    expect(merged.title).toBe('New');
    expect(merged.synced_at).toBe(STAMP);
  });

  it('lets the newer client row win', () => {
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Client Title',
        author: 'Client Author',
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      serverRow(),
      STAMP,
    );
    expect(merged.title).toBe('Client Title');
    expect(merged.author).toBe('Client Author');
  });

  it('keeps the server row when the client one is older', () => {
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Stale Title',
        author: 'Stale Author',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
      serverRow(),
      STAMP,
    );
    expect(merged.title).toBe('Server Title');
  });

  it('grafts the fresher reading status onto a server-won row (#4634)', () => {
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Client Title',
        author: 'A',
        // The row itself is OLDER than the server's, so the server wins the
        // row — but the STATUS was changed more recently.
        updated_at: '2026-01-01T00:00:00.000Z',
        reading_status: 'finished',
        reading_status_updated_at: '2026-03-01T00:00:00.000Z',
      },
      serverRow({
        updated_at: '2026-02-01T00:00:00.000Z',
        reading_status: 'reading',
        reading_status_updated_at: '2026-02-01T00:00:00.000Z',
      }),
      STAMP,
    );
    // The server wins the row, so its title is kept...
    expect(merged.title).toBe('Server Title');
    // ...and the fresher status rides along.
    expect(merged.reading_status).toBe('finished');
  });

  it('grafts the server status onto a client-won row (#4634)', () => {
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Client Title',
        author: 'A',
        // The row is newer, so the client wins it — but its STATUS is older.
        updated_at: '2026-04-01T00:00:00.000Z',
        reading_status: 'unread',
        reading_status_updated_at: '2026-01-01T00:00:00.000Z',
      },
      serverRow({
        reading_status: 'reading',
        reading_status_updated_at: '2026-03-01T00:00:00.000Z',
      }),
      STAMP,
    );
    // The client wins the row, so its title is kept...
    expect(merged.title).toBe('Client Title');
    // ...and the fresher status rides along.
    expect(merged.reading_status).toBe('reading');
  });

  it('keeps the fresher status on a server-won row (#4634)', () => {
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Newer Title',
        author: 'Z',
        updated_at: '2026-04-01T00:00:00.000Z',
        // The status is OLDER than the server's — the server's must survive.
        reading_status: 'unread',
        reading_status_updated_at: '2026-01-01T00:00:00.000Z',
      },
      serverRow({
        reading_status: 'reading',
        reading_status_updated_at: '2026-03-01T00:00:00.000Z',
      }),
      STAMP,
    );
    expect(merged.title).toBe('Newer Title');
    expect(merged.reading_status).toBe('reading');
  });

  it('never lets a metadata-less copy erase a copy that has one (#5912)', () => {
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Newer Title',
        author: 'Z',
        updated_at: '2026-04-01T00:00:00.000Z',
        metadata: null,
        metadata_updated_at: '2026-04-01T00:00:00.000Z',
      },
      serverRow({
        metadata: '{"description":"keep me"}',
        metadata_updated_at: '2026-01-01T00:00:00.000Z',
      }),
      STAMP,
    );
    expect(merged.metadata).toBe('{"description":"keep me"}');
  });

  it('never lets an unknown page count erase a known one', () => {
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Newer Title',
        author: 'Z',
        updated_at: '2026-04-01T00:00:00.000Z',
        page_count: null,
      },
      serverRow({ page_count: 321 }),
      STAMP,
    );
    expect(merged.page_count).toBe(321);
  });

  it('advances synced_at so peers re-pull the resolved row (#4678)', () => {
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Newer Title',
        author: 'Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      },
      serverRow(),
      STAMP,
    );
    expect(merged.synced_at).toBe(STAMP);
  });

  it('leaves updated_at alone when only a field group changed (#4678)', () => {
    const server = serverRow({
      reading_status: 'reading',
      reading_status_updated_at: '2026-02-01T00:00:00.000Z',
    });
    const merged = mergeBook(
      {
        book_hash: 'h1',
        title: 'Server Title',
        author: 'Server Author',
        updated_at: '2026-01-01T00:00:00.000Z',
        reading_status: 'finished',
        reading_status_updated_at: '2026-03-01T00:00:00.000Z',
      },
      server,
      STAMP,
    );
    expect(merged.reading_status).toBe('finished');
    // The row's own sort key must not move just because a field group changed.
    expect(merged.updated_at).toBe(server.updated_at);
  });
});
