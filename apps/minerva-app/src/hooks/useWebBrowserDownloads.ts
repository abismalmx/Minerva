import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform } from '@/services/environment';
import { ingestFile } from '@/services/ingestService';
import {
  extractWebBrowserArchive,
  isBookArchiveDownload,
  isSupportedBookDownload,
  setWebBrowserStatus,
  subscribeWebBrowserDownloads,
  type WebBrowserDownload,
} from '@/services/webBrowser/webBrowser';
import { eventDispatcher } from '@/utils/event';
import { useTranslation } from './useTranslation';

export interface WebBrowserDownloads {
  /** The download waiting for the user to accept it into the library. */
  pending: WebBrowserDownload | null;
  /** Add the pending download to the library. */
  confirm: () => Promise<void>;
  /** Leave the pending download out of the library. */
  dismiss: () => Promise<void>;
}

/**
 * Imports files downloaded inside the in-app web browser (#5775) and
 * mirrors the outcome into the browser's chrome. Mount once in the
 * library page, next to `useClipUrlIngress`.
 *
 * A file the page downloaded is not a file the reader chose: it lands in the
 * library, and from there in the user's own sync, without asking. So the
 * download waits for an explicit confirmation before anything is imported.
 */
export function useWebBrowserDownloads(): WebBrowserDownloads {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  // Downloads queue up: a page can trigger several before the user answers
  // the first one, and none of them may be dropped.
  const [queue, setQueue] = useState<WebBrowserDownload[]>([]);
  const pending = queue[0] ?? null;

  const importDownload = useCallback(
    async (download: WebBrowserDownload) => {
      if (!appService) return;
      const { filename } = download;
      await setWebBrowserStatus({ state: 'importing', filename });
      try {
        const { settings } = useSettingsStore.getState();
        const groupId = searchParams?.get('group') || undefined;
        const groupName = groupId
          ? useLibraryStore.getState().library.find((b) => b.groupId === groupId)?.groupName
          : undefined;
        const extracted = isBookArchiveDownload(filename)
          ? await extractWebBrowserArchive(download.path)
          : [];
        for (const file of extracted.length ? extracted : [download.path]) {
          const { library } = useLibraryStore.getState();
          const book = await ingestFile(
            { file, books: library, groupId, groupName },
            { appService, settings, isLoggedIn: !!user },
          );
          if (!book) throw new Error(_('Import produced no book'));
          await useLibraryStore.getState().updateBooks(envConfig, [book]);
          await setWebBrowserStatus({ state: 'added', filename, bookHash: book.hash });
          eventDispatcher.dispatch('toast', {
            type: 'success',
            message: _('Saved “{{title}}” to your library.', { title: book.title || filename }),
            timeout: 3000,
          });
        }
      } catch (err) {
        await setWebBrowserStatus({ state: 'failed', filename });
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: err instanceof Error ? err.message : _('Import failed'),
          timeout: 3500,
        });
      }
    },
    [appService, envConfig, user, searchParams, _],
  );

  const handleDownload = useCallback(
    async (download: WebBrowserDownload) => {
      if (!appService) return;
      const { filename } = download;
      if (!download.success) {
        await setWebBrowserStatus({ state: 'failed', filename });
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: download.error || _('Download failed'),
          timeout: 3500,
        });
        return;
      }
      if (!isSupportedBookDownload(filename)) {
        await setWebBrowserStatus({ state: 'unsupported', filename });
        return;
      }
      // The chrome shows the download as under way until the reader accepts
      // it; nothing is imported before that.
      setQueue((current) => [...current, download]);
      await setWebBrowserStatus({ state: 'importing', filename });
    },
    [appService, _],
  );

  const confirm = useCallback(async () => {
    const download = queue[0];
    if (!download) return;
    setQueue((current) => current.slice(1));
    await importDownload(download);
  }, [queue, importDownload]);

  const dismiss = useCallback(async () => {
    const download = queue[0];
    if (!download) return;
    setQueue((current) => current.slice(1));
    await setWebBrowserStatus({ state: 'cancelled', filename: download.filename });
  }, [queue]);

  // Register once per appService; dispatch to the latest handler.
  const handlerRef = useRef(handleDownload);
  handlerRef.current = handleDownload;

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    subscribeWebBrowserDownloads(!!appService.isMobileApp, (download) => {
      void handlerRef.current(download);
    })
      .then((fn) => {
        if (cancelled) fn();
        else dispose = fn;
      })
      .catch((err) => {
        // Without the listener, downloads would never reach the library. This is a
        // rare internal failure; log it and avoid an unhandled promise rejection.
        console.warn('[browser] failed to subscribe to web browser downloads', err);
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [appService]);

  return { pending, confirm, dismiss };
}
