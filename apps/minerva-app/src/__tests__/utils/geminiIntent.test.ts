import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';

const openUrl = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => openUrl(...args),
}));

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  addPluginListener: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ listen: vi.fn() }),
}));

import {
  GEMINI_ANDROID_PACKAGE,
  GEMINI_COMPANION_TITLE,
  GEMINI_WEB_URL,
  buildGeminiAndroidIntentUrl,
  buildGeminiQuery,
  buildGeminiWebUrl,
  dispatchGeminiHandoff,
  isAndroidRuntime,
  openGeminiInAppBrowser,
  openInGeminiApp,
} from '@/app/reader/utils/geminiIntent';

describe('buildGeminiQuery', () => {
  test('pairs the instruction with the quoted selection', () => {
    const query = buildGeminiQuery('It was the best of times.', 'explain', 'Explain this:');
    expect(query).toBe('Explain this:\n\n"It was the best of times."');
  });

  test('falls back to the built-in instruction for the action', () => {
    const query = buildGeminiQuery('passage', 'character');
    expect(query).toContain('character');
    expect(query).toContain('"passage"');
  });

  test('returns an empty query for an empty selection', () => {
    expect(buildGeminiQuery('   ', 'explain')).toBe('');
  });
});

describe('buildGeminiWebUrl', () => {
  test('encodes the prompt into the query parameter', () => {
    const url = buildGeminiWebUrl('explain "a b"');
    expect(url.startsWith(`${GEMINI_WEB_URL}?q=`)).toBe(true);
    expect(url).toContain(encodeURIComponent('explain "a b"'));
  });
});

describe('buildGeminiAndroidIntentUrl', () => {
  test('targets the Gemini package with a SEND action', () => {
    const url = buildGeminiAndroidIntentUrl('hello');
    expect(url.startsWith('intent://send?text=')).toBe(true);
    expect(url).toContain(`package=${GEMINI_ANDROID_PACKAGE}`);
    expect(url).toContain('action=android.intent.action.SEND');
    expect(url).toContain('type=text/plain');
    expect(url.endsWith(';end')).toBe(true);
  });

  test('carries the platform’s own browser fallback when one is given', () => {
    const url = buildGeminiAndroidIntentUrl('hello', 'https://gemini.google.com/app?q=hello');
    expect(url).toContain('S.browser_fallback_url=');
    expect(url).toContain(encodeURIComponent('https://gemini.google.com/app?q=hello'));
  });
});

describe('isAndroidRuntime', () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  test('detects Android from the user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
      configurable: true,
    });
    expect(isAndroidRuntime()).toBe(true);
  });

  test('reports false on a desktop user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      configurable: true,
    });
    expect(isAndroidRuntime()).toBe(false);
  });
});

describe('openInGeminiApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns null when there is nothing to send', () => {
    expect(openInGeminiApp('   ', 'explain')).toBeNull();
  });

  test('opens the web app on a non-Android platform', () => {
    const outcome = openInGeminiApp('a passage', 'explain', { isAndroid: false });

    expect(outcome?.target).toBe('web');
    expect(outcome?.url.startsWith(`${GEMINI_WEB_URL}?q=`)).toBe(true);
  });

  test('builds the Android intent on Android', () => {
    const outcome = openInGeminiApp('a passage', 'explain', { isAndroid: true });

    expect(outcome?.target).toBe('android');
    expect(outcome?.url.startsWith('intent://send?text=')).toBe(true);
    expect(outcome?.fallbackUrl.startsWith(`${GEMINI_WEB_URL}?q=`)).toBe(true);
  });

  test('passes the translated instruction through to the query', () => {
    const outcome = openInGeminiApp('a passage', 'context', {
      isAndroid: false,
      instruction: 'Contexte historique :',
    });

    expect(decodeURIComponent(outcome?.url ?? '')).toContain('Contexte historique :');
  });
});

describe('openGeminiInAppBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue({});
  });

  test('returns null when there is nothing to send', async () => {
    expect(await openGeminiInAppBrowser('   ', 'explain', { isTauri: true })).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test('opens the Gemini web app in the in-app browser on Tauri', async () => {
    const outcome = await openGeminiInAppBrowser('a passage', 'explain', {
      isTauri: true,
      instruction: 'Explain this:',
    });

    expect(outcome?.target).toBe('in-app');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, payload] = invokeMock.mock.calls[0] as [
      string,
      { url: string; options: { companion?: { title?: string } } },
    ];
    expect(command).toBe('open_web_browser');
    expect(payload.url.startsWith(`${GEMINI_WEB_URL}?q=`)).toBe(true);
    expect(decodeURIComponent(payload.url)).toContain('Explain this:');
    expect(payload.options.companion?.title).toBe(GEMINI_COMPANION_TITLE);
  });

  test('falls back to the system browser on the web', async () => {
    const outcome = await openGeminiInAppBrowser('a passage', 'explain', { isTauri: false });

    expect(outcome?.target).toBe('web');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('dispatchGeminiHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('routes the in-app mode to the in-app browser', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    const outcome = await dispatchGeminiHandoff('a passage', 'explain', {
      mode: 'in-app-browser',
    });

    expect(outcome?.target).toBe('in-app');
    expect(invokeMock).toHaveBeenCalledWith(
      'open_web_browser',
      expect.objectContaining({
        options: expect.objectContaining({
          companion: expect.objectContaining({ title: GEMINI_COMPANION_TITLE }),
        }),
      }),
    );
  });

  test('routes the external mode to the operating system', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    const outcome = await dispatchGeminiHandoff('a passage', 'explain', {
      mode: 'external-app',
    });

    expect(outcome?.target).toBe('web');
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(String(openUrl.mock.calls[0]?.[0])).toContain(GEMINI_WEB_URL);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
