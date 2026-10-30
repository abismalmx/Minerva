import { describe, it, expect } from 'vitest';

// The storage ticket is the credential the client uses to transfer the book
// bytes: it PUTs / GETs the object URL without an Authorization header, the
// same way it uses a presigned R2 URL. The ticket must therefore be bound to
// its key and must expire.
import {
  mintTicket,
  signTicket,
  TICKET_TTL_SECONDS,
  verifyTicket,
} from '../../../workers/minerva-sync/src/storageTicket';

const SECRET = 'test-secret-value';
const KEY = 'user-1/Minerva/Books/abc/book.epub';

describe('storage tickets', () => {
  it('accepts a freshly minted ticket for its own key', async () => {
    const ticket = await mintTicket(SECRET, KEY);
    expect(ticket).toBeTruthy();
    await expect(verifyTicket(SECRET, KEY, ticket)).resolves.toBe(true);
  });

  it('rejects a ticket presented for a different key', async () => {
    const ticket = await mintTicket(SECRET, KEY);
    await expect(verifyTicket(SECRET, 'user-1/other/book.epub', ticket)).resolves.toBe(false);
  });

  it('rejects a ticket signed with a different secret', async () => {
    const ticket = await mintTicket(SECRET, KEY);
    await expect(verifyTicket('another-secret', KEY, ticket)).resolves.toBe(false);
  });

  it('rejects a missing or malformed ticket', async () => {
    await expect(verifyTicket(SECRET, KEY, null)).resolves.toBe(false);
    await expect(verifyTicket(SECRET, KEY, '')).resolves.toBe(false);
    await expect(verifyTicket(SECRET, KEY, 'not-a-ticket')).resolves.toBe(false);
    await expect(verifyTicket(SECRET, KEY, '.sig')).resolves.toBe(false);
  });

  it('rejects an expired ticket', async () => {
    const now = 1_700_000_000;
    const ticket = await mintTicket(SECRET, KEY, now);
    // One second past the TTL.
    await expect(verifyTicket(SECRET, KEY, ticket, now + TICKET_TTL_SECONDS + 1)).resolves.toBe(
      false,
    );
  });

  it('mints no ticket without a signing secret', async () => {
    await expect(mintTicket(undefined, KEY)).resolves.toBeNull();
    await expect(verifyTicket(undefined, KEY, 'anything')).resolves.toBe(false);
  });

  it('is deterministic for the same key and expiry', async () => {
    const a = await signTicket(SECRET, KEY, 1_700_000_000);
    const b = await signTicket(SECRET, KEY, 1_700_000_000);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
