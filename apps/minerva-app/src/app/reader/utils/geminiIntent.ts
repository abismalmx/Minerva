import { isTauriAppPlatform } from '@/services/environment';
import { openExternalUrl } from '@/utils/open';
import { openWebBrowser } from '@/services/webBrowser/webBrowser';
import { getWebBrowserOptions } from '@/services/webBrowser/webBrowserOptions';
import type { GeminiHandoffMode } from '@/services/ai/types';
import { stubTranslation as _ } from '@/utils/misc';

/**
 * Handing the selection to the official Gemini app (BACKEND_SPEC_2 §2.4).
 *
 * Three surfaces are supported:
 *
 * - **Android**: an `intent://` URL that targets the Gemini app by package
 *   and pre-fills the prompt with the selection. When no app is installed the
 *   intent carries `S.browser_fallback_url`, so the OS opens the web app
 *   instead of showing an "no activity found" page.
 * - **Desktop / web**: the Gemini web app in a new tab (or the system
 *   browser under Tauri, where an in-app `window.open` would replace the
 *   reader itself).
 * - **In-app browser**: the Gemini web app inside Minerva's own webview —
 *   a native browser sheet on mobile, a companion window next to the reader
 *   on desktop — so the reader never leaves the app and the Google session
 *   lives in the webview's cookie jar. See {@link openGeminiInAppBrowser}.
 */
export type GeminiHandoffAction = 'explain' | 'context' | 'character' | 'ask';

export const GEMINI_WEB_URL = 'https://gemini.google.com/app';
export const GEMINI_ANDROID_PACKAGE = 'com.google.android.apps.bard';
/** Where a reader gets a free Gemini key (Google AI Studio). */
export const GEMINI_API_STUDIO_URL = 'https://aistudio.google.com/apikey';
/**
 * Title of the companion window that carries the Gemini web app on desktop.
 *
 * The window is a companion to the book, not a book source, so the page
 * title ("Google") never replaces it.
 */
export const GEMINI_COMPANION_TITLE = 'Gemini Companion';

/**
 * The instruction sent along with the selection.
 *
 * These are translation keys: the reader's UI language is the best proxy for
 * the language the user wants the answer in, so the React layer translates
 * them with `_()` before they reach {@link buildGeminiQuery}.
 */
export const GEMINI_HANDOFF_INSTRUCTIONS: Record<GeminiHandoffAction, string> = {
  explain: _('Please explain and contextualize the following passage from the book:'),
  context: _('Please give the historical and literary context of the following passage:'),
  character: _('Please tell me who this character is and what they want in this scene:'),
  ask: _('Please discuss the following passage with me:'),
};

export interface GeminiHandoffOptions {
  /**
   * Force the Android path. Defaults to runtime detection; the parameter
   * exists so the behaviour is testable and so a host that knows better
   * (a Capacitor container, a kiosk build) can force it.
   */
  isAndroid?: boolean;
  /** Translated instruction; falls back to the built-in English one. */
  instruction?: string;
}

export interface GeminiHandoffOutcome {
  /** Which surface the handoff targeted. */
  target: 'android' | 'web' | 'in-app';
  /** The URL that was handed to the OS. */
  url: string;
  /** The URL used when the Android intent finds no matching app. */
  fallbackUrl: string;
}

/**
 * Whether the app runs on Android.
 *
 * The Android System WebView is the only signal the renderer has, so the user
 * agent decides. A Capacitor-style container is checked first because it
 * knows its own platform even when the user agent is masked.
 */
export const isAndroidRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  const capacitor = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }
  ).Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    return (capacitor.getPlatform?.() ?? '').toLowerCase() === 'android';
  }
  return /android/i.test(navigator.userAgent);
};

/** Build the prompt that carries the selection over to Gemini. */
export function buildGeminiQuery(
  selectedText: string,
  action: GeminiHandoffAction = 'explain',
  instruction?: string,
): string {
  const text = (selectedText ?? '').trim();
  if (!text) return '';
  const lead = (instruction ?? GEMINI_HANDOFF_INSTRUCTIONS[action] ?? '').trim();
  return lead ? `${lead}\n\n"${text}"` : `"${text}"`;
}

/** The Gemini web app URL for a prepared prompt. */
export function buildGeminiWebUrl(query: string): string {
  return `${GEMINI_WEB_URL}?q=${encodeURIComponent(query)}`;
}

/**
 * The Android intent that opens the Gemini app with the prompt pre-filled.
 *
 * `S.browser_fallback_url` is the platform's own fallback: when the intent
 * resolves to no installed activity, the system opens that URL instead of
 * showing an error.
 */
export function buildGeminiAndroidIntentUrl(query: string, fallbackUrl?: string): string {
  const base = `intent://send?text=${encodeURIComponent(query)}#Intent;package=${GEMINI_ANDROID_PACKAGE};action=android.intent.action.SEND;type=text/plain`;
  if (!fallbackUrl) return `${base};end`;
  return `${base};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
}

/**
 * Hand the selection to the official Gemini app.
 *
 * Returns the outcome so the caller can report what happened; `null` when
 * there was nothing to send.
 */
export function openInGeminiApp(
  selectedText: string,
  action: GeminiHandoffAction = 'explain',
  options: GeminiHandoffOptions = {},
): GeminiHandoffOutcome | null {
  const query = buildGeminiQuery(selectedText, action, options.instruction);
  if (!query) return null;

  const webUrl = buildGeminiWebUrl(query);
  const isAndroid = options.isAndroid ?? isAndroidRuntime();

  if (!isAndroid) {
    openExternalUrl(webUrl);
    return { target: 'web', url: webUrl, fallbackUrl: webUrl };
  }

  const intentUrl = buildGeminiAndroidIntentUrl(query, webUrl);

  if (isTauriAppPlatform()) {
    // The Tauri Android build resolves `https://gemini.google.com` as an
    // App Link: the Gemini app takes the URL when it is installed and the
    // system browser takes it when it is not. That is the same outcome the
    // explicit package intent produces, without the "no activity found"
    // dead end — and it does not fight Tauri's navigation handler, which
    // intercepts the webview's own navigations.
    openExternalUrl(webUrl);
    return { target: 'android', url: webUrl, fallbackUrl: intentUrl };
  }

  // Plain Android WebView (the Capacitor-style container): navigate to the
  // intent so the OS resolves it. `S.browser_fallback_url` covers the
  // "Gemini is not installed" case, and the visibility watchdog below covers
  // the containers that ignore that parameter.
  openAndroidIntent(intentUrl, webUrl);
  return { target: 'android', url: intentUrl, fallbackUrl: webUrl };
}

/**
 * Whether the app renders in e-ink mode; the native browser chrome adapts
 * to it (no shadows, crisp borders).
 */
const isEinkTheme = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.dataset['eink'] === 'true';

export interface GeminiInAppOptions {
  /**
   * Force the Tauri path. Defaults to runtime detection; the parameter
   * exists so the behaviour is testable.
   */
  isTauri?: boolean;
  /** Translated instruction; falls back to the built-in English one. */
  instruction?: string;
  /**
   * Translator for the in-app browser's chrome labels. The native chrome
   * has no i18n of its own, so the reader's language decides the labels.
   */
  translate?: (key: string) => string;
  /** E-ink mode: the chrome drops shadows and draws crisp borders. */
  isEink?: boolean;
}

/**
 * Open the official Gemini app inside Minerva's own webview.
 *
 * On the native builds this is the in-app browser: a full-screen sheet on
 * mobile, a companion window docked next to the reader on desktop. The
 * Google session lives in the webview's own cookie jar, so the reader signs
 * in once and every later hand-off is already authenticated. The web build
 * has no such runtime, so the URL opens in a new tab instead.
 *
 * Returns the outcome so the caller can report what happened; `null` when
 * there was nothing to send.
 */
export async function openGeminiInAppBrowser(
  selectedText: string,
  action: GeminiHandoffAction = 'explain',
  options: GeminiInAppOptions = {},
): Promise<GeminiHandoffOutcome | null> {
  const query = buildGeminiQuery(selectedText, action, options.instruction);
  if (!query) return null;

  const url = buildGeminiWebUrl(query);
  if (!(options.isTauri ?? isTauriAppPlatform())) {
    openExternalUrl(url);
    return { target: 'web', url, fallbackUrl: url };
  }

  const translate = options.translate ?? ((key: string) => key);
  const browserOptions = getWebBrowserOptions(translate, options.isEink ?? isEinkTheme(), {
    title: GEMINI_COMPANION_TITLE,
  });
  await openWebBrowser(url, browserOptions);
  return { target: 'in-app', url, fallbackUrl: url };
}

export interface GeminiDispatchOptions {
  /** The surface the reader chose in the AI settings. */
  mode: GeminiHandoffMode;
  /** Translated instruction; falls back to the built-in English one. */
  instruction?: string;
  /** Translator for the in-app browser's chrome labels. */
  translate?: (key: string) => string;
  /** E-ink mode; detected from the document when omitted. */
  isEink?: boolean;
}

/**
 * Hand the selection to Gemini in the surface the reader chose: inside
 * Minerva's own webview or in the operating system's browser.
 *
 * The web build has no in-app browser, so the in-app mode falls back to a
 * new tab there — the same place the external mode always goes.
 */
export async function dispatchGeminiHandoff(
  selectedText: string,
  action: GeminiHandoffAction,
  options: GeminiDispatchOptions,
): Promise<GeminiHandoffOutcome | null> {
  if (options.mode === 'in-app-browser') {
    return openGeminiInAppBrowser(selectedText, action, {
      instruction: options.instruction,
      translate: options.translate,
      isEink: options.isEink,
    });
  }
  return openInGeminiApp(selectedText, action, { instruction: options.instruction });
}

/**
 * Navigate to an `intent://` URL and fall back to `fallbackUrl` when nothing
 * handled it.
 *
 * The watchdog keys off the document's visibility: when the intent launches
 * the Gemini app, the webview is backgrounded (`visibilitychange` → hidden)
 * and the timer is cleared. When no app matched, the webview stays visible
 * and the fallback URL is opened instead.
 */
const openAndroidIntent = (intentUrl: string, fallbackUrl: string): void => {
  if (typeof window === 'undefined') return;
  let handled = false;
  const timer = window.setTimeout(() => {
    if (handled) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    openExternalUrl(fallbackUrl);
  }, 1500);

  const onVisibilityChange = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
    handled = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  try {
    window.location.href = intentUrl;
  } catch {
    window.clearTimeout(timer);
    openExternalUrl(fallbackUrl);
  }
};
