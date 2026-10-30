import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/utils/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/access')>();
  return {
    ...actual,
    isCloudSyncAllowed: vi.fn(actual.isCloudSyncAllowed),
  };
});

import {
  applySyncBooksAutoEnable,
  cloudProviderDisplayName,
  cloudProvidersDisplayName,
  getActiveFileSyncBackends,
  getCloudSyncProviders,
  getEnabledFileSyncBackends,
  isMinervaCloudEnabled,
  isMinervaCloudStorageActive,
  resolveCloudSyncGate,
  setCachedCustomizationPurchased,
  setCachedUserPlan,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';
import { isCloudSyncAllowed } from '@/utils/access';

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    webdav: { enabled: false },
    googleDrive: { enabled: false },
    ...overrides,
  }) as SystemSettings;

const s = (partial: Partial<SystemSettings>): SystemSettings => partial as SystemSettings;

beforeEach(() => {
  vi.mocked(isCloudSyncAllowed).mockReturnValue(true);
  setCachedUserPlan('free');
});

describe('resolveCloudSyncGate', () => {
  test('minerva is never paused, even when cloud sync is disallowed', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    expect(resolveCloudSyncGate(makeSettings(), 'free')).toEqual({
      minerva: true,
      backends: [],
      paused: false,
    });
  });

  test('third-party provider stays enabled but paused when disallowed (no silent minerva fallback)', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(resolveCloudSyncGate(settings, 'free')).toEqual({
      minerva: false,
      backends: ['webdav'],
      paused: true,
    });
  });

  test('third-party provider is active when allowed', () => {
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(resolveCloudSyncGate(settings, 'plus')).toEqual({
      minerva: false,
      backends: ['gdrive'],
      paused: false,
    });
  });

  test('falls back to the cached user plan when no plan argument is given', () => {
    vi.mocked(isCloudSyncAllowed).mockImplementation((plan) => plan !== 'free');
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);

    setCachedUserPlan('free');
    expect(resolveCloudSyncGate(settings).paused).toBe(true);

    setCachedUserPlan('pro');
    expect(resolveCloudSyncGate(settings).paused).toBe(false);
  });

  test('undefined cached plan is treated as free', () => {
    vi.mocked(isCloudSyncAllowed).mockImplementation((plan) => plan !== 'free');
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    setCachedUserPlan(undefined);
    expect(resolveCloudSyncGate(settings).paused).toBe(true);
  });
});

describe('applySyncBooksAutoEnable (upgrade migration for already-enabled providers)', () => {
  test('flips syncBooks on for an enabled webdav provider, mutating the given settings', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.webdav?.syncBooks).toBe(true);
  });

  test('flips syncBooks on for an enabled gdrive provider', () => {
    const settings = makeSettings({
      googleDrive: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.googleDrive?.syncBooks).toBe(true);
  });

  test('no-op when minerva is the provider', () => {
    const settings = makeSettings();
    expect(applySyncBooksAutoEnable(settings)).toBe(false);
    expect(settings.webdav?.syncBooks).toBeUndefined();
  });

  test('no-op when syncBooks is already on', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: true },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(false);
  });

  test('flips syncBooks on for every enabled provider when multiple are enabled', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: false },
      googleDrive: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.webdav?.syncBooks).toBe(true);
    expect(settings.googleDrive?.syncBooks).toBe(true);
  });
});

describe('isMinervaCloudStorageActive', () => {
  test('true when minerva is the derived provider', () => {
    expect(isMinervaCloudStorageActive(makeSettings())).toBe(true);
  });

  test('false when a third-party provider is selected', () => {
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(isMinervaCloudStorageActive(settings)).toBe(false);
  });

  test('false while paused: uploads must not silently resume to Minerva Cloud', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(isMinervaCloudStorageActive(settings, 'free')).toBe(false);
  });
});

describe('settingsKeyForBackend', () => {
  test('maps each backend kind to its settings slice', () => {
    expect(settingsKeyForBackend('webdav')).toBe('webdav');
    expect(settingsKeyForBackend('gdrive')).toBe('googleDrive');
    expect(settingsKeyForBackend('s3')).toBe('s3');
    expect(settingsKeyForBackend('onedrive')).toBe('onedrive');
  });
});

describe('cloudProviderDisplayName', () => {
  test('names every provider kind', () => {
    expect(cloudProviderDisplayName('webdav')).toBe('WebDAV');
    expect(cloudProviderDisplayName('gdrive')).toBe('Google Drive');
    expect(cloudProviderDisplayName('s3')).toBe('S3');
    expect(cloudProviderDisplayName('onedrive')).toBe('OneDrive');
    expect(cloudProviderDisplayName('minerva')).toBe('Minerva Cloud');
  });
});

// Moved from src/__tests__/services/sync/file/providerRegistry.test.ts: the
// function itself moved from providerRegistry.ts into this module.
describe('getEnabledFileSyncBackends', () => {
  test('lists only switched-on backends in a stable order', () => {
    expect(getEnabledFileSyncBackends(s({}))).toEqual([]);
    expect(getEnabledFileSyncBackends(s({ webdav: { enabled: true } } as never))).toEqual([
      'webdav',
    ]);
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: true }, googleDrive: { enabled: true } } as never),
      ),
    ).toEqual(['webdav', 'gdrive']);
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: false }, googleDrive: { enabled: true } } as never),
      ),
    ).toEqual(['gdrive']);
  });

  test("getEnabledFileSyncBackends includes 'onedrive' when enabled", () => {
    expect(getEnabledFileSyncBackends(s({ onedrive: { enabled: true } } as never))).toContain(
      'onedrive',
    );
  });
});

describe('isMinervaCloudEnabled (derived default)', () => {
  test('absent field with no third-party enabled means Minerva Cloud is on', () => {
    expect(isMinervaCloudEnabled(s({}))).toBe(true);
  });

  test('absent field with a third-party enabled means Minerva Cloud is off (legacy exclusive)', () => {
    expect(isMinervaCloudEnabled(s({ googleDrive: { enabled: true } as never }))).toBe(false);
  });

  test('explicit true wins over an enabled third-party provider', () => {
    const settings = s({
      googleDrive: { enabled: true } as never,
      minervaCloud: { enabled: true },
    });
    expect(isMinervaCloudEnabled(settings)).toBe(true);
  });

  test('explicit false wins when nothing else is enabled', () => {
    expect(isMinervaCloudEnabled(s({ minervaCloud: { enabled: false } }))).toBe(false);
  });
});

describe('getCloudSyncProviders', () => {
  test('returns minerva alone by default', () => {
    expect(getCloudSyncProviders(s({}))).toEqual(['minerva']);
  });

  test('returns minerva plus every enabled backend in fixed order', () => {
    const settings = s({
      minervaCloud: { enabled: true },
      onedrive: { enabled: true } as never,
      webdav: { enabled: true } as never,
    });
    expect(getCloudSyncProviders(settings)).toEqual(['minerva', 'webdav', 'onedrive']);
  });

  test('returns an empty list when everything is off', () => {
    expect(getCloudSyncProviders(s({ minervaCloud: { enabled: false } }))).toEqual([]);
  });
});

describe('resolveCloudSyncGate (minerva + backends together)', () => {
  test('reports minerva and backends together', () => {
    const settings = s({
      minervaCloud: { enabled: true },
      googleDrive: { enabled: true } as never,
    });
    const gate = resolveCloudSyncGate(settings, 'pro');
    expect(gate).toEqual({ minerva: true, backends: ['gdrive'], paused: false });
  });

  test('pauses every backend at once on a plan without cloud sync', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    const settings = s({
      minervaCloud: { enabled: true },
      googleDrive: { enabled: true } as never,
      webdav: { enabled: true } as never,
    });
    const gate = resolveCloudSyncGate(settings, 'free');
    // Minerva Cloud keeps running because the user asked for it, not as a fallback.
    expect(gate.minerva).toBe(true);
    expect(gate.backends).toEqual(['webdav', 'gdrive']);
    expect(gate.paused).toBe(true);
    expect(getActiveFileSyncBackends(settings, 'free')).toEqual([]);
  });
});

describe('isMinervaCloudStorageActive (follows the flag, not exclusivity)', () => {
  test('follows the Minerva Cloud flag, not the absence of third-party providers', () => {
    const both = s({ minervaCloud: { enabled: true }, webdav: { enabled: true } as never });
    expect(isMinervaCloudStorageActive(both)).toBe(true);
    const off = s({ minervaCloud: { enabled: false }, webdav: { enabled: true } as never });
    expect(isMinervaCloudStorageActive(off)).toBe(false);
  });
});

describe('cloudProvidersDisplayName', () => {
  test('joins provider names for the "synced via" copy', () => {
    expect(cloudProvidersDisplayName(['minerva', 'gdrive'])).toBe('Minerva Cloud, Google Drive');
  });
});

describe('icloud backend kind', () => {
  test('getEnabledFileSyncBackends appends icloud last', () => {
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: true }, icloud: { enabled: true } } as never),
      ),
    ).toEqual(['webdav', 'icloud']);
  });

  test('settingsKeyForBackend maps icloud to its own slice', () => {
    expect(settingsKeyForBackend('icloud')).toBe('icloud');
  });

  test('cloudProviderDisplayName names iCloud', () => {
    expect(cloudProviderDisplayName('icloud')).toBe('iCloud');
  });

  test('applySyncBooksAutoEnable flips syncBooks on for an enabled icloud', () => {
    const settings = s({ icloud: { enabled: true, syncBooks: false } } as never);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.icloud?.syncBooks).toBe(true);
  });
});

// The cache is read synchronously by non-React gates, so a signed-out session
// must not keep the previous account's entitlement. `useQuotaStats` clears it
// on logout; this pins the wiring that clear depends on.
describe('resolveCloudSyncGate — cached customization entitlement', () => {
  const webdavOn = () => makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);

  test('passes the cached unlock through to the gate', () => {
    setCachedCustomizationPurchased(true);
    resolveCloudSyncGate(webdavOn(), 'free');
    expect(isCloudSyncAllowed).toHaveBeenCalledWith('free', true);
  });

  test('passes false once the cache is cleared on sign-out', () => {
    setCachedCustomizationPurchased(true);
    setCachedCustomizationPurchased(false);
    resolveCloudSyncGate(webdavOn(), 'free');
    expect(isCloudSyncAllowed).toHaveBeenCalledWith('free', false);
  });
});
