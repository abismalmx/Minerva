import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  searchWikipediaImages,
  searchWikimediaCommons,
  searchPersonImages,
} from '@/services/imageSearch/imageSearchService';

describe('imageSearchService', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('searchWikipediaImages', () => {
    it('returns empty array when query is blank', async () => {
      const results = await searchWikipediaImages('   ');
      expect(results).toEqual([]);
    });

    it('parses Wikipedia response with thumbnails and extracts correctly', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '101': {
                pageid: 101,
                title: 'Napoleón Bonaparte',
                index: 1,
                thumbnail: {
                  source: 'https://upload.wikimedia.org/thumb/napoleon.jpg',
                  width: 400,
                  height: 600,
                },
                original: {
                  source: 'https://upload.wikimedia.org/original/napoleon.jpg',
                  width: 1200,
                  height: 1800,
                },
                extract: '<p>Napoleón Bonaparte fue un militar y gobernante francés.</p>',
              },
            },
          },
        }),
      } as unknown as Response);

      const results = await searchWikipediaImages('Napoleon', 'es');
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: 'wiki-101',
        title: 'Napoleón Bonaparte',
        thumbnailUrl: 'https://upload.wikimedia.org/thumb/napoleon.jpg',
        originalUrl: 'https://upload.wikimedia.org/original/napoleon.jpg',
        extract: 'Napoleón Bonaparte fue un militar y gobernante francés.',
        source: 'wikipedia',
        pageUrl: 'https://es.wikipedia.org/wiki/Napole%C3%B3n_Bonaparte',
        width: 400,
        height: 600,
      });
    });

    it('falls back to English when local language returns no pages', async () => {
      const fetchMock = vi
        .fn()
        // First call for 'es' returns no pages
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ query: { pages: {} } }),
        } as unknown as Response)
        // Second call for 'en' fallback returns results
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              pages: {
                '202': {
                  pageid: 202,
                  title: 'Alexander the Great',
                  index: 1,
                  thumbnail: {
                    source: 'https://upload.wikimedia.org/thumb/alexander.jpg',
                    width: 300,
                    height: 400,
                  },
                  extract: 'Alexander III of Macedon was a king of Macedonia.',
                },
              },
            },
          }),
        } as unknown as Response);

      globalThis.fetch = fetchMock;

      const results = await searchWikipediaImages('Alexander', 'es');
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe('Alexander the Great');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toContain('es.wikipedia.org');
      expect(fetchMock.mock.calls[1]?.[0]).toContain('en.wikipedia.org');
    });
  });

  describe('searchWikimediaCommons', () => {
    it('parses Commons response and cleans up file names and metadata', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '501': {
                pageid: 501,
                title: 'File:Portrait_of_Isaac_Newton_1689.jpg',
                index: 1,
                imageinfo: [
                  {
                    thumburl: 'https://upload.wikimedia.org/thumb/newton.jpg',
                    url: 'https://upload.wikimedia.org/original/newton.jpg',
                    thumbwidth: 400,
                    thumbheight: 500,
                    descriptionurl:
                      'https://commons.wikimedia.org/wiki/File:Portrait_of_Isaac_Newton_1689.jpg',
                    extmetadata: {
                      ImageDescription: {
                        value: 'Portrait of <b>Isaac Newton</b> in 1689.',
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      } as unknown as Response);

      const results = await searchWikimediaCommons('Isaac Newton');
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe('Portrait of Isaac Newton 1689');
      expect(results[0]?.thumbnailUrl).toBe('https://upload.wikimedia.org/thumb/newton.jpg');
      expect(results[0]?.extract).toBe('Portrait of Isaac Newton in 1689.');
      expect(results[0]?.source).toBe('wikimedia');
    });
  });

  describe('searchPersonImages', () => {
    it('combines results and deduplicates by URL', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('wikipedia.org')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              query: {
                pages: {
                  '1': {
                    pageid: 1,
                    title: 'Marie Curie',
                    thumbnail: { source: 'https://images.org/curie.jpg' },
                  },
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            query: {
              pages: {
                '2': {
                  pageid: 2,
                  title: 'File:Marie_Curie_Lab.jpg',
                  imageinfo: [{ thumburl: 'https://images.org/curie.jpg' }], // Duplicate URL
                },
                '3': {
                  pageid: 3,
                  title: 'File:Curie_Nobel.jpg',
                  imageinfo: [{ thumburl: 'https://images.org/nobel.jpg' }],
                },
              },
            },
          }),
        });
      });

      const results = await searchPersonImages('Marie Curie', 'es');
      expect(results).toHaveLength(2);
      expect(results[0]?.thumbnailUrl).toBe('https://images.org/curie.jpg');
      expect(results[1]?.thumbnailUrl).toBe('https://images.org/nobel.jpg');
    });
  });
});
