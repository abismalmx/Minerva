import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Minerva fork ships exactly one integration: the user's own Cloudflare
 * backend (Minerva Cloud). Every third-party provider that used to live in
 * Settings → Integrations is gone from the panel, and this test pins that:
 * a removed provider may not creep back in, and Minerva Cloud (Cloudflare)
 * must keep working — the row, its status line, the sub-page, and the
 * deep-link that opens that sub-page directly.
 */

const state = vi.hoisted(() => ({
  backendUrl: null as string | null,
  requestedSubPage: null as string | null,
  setRequestedSubPage: undefined as unknown as (subPage: string | null) => void,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isDesktopApp: true } }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? '')),
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  getCustomBackendUrl: () => state.backendUrl,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    requestedSubPage: state.requestedSubPage,
    setRequestedSubPage: (subPage: string | null) => {
      state.requestedSubPage = subPage;
      state.setRequestedSubPage(subPage);
    },
  }),
}));

import IntegrationsPanel from '@/components/settings/IntegrationsPanel';

/** Every provider that used to be offered by this panel. */
const REMOVED_ENTRIES = [
  // Local Network
  'Nearby BookDrop',
  // Reading Sync
  'KOReader',
  'BookOrbit',
  'Readwise',
  'Hardcover',
  'Pagebound',
  'Notion',
  // Cloud Sync (account-based Minerva Cloud + third-party providers)
  'Minerva Cloud',
  'Google Drive',
  'WebDAV',
  'S3 Storage',
  'OneDrive',
  'iCloud',
  // Content Sources
  'OPDS Catalogs',
  'Audiobookshelf',
  'Send to Minerva',
  // Discord
  'Show on Discord',
];

const REMOVED_SECTIONS = ['Local Network', 'Reading Sync', 'Content Sources', 'Discord'];

beforeEach(() => {
  state.backendUrl = null;
  state.requestedSubPage = null;
  state.setRequestedSubPage = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IntegrationsPanel — Minerva Cloud (Cloudflare) only', () => {
  it('offers Minerva Cloud (Cloudflare) as the single integration', () => {
    render(<IntegrationsPanel />);
    expect(screen.getByRole('button', { name: /Minerva Cloud \(Cloudflare\)/ })).toBeTruthy();
    expect(screen.getByText('Cloud Sync')).toBeTruthy();
  });

  it('lists no other integration', () => {
    render(<IntegrationsPanel />);
    for (const entry of REMOVED_ENTRIES) {
      expect(screen.queryByText(entry), `"${entry}" must not be listed`).toBeNull();
    }
    for (const section of REMOVED_SECTIONS) {
      expect(screen.queryByText(section), `"${section}" section must be gone`).toBeNull();
    }
  });

  it('reports the auto-hosting status while no backend URL is configured', () => {
    render(<IntegrationsPanel />);
    expect(screen.getByText('Auto-hosting en Cloudflare')).toBeTruthy();
  });

  it('reports the configured self-hosted backend URL', () => {
    state.backendUrl = 'https://minerva-cloudflare.example.workers.dev';
    render(<IntegrationsPanel />);
    expect(screen.getByText('Conectado a minerva-cloudflare.example.workers.dev')).toBeTruthy();
  });

  it('opens the Cloudflare assistant sub-page and comes back to the list', () => {
    render(<IntegrationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Minerva Cloud \(Cloudflare\)/ }));
    // The assistant owns the deploy + connect flow.
    expect(screen.getByText('1. Despliegue All-in-One en Cloudflare')).toBeTruthy();
    expect(screen.getByText('2. Conectar tu Servidor')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }));
    expect(screen.getByRole('button', { name: /Minerva Cloud \(Cloudflare\)/ })).toBeTruthy();
  });

  it('honours a Minerva Cloud deep link', () => {
    state.requestedSubPage = 'minerva-cloud';
    render(<IntegrationsPanel />);
    expect(screen.getByText('1. Despliegue All-in-One en Cloudflare')).toBeTruthy();
    expect(state.setRequestedSubPage).toHaveBeenCalledWith(null);
  });

  it('ignores and clears a deep link for a removed integration', () => {
    state.requestedSubPage = 'webdav';
    render(<IntegrationsPanel />);
    expect(screen.queryByText('1. Despliegue All-in-One en Cloudflare')).toBeNull();
    expect(screen.getByRole('button', { name: /Minerva Cloud \(Cloudflare\)/ })).toBeTruthy();
    expect(state.setRequestedSubPage).toHaveBeenCalledWith(null);
  });
});
