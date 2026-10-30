import { describe, expect, it } from 'vitest';

import { DEFAULT_BOOK_LAYOUT } from '@/services/constants';

describe('view settings defaults', () => {
  it('defaults scrolledDirection to vertical (minerva#4995)', () => {
    expect(DEFAULT_BOOK_LAYOUT.scrolledDirection).toBe('vertical');
  });
});
