/**
 * Options handed to `open_web_browser` so the native / injected chrome
 * matches Minerva's theme and UI language. Native code has no i18n: every
 * label it renders comes from here. Each `_()` call is a literal so the
 * i18next scanner extracts it (same pattern as `send/clipOptions.ts`).
 */

import { getThemeCode } from '@/utils/style';

type Translate = (key: string) => string;

export type WebBrowserLabelKey =
  | 'close'
  | 'clipPage'
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'menu'
  | 'openInBrowser'
  | 'copyLink'
  | 'signOut'
  | 'notSecure'
  | 'downloading'
  | 'importing'
  | 'added'
  | 'failed'
  | 'unsupported'
  | 'cancelled'
  | 'open';

export interface WebBrowserCompanionOptions {
  /** Title of the companion window; the page title does not replace it. */
  title?: string;
  /** Preferred width of the companion panel, in logical pixels. */
  width?: number;
}

export interface WebBrowserOptions {
  /** `#rrggbb` — theme base-100. */
  background: string;
  /** `#rrggbb` — theme base-content. */
  foreground: string;
  isEink: boolean;
  labels: Record<WebBrowserLabelKey, string>;
  /**
   * Companion mode: a secondary window docked next to the reader instead of
   * a centred book-source browser. Set for third-party web apps (Gemini),
   * where the page is a companion to the book rather than a book source.
   */
  companion?: WebBrowserCompanionOptions;
}

export function getWebBrowserOptions(
  _: Translate,
  isEink: boolean,
  companion?: WebBrowserCompanionOptions,
): WebBrowserOptions {
  const { bg, fg } = getThemeCode();
  return {
    background: bg,
    foreground: fg,
    isEink,
    ...(companion ? { companion } : {}),
    labels: {
      close: _('Close'),
      clipPage: _('Clip Page'),
      back: _('Back'),
      forward: _('Forward'),
      reload: _('Reload'),
      stop: _('Stop'),
      menu: _('More'),
      openInBrowser: _('Open in Browser'),
      copyLink: _('Copy Link'),
      signOut: _('Sign out of this site'),
      notSecure: _('Not secure'),
      downloading: _('Downloading'),
      importing: _('Importing'),
      added: _('Added to library'),
      failed: _('Import failed'),
      unsupported: _('Not a supported book format'),
      cancelled: _('Cancelled'),
      open: _('Open'),
    },
  };
}
