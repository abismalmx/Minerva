import { describe, it, expect } from 'vitest';
import { buildShareUrl, parseShareDeepLink } from '@/utils/share';

describe('buildShareUrl', () => {
  it('builds the canonical https URL for a token', () => {
    expect(buildShareUrl('aBcDeFgHiJkLmNoPqRsTuV')).toBe(
      'https://web.minerva.invalid/s/aBcDeFgHiJkLmNoPqRsTuV',
    );
  });
});

describe('parseShareDeepLink', () => {
  const VALID_TOKEN = 'aBcDeFgHiJkLmNoPqRsTuV';

  it('parses minerva://share/{token}', () => {
    expect(parseShareDeepLink(`minerva://share/${VALID_TOKEN}`)).toEqual({ token: VALID_TOKEN });
  });

  it('parses https://web.minerva.invalid/s/{token}', () => {
    expect(parseShareDeepLink(`https://web.minerva.invalid/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('parses *.minerva.invalid subdomains for preview deploys', () => {
    expect(parseShareDeepLink(`https://staging.minerva.invalid/s/${VALID_TOKEN}`)).toEqual({
      token: VALID_TOKEN,
    });
  });

  it('rejects tokens of the wrong length', () => {
    expect(parseShareDeepLink('minerva://share/short')).toBeNull();
    expect(parseShareDeepLink(`minerva://share/${VALID_TOKEN}extra`)).toBeNull();
  });

  it('rejects tokens with disallowed characters', () => {
    // Underscore and hyphen are explicitly NOT in the alphabet.
    const bad = 'aBcDeFgHiJkLmNoPqRsTu-';
    expect(parseShareDeepLink(`minerva://share/${bad}`)).toBeNull();
  });

  it('rejects URLs from third-party hosts', () => {
    expect(parseShareDeepLink(`https://evil.example.com/s/${VALID_TOKEN}`)).toBeNull();
  });

  it('rejects minerva:// URLs whose host is not "share"', () => {
    expect(parseShareDeepLink(`minerva://book/${VALID_TOKEN}`)).toBeNull();
    expect(parseShareDeepLink(`minerva://annotation/${VALID_TOKEN}`)).toBeNull();
  });

  it('rejects nested or extra path segments', () => {
    expect(parseShareDeepLink(`https://web.minerva.invalid/s/${VALID_TOKEN}/extra`)).toBeNull();
    expect(parseShareDeepLink(`https://web.minerva.invalid/extra/s/${VALID_TOKEN}`)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseShareDeepLink('')).toBeNull();
    expect(parseShareDeepLink('not-a-url')).toBeNull();
    expect(parseShareDeepLink('ftp://web.minerva.invalid/s/' + VALID_TOKEN)).toBeNull();
  });
});
