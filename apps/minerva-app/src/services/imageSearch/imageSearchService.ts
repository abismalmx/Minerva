export interface ImageSearchResult {
  id: string;
  title: string;
  thumbnailUrl: string;
  originalUrl: string;
  extract?: string;
  source: 'wikipedia' | 'wikimedia' | 'custom';
  pageUrl?: string;
  width?: number;
  height?: number;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Searches Wikipedia articles for people, characters, places or concepts
 * and retrieves their lead image thumbnail, full image, and biographical extract.
 */
export async function searchWikipediaImages(
  query: string,
  lang = 'es',
  limit = 10,
  signal?: AbortSignal,
): Promise<ImageSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const safeLang = lang && /^[a-z]{2,5}(-[a-z]+)?$/i.test(lang) ? lang.toLowerCase() : 'es';
  const url = `https://${safeLang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(
    cleanQuery,
  )}&gsrlimit=${limit}&prop=pageimages|extracts&piprop=thumbnail|original&pithumbsize=500&exintro=1&explaintext=1&exchars=260`;

  try {
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Wikipedia request failed: ${res.status}`);
    const data = await res.json();

    const pages = data?.query?.pages;
    if (!pages) {
      // Fallback to English if current language returned nothing and isn't English
      if (safeLang !== 'en') {
        return searchWikipediaImages(cleanQuery, 'en', limit, signal);
      }
      return [];
    }

    const results: ImageSearchResult[] = [];
    const entries = Object.values(pages) as Array<{
      pageid: number;
      title: string;
      index?: number;
      thumbnail?: { source: string; width: number; height: number };
      original?: { source: string; width: number; height: number };
      extract?: string;
    }>;

    // Sort by search index
    entries.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));

    for (const page of entries) {
      const thumb = page.thumbnail?.source;
      const original = page.original?.source || thumb;
      if (!thumb && !original) continue;

      results.push({
        id: `wiki-${page.pageid}`,
        title: page.title,
        thumbnailUrl: thumb || original!,
        originalUrl: original || thumb!,
        extract: page.extract ? stripHtml(page.extract) : undefined,
        source: 'wikipedia',
        pageUrl: `https://${safeLang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        width: page.thumbnail?.width,
        height: page.thumbnail?.height,
      });
    }

    if (results.length === 0 && safeLang !== 'en') {
      return searchWikipediaImages(cleanQuery, 'en', limit, signal);
    }

    return results;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Attempt English fallback on network/language error if not English
    if (safeLang !== 'en') {
      try {
        return await searchWikipediaImages(cleanQuery, 'en', limit, signal);
      } catch {
        return [];
      }
    }
    return [];
  }
}

/**
 * Searches Wikimedia Commons directly for high-resolution photographs, portraits,
 * paintings and media associated with the query.
 */
export async function searchWikimediaCommons(
  query: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<ImageSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(
    cleanQuery,
  )}&gsrlimit=${limit}&gsrnamespace=6&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=500`;

  try {
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Wikimedia Commons request failed: ${res.status}`);
    const data = await res.json();

    const pages = data?.query?.pages;
    if (!pages) return [];

    const results: ImageSearchResult[] = [];
    const entries = Object.values(pages) as Array<{
      pageid: number;
      title: string;
      index?: number;
      imageinfo?: Array<{
        thumburl?: string;
        url?: string;
        thumbwidth?: number;
        thumbheight?: number;
        descriptionurl?: string;
        extmetadata?: {
          ImageDescription?: { value: string };
          ObjectName?: { value: string };
          Artist?: { value: string };
        };
      }>;
    }>;

    entries.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));

    for (const page of entries) {
      const info = page.imageinfo?.[0];
      if (!info) continue;

      const thumb = info.thumburl || info.url;
      const original = info.url || thumb;
      if (!thumb && !original) continue;

      // Clean readable title from "File:Name_of_Person.jpg"
      const cleanTitle = page.title
        .replace(/^File:/i, '')
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim();

      const rawDescription =
        info.extmetadata?.ImageDescription?.value || info.extmetadata?.ObjectName?.value;
      const extract = rawDescription ? stripHtml(rawDescription) : undefined;

      results.push({
        id: `commons-${page.pageid}`,
        title: cleanTitle,
        thumbnailUrl: thumb!,
        originalUrl: original!,
        extract: extract && extract.length > 200 ? `${extract.slice(0, 197)}...` : extract,
        source: 'wikimedia',
        pageUrl: info.descriptionurl,
        width: info.thumbwidth,
        height: info.thumbheight,
      });
    }

    return results;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return [];
  }
}

/**
 * Combined search querying Wikipedia and Wikimedia Commons in parallel,
 * prioritizing Wikipedia biographical results first, followed by Commons images.
 */
export async function searchPersonImages(
  query: string,
  lang = 'es',
  signal?: AbortSignal,
): Promise<ImageSearchResult[]> {
  const [wikiResults, commonsResults] = await Promise.allSettled([
    searchWikipediaImages(query, lang, 8, signal),
    searchWikimediaCommons(query, 10, signal),
  ]);

  const wiki = wikiResults.status === 'fulfilled' ? wikiResults.value : [];
  const commons = commonsResults.status === 'fulfilled' ? commonsResults.value : [];

  // Filter out any duplicate URLs
  const seenUrls = new Set<string>();
  const combined: ImageSearchResult[] = [];

  for (const item of [...wiki, ...commons]) {
    const urlKey = item.thumbnailUrl.split('?')[0] ?? item.thumbnailUrl;
    if (!seenUrls.has(urlKey)) {
      seenUrls.add(urlKey);
      combined.push(item);
    }
  }

  return combined;
}
