import type { AppService } from '@/types/system';
import type { Hlc } from '@/types/replica';
import type { CursorStore } from './replicaSyncManager';

export interface SettingsCursorStoreOpts {
  /** Debounce window for the load-merge-save flush. Defaults to 1s. */
  debounceMs?: number;
  /** Test seam — defaults to the platform setTimeout. */
  setTimeoutFn?: typeof setTimeout;
  /** Test seam. */
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Production CursorStore backed by appService.loadSettings + saveSettings.
 *
 * Cursors are cached in memory so get() is sync. set() debounces a save
 * that does a fresh load-merge-save round-trip — this keeps us from
 * clobbering fields written elsewhere in the same session (e.g., the
 * library page's setSettings).
 *
 * Cursor advance is best-effort: a lost save just means the next pull
 * re-fetches a few rows. We never block the sync flow on disk IO.
 */
export const createSettingsCursorStore = (
  appService: AppService,
  opts: SettingsCursorStoreOpts = {},
): CursorStore => {
  const cache = new Map<string, Hlc>();
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  const debounceMs = opts.debounceMs ?? 1000;
  let pending: ReturnType<typeof setTimeout> | null = null;
  /**
   * Keys written by `set()` since the store was created.
   *
   * The initial load is asynchronous, so a `set()` can land before it
   * resolves. The loaded value is then the OLDER one (it was on disk before
   * the caller's write), and letting it into the cache would silently revert
   * the cursor — and persist the revert on the next flush. Keys listed here
   * are owned by the caller: the load must not overwrite them.
   */
  const locallySet = new Set<string>();

  void (async () => {
    try {
      const settings = await appService.loadSettings();
      for (const [k, v] of Object.entries(settings.lastSyncedAtReplicas ?? {})) {
        // A cursor written locally is newer than what was on disk.
        if (locallySet.has(k)) continue;
        cache.set(k, v as Hlc);
      }
    } catch (err) {
      console.warn('replica cursor hydrate failed', err);
    }
  })();

  const flush = async () => {
    try {
      const settings = await appService.loadSettings();
      // MERGE with what is on disk, do not replace it. The cache only holds
      // the kinds this session has touched; replacing the whole map would
      // delete the cursors of the other kinds when the initial load failed
      // (the cache is then empty) — and the next pull would re-fetch every
      // row of those kinds.
      settings.lastSyncedAtReplicas = {
        ...(settings.lastSyncedAtReplicas ?? {}),
        ...Object.fromEntries(cache),
      };
      await appService.saveSettings(settings);
    } catch (err) {
      console.warn('replica cursor save failed', err);
    }
  };

  const scheduleFlush = () => {
    if (pending !== null) clearTimeoutFn(pending);
    pending = setTimeoutFn(() => {
      pending = null;
      void flush();
    }, debounceMs);
  };

  return {
    get: (kind) => cache.get(kind) ?? null,
    set: (kind, hlc) => {
      cache.set(kind, hlc);
      locallySet.add(kind);
      scheduleFlush();
    },
  };
};
