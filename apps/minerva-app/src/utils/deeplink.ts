import { MINERVA_WEB_BASE_URL } from '@/services/constants';

export type AnnotationDeepLink = {
  bookHash: string;
  noteId: string;
  cfi?: string;
};

/**
 * Which form of annotation link markdown export embeds: the custom-scheme
 * `minerva://` app deeplink or the universal `https://` web link.
 */
export type AnnotationLinkType = 'app' | 'web';

const ANNOTATION_PATH_PREFIX = '/o/book/';

/**
 * Shared minerva:// / https://web.minerva.invalid URL parsing: validates the
 * scheme and returns a uniform path-segment list, or null if neither
 * matches. Pass `allowWebHost: false` for links only ever sent natively
 * (widget group taps).
 */
const parseMinervaUrl = (
  url: string,
  { allowWebHost = true }: { allowWebHost?: boolean } = {},
): { segments: string[]; searchParams: URLSearchParams } | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  let segments: string[];

  if (parsed.protocol === 'minerva:') {
    // minerva:// URLs park their first path segment in `host`, not pathname.
    segments = [parsed.host, ...parsed.pathname.split('/')].filter(Boolean);
  } else if (
    allowWebHost &&
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
    parsed.host === 'web.minerva.invalid'
  ) {
    segments = parsed.pathname.split('/').filter(Boolean);

    // The HTTPS landing page is prefixed with /o/; strip it for uniform parsing.
    if (segments[0] !== 'o') return null;
    segments.shift();
  } else {
    return null;
  }

  return { segments, searchParams: parsed.searchParams };
};

/**
 * Build the canonical HTTPS URL for an annotation. Used in markdown export
 * and Readwise sync. Mobile App Links (web.minerva.invalid) intercept this URL
 * and open the native app; on desktop browsers it resolves to the smart
 * landing page at /o/book/{hash}/annotation/{id}.
 */
export const buildAnnotationWebUrl = ({ bookHash, noteId, cfi }: AnnotationDeepLink): string => {
  const base = `${MINERVA_WEB_BASE_URL}${ANNOTATION_PATH_PREFIX}${bookHash}/annotation/${noteId}`;
  return cfi ? `${base}?cfi=${encodeURIComponent(cfi)}` : base;
};

/**
 * Build the custom-scheme URL. Kept as a parallel form for share-sheet flows
 * and direct deeplink scenarios. Markdown export uses the HTTPS form.
 */
export const buildAnnotationAppUrl = ({ bookHash, noteId, cfi }: AnnotationDeepLink): string => {
  const base = `minerva://book/${bookHash}/annotation/${noteId}`;
  return cfi ? `${base}?cfi=${encodeURIComponent(cfi)}` : base;
};

/**
 * Build the annotation link for the requested {@link AnnotationLinkType}.
 * `app` yields the custom-scheme deeplink; `web` yields the universal HTTPS form.
 */
export const buildAnnotationUrl = (
  link: AnnotationDeepLink,
  linkType: AnnotationLinkType,
): string => (linkType === 'app' ? buildAnnotationAppUrl(link) : buildAnnotationWebUrl(link));

/**
 * Parse an incoming minerva:// or https://web.minerva.invalid annotation URL.
 * Accepts the new hierarchical form (book/{hash}/annotation/{id}) and the
 * legacy flat form (annotation/{hash}/{id}) emitted by older Readwise syncs.
 * Returns null if the URL doesn't match.
 */
export const parseAnnotationDeepLink = (url: string): AnnotationDeepLink | null => {
  const parsed = parseMinervaUrl(url);
  if (!parsed) return null;
  const { segments, searchParams } = parsed;

  const cfiParam = searchParams.get('cfi');
  const cfi = cfiParam ? cfiParam : undefined;

  // Hierarchical: book/{hash}/annotation/{id}
  if (segments.length === 4 && segments[0] === 'book' && segments[2] === 'annotation') {
    return { bookHash: segments[1]!, noteId: segments[3]!, cfi };
  }

  // Legacy flat: annotation/{hash}/{id}
  if (segments.length === 3 && segments[0] === 'annotation') {
    return { bookHash: segments[1]!, noteId: segments[2]!, cfi };
  }

  return null;
};

/**
 * Parse an incoming minerva:// or https://web.minerva.invalid book-open URL.
 * Matches only the bare form `book/{hash}` (the widget tap target); the
 * 4-segment annotation form `book/{hash}/annotation/{id}` is handled by
 * parseAnnotationDeepLink and must NOT match here.
 */
export const parseBookDeepLink = (url: string): { bookHash: string; autoplay?: boolean } | null => {
  const parsed = parseMinervaUrl(url);
  if (!parsed) return null;
  const { segments, searchParams } = parsed;

  if (segments.length === 2 && segments[0] === 'book' && segments[1]) {
    // `?autoplay=tts` is appended by the Android Auto cold-resume launch to ask
    // the reader to start read-aloud once the book is open. Only surface the
    // flag when set so the common shape stays `{ bookHash }`.
    if (searchParams.get('autoplay') === 'tts') {
      return { bookHash: segments[1], autoplay: true };
    }
    return { bookHash: segments[1] };
  }
  return null;
};

/**
 * Parse a CrossPoint reader sign-in link: `https://web.minerva.invalid/link?code=…`
 * (from the Minerva card on the reader's web Settings page) or
 * `minerva://link?code=…` (from the web /link page). The code may be empty.
 */
export const parseDeviceLinkDeepLink = (url: string): { code: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  const isAppLink = parsed.protocol === 'minerva:' && parsed.host === 'link' && path === '';
  const isWebLink =
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
    parsed.host === 'web.minerva.invalid' &&
    path === '/link';
  if (!isAppLink && !isWebLink) return null;
  return { code: parsed.searchParams.get('code') ?? '' };
};

/**
 * Parse an incoming `minerva://widget-group/{groupBy}/{groupId}` deep link (a
 * "browse groups" tile tap), where `groupId` is the group's Library id.
 */
export const parseWidgetGroupDeepLink = (
  url: string,
): { groupBy: string; groupId: string } | null => {
  const parsed = parseMinervaUrl(url, { allowWebHost: false });
  if (!parsed) return null;
  const { segments } = parsed;
  if (segments.length === 3 && segments[0] === 'widget-group' && segments[1] && segments[2]) {
    try {
      return { groupBy: segments[1], groupId: decodeURIComponent(segments[2]) };
    } catch {
      // Malformed percent-encoding: reject the link like any other bad input.
      return null;
    }
  }
  return null;
};

/**
 * Parse an incoming `minerva://widget-edit-shelf/{shelfId}` deep link (the
 * configure dialog's "Edit bookshelf" button), where `shelfId` is the
 * currently-selected shelf's id.
 */
export const parseWidgetEditShelfDeepLink = (url: string): { shelfId: string } | null => {
  const parsed = parseMinervaUrl(url, { allowWebHost: false });
  if (!parsed) return null;
  const { segments } = parsed;
  if (segments.length === 2 && segments[0] === 'widget-edit-shelf' && segments[1]) {
    try {
      return { shelfId: decodeURIComponent(segments[1]) };
    } catch {
      // Malformed percent-encoding: reject the link like any other bad input.
      return null;
    }
  }
  return null;
};
