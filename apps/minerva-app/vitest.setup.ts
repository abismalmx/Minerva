// jsdom does not implement the CSS namespace; foliate-js TTS uses CSS.escape
// (mark[name="…"] lookups). Provide the standard polyfill so those paths work.
const globalWithCSS = globalThis as { CSS?: { escape?: (value: string) => string } };
if (!globalWithCSS.CSS) globalWithCSS.CSS = {};
if (typeof globalWithCSS.CSS.escape !== 'function') {
  globalWithCSS.CSS.escape = (value: string): string => {
    const string = String(value);
    const length = string.length;
    const firstCodeUnit = string.charCodeAt(0);
    let result = '';
    let index = -1;
    while (++index < length) {
      const codeUnit = string.charCodeAt(index);
      if (codeUnit === 0x0000) {
        result += '�';
      } else if (
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
      ) {
        result += '\\' + codeUnit.toString(16) + ' ';
      } else if (index === 0 && length === 1 && codeUnit === 0x002d) {
        result += '\\' + string.charAt(index);
      } else if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        result += string.charAt(index);
      } else {
        result += '\\' + string.charAt(index);
      }
    }
    return result;
  };
}

// In the jsdom environment `Blob` is jsdom's implementation while `Response` is
// Node's (undici). `Response.blob()` therefore hands back an undici Blob, and
// jsdom's `new Blob([blob])` does not recognize a foreign Blob: it falls back to
// stringifying it, so the bytes become the literal text "[object Blob]".
// zip.js builds and reads every archive through `new Response(...).blob()` (its
// BlobWriter), so each ZIP-backed test saw corrupted bytes. Wrap `blob()` so
// the result is built with this environment's own `Blob`.
if (typeof Response !== 'undefined' && typeof Blob !== 'undefined') {
  const originalBlob = Response.prototype.blob;
  Response.prototype.blob = async function (this: Response) {
    const blob = await originalBlob.call(this);
    if (blob instanceof Blob) return blob;
    return new Blob([await blob.arrayBuffer()], { type: blob.type });
  };
}

// matchMedia mock
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom reports these unimplemented methods to its virtual console even when
// the calling test passes. Tests that need media behavior replace them locally.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
}

// jsdom implements layout-less `getClientRects` only on elements. ProseMirror
// asks text nodes and ranges for their rects when it scrolls the selection into view, so
// the text node and range variants are stubbed with an empty list.
const emptyDOMRect = () => ({
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => {},
});
if (typeof Node !== 'undefined') {
  if (!Node.prototype.getClientRects) {
    const emptyRects = () =>
      Object.assign([], {
        item: () => null,
        [Symbol.iterator]: function* () {},
      });
    Node.prototype.getClientRects = emptyRects;
  }
  if (!(Node.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect) {
    (Node.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
      emptyDOMRect as unknown as () => DOMRect;
  }
}
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      Object.assign([], {
        item: () => null,
        [Symbol.iterator]: function* () {},
      });
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = emptyDOMRect as unknown as () => DOMRect;
  }
}

// Unit tests never reach the Minerva Voice API: a controller built for a
// signed-out reader would otherwise fetch the voice catalog over the network.
// Tests that exercise the request spy on fetch themselves.
if (typeof globalThis.fetch === 'function') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    String(input instanceof Request ? input.url : input).includes('/tts/minerva')
      ? Promise.resolve(Response.json({ error: 'NOT_CONFIGURED' }, { status: 503 }))
      : realFetch(input, init);
}

// `isTauriAppPlatform()` requires the Tauri runtime globals on top of
// NEXT_PUBLIC_APP_PLATFORM=tauri. Unit tests only stub the env var, so expose
// the marker the real webview injects; it is inert unless a test opts into the
// tauri platform via the env var.
if (typeof window !== 'undefined') {
  const tauriWindow = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (!tauriWindow.__TAURI_INTERNALS__) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
      writable: true,
    });
  }
}
