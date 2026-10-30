import { describe, it, expect } from 'vitest';

// Merge rules and validation of the self-hosted sync Worker. These mirror the
// hosted backend's behaviour (apps/minerva-app/src/pages/api/sync.ts) so a
// self-hosted deployment resolves concurrent edits the same way.
import {
  bookGroupChanged,
  bookMetadataChanged,
  readingStatusChanged,
  resolveCoverMerge,
  resolveGroupMerge,
  resolveMetadataMerge,
  resolvePageCountMerge,
  resolveReadingStatusMerge,
} from '../../../workers/minerva-sync/src/merge';
import { isSafeObjectKeyName } from '../../../workers/minerva-sync/src/storage';
import { isValidEmail, normalizeEmail } from '../../../workers/minerva-sync/src/accounts';
import {
  parseTags,
  serializeProgress,
  serializeTags,
} from '../../../workers/minerva-sync/src/rows';

describe('resolveReadingStatusMerge', () => {
  it('keeps the fresher status on its own clock (#4634)', () => {
    const resolved = resolveReadingStatusMerge(
      { reading_status: 'reading', reading_status_updated_at: '2026-01-02T00:00:00.000Z' },
      { reading_status: 'unread', reading_status_updated_at: '2026-01-01T00:00:00.000Z' },
    );
    expect(resolved.reading_status).toBe('reading');
  });

  it('keeps the server status when the client one is older', () => {
    const resolved = resolveReadingStatusMerge(
      { reading_status: 'reading', reading_status_updated_at: '2026-01-01T00:00:00.000Z' },
      { reading_status: 'finished', reading_status_updated_at: '2026-01-02T00:00:00.000Z' },
    );
    expect(resolved.reading_status).toBe('finished');
  });

  it('treats an unstamped status as the epoch', () => {
    const resolved = resolveReadingStatusMerge(
      { reading_status: 'reading' },
      { reading_status: 'finished', reading_status_updated_at: '2026-01-02T00:00:00.000Z' },
    );
    expect(resolved.reading_status).toBe('finished');
  });
});

describe('readingStatusChanged', () => {
  it('ignores a missing status on both sides', () => {
    expect(readingStatusChanged(undefined, null)).toBe(false);
    expect(readingStatusChanged('reading', 'reading')).toBe(false);
    expect(readingStatusChanged('reading', 'finished')).toBe(true);
  });
});

describe('resolveCoverMerge', () => {
  it('keeps the fresher cover on its own clock (#4544)', () => {
    const resolved = resolveCoverMerge(
      { cover_hash: 'new', cover_updated_at: '2026-01-02T00:00:00.000Z' },
      { cover_hash: 'old', cover_updated_at: '2026-01-01T00:00:00.000Z' },
    );
    expect(resolved.cover_hash).toBe('new');
  });

  it('keeps the server cover when the client one is older', () => {
    const resolved = resolveCoverMerge(
      { cover_hash: 'new', cover_updated_at: '2026-01-01T00:00:00.000Z' },
      { cover_hash: 'old', cover_updated_at: '2026-01-02T00:00:00.000Z' },
    );
    expect(resolved.cover_hash).toBe('old');
  });
});

describe('resolveMetadataMerge', () => {
  it('keeps the fresher metadata on its own clock (#5438)', () => {
    const resolved = resolveMetadataMerge(
      {
        title: 'New',
        author: 'A',
        metadata: '{"n":1}',
        metadata_updated_at: '2026-01-02T00:00:00.000Z',
      },
      {
        title: 'Old',
        author: 'B',
        metadata: '{"n":0}',
        metadata_updated_at: '2026-01-01T00:00:00.000Z',
      },
      false,
    );
    expect(resolved.title).toBe('New');
    expect(resolved.metadata).toBe('{"n":1}');
  });

  it('never lets a metadata-less copy erase a copy that has one (#5912)', () => {
    const resolved = resolveMetadataMerge(
      {
        title: 'New',
        author: 'A',
        metadata: null,
        metadata_updated_at: '2026-01-02T00:00:00.000Z',
      },
      {
        title: 'Old',
        author: 'B',
        metadata: '{"d":"desc"}',
        metadata_updated_at: '2026-01-01T00:00:00.000Z',
      },
      true,
    );
    expect(resolved.metadata).toBe('{"d":"desc"}');
  });

  it('falls back to the row winner on a tie', () => {
    const resolved = resolveMetadataMerge(
      { title: 'Client', author: 'A', metadata: null, metadata_updated_at: null },
      { title: 'Server', author: 'B', metadata: null, metadata_updated_at: null },
      false,
    );
    expect(resolved.title).toBe('Server');
  });
});

describe('bookMetadataChanged', () => {
  it('reports a change only when a VALUE differs', () => {
    const base = { title: 'T', author: 'A', tags: ['x'], metadata: '{"a":1}' };
    expect(bookMetadataChanged(base, { ...base })).toBe(false);
    expect(bookMetadataChanged(base, { ...base, title: 'U' })).toBe(true);
    expect(bookMetadataChanged(base, { ...base, tags: ['y'] })).toBe(true);
  });
});

describe('resolveGroupMerge', () => {
  it('keeps the fresher group on its own clock (#5911)', () => {
    const resolved = resolveGroupMerge(
      { group_id: 'g2', group_name: 'Two', group_updated_at: '2026-01-02T00:00:00.000Z' },
      { group_id: 'g1', group_name: 'One', group_updated_at: '2026-01-01T00:00:00.000Z' },
      false,
    );
    expect(resolved.group_id).toBe('g2');
  });

  it('prefers the side that HAS a group when the clocks tie', () => {
    const resolved = resolveGroupMerge(
      { group_id: 'g1', group_name: 'One', group_updated_at: null },
      { group_id: null, group_name: null, group_updated_at: null },
      false,
    );
    expect(resolved.group_id).toBe('g1');
  });

  it('follows the row winner when both sides agree about having a group', () => {
    const resolved = resolveGroupMerge(
      { group_id: 'g1', group_name: 'One', group_updated_at: null },
      { group_id: 'g2', group_name: 'Two', group_updated_at: null },
      true,
    );
    expect(resolved.group_id).toBe('g1');
  });
});

describe('bookGroupChanged', () => {
  it('reports a change when the group id or name differs', () => {
    expect(bookGroupChanged({ group_id: 'g' }, { group_id: 'g' })).toBe(false);
    expect(bookGroupChanged({ group_id: 'g' }, { group_id: 'h' })).toBe(true);
    expect(bookGroupChanged({ group_name: 'A' }, { group_name: 'B' })).toBe(true);
  });
});

describe('resolvePageCountMerge', () => {
  it('never lets an unknown page count erase a known one', () => {
    expect(resolvePageCountMerge({}, { page_count: 120 }, true)).toBe(120);
  });

  it('adopts a page count the server does not have yet', () => {
    expect(resolvePageCountMerge({ page_count: 42 }, {}, false)).toBe(42);
  });

  it('follows the row winner when both sides have a count', () => {
    expect(resolvePageCountMerge({ page_count: 1 }, { page_count: 2 }, true)).toBe(1);
    expect(resolvePageCountMerge({ page_count: 1 }, { page_count: 2 }, false)).toBe(2);
  });
});

describe('isSafeObjectKeyName', () => {
  it('accepts an ordinary file name', () => {
    expect(isSafeObjectKeyName('book.epub')).toBe(true);
    expect(isSafeObjectKeyName('Minerva/Books/abc/book.epub')).toBe(true);
  });

  it('rejects a path traversal out of the user prefix (GHSA-mfmj-2frf-vhgw)', () => {
    expect(isSafeObjectKeyName('../other-user/book.epub')).toBe(false);
    expect(isSafeObjectKeyName('a/../../b')).toBe(false);
    expect(isSafeObjectKeyName('/absolute')).toBe(false);
    expect(isSafeObjectKeyName('trailing/')).toBe(false);
    expect(isSafeObjectKeyName('')).toBe(false);
  });
});

describe('email validation', () => {
  it('normalizes the email for storage and lookup', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
  });

  it('accepts a well-formed address and rejects a malformed one', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('a b@example.com')).toBe(false);
  });
});

describe('JSON column serialization', () => {
  it('round-trips the tags array', () => {
    expect(parseTags(serializeTags(['a', 'b']))).toEqual(['a', 'b']);
    expect(serializeTags('not an array')).toBeNull();
    expect(parseTags(null)).toBeNull();
  });

  it('keeps only a two-number progress tuple', () => {
    expect(serializeProgress([1, 10])).toBe('[1,10]');
    expect(serializeProgress('[1,10]')).toBe('[1,10]');
    expect(serializeProgress([1, 10, 100])).toBeNull();
    expect(serializeProgress(['a', 'b'])).toBeNull();
    expect(serializeProgress(null)).toBeNull();
  });
});
