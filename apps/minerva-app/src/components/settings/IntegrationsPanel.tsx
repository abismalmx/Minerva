import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdChevronRight } from 'react-icons/md';
import { RiCloudLine } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useSettingsStore } from '@/store/settingsStore';
import { getCustomBackendUrl } from '@/services/environment';
import CloudflareAssistantForm from './integrations/CloudflareAssistantForm';
import { PanelHeader, SectionTitle, SettingLabel } from './primitives';

type SubPage = 'minerva-cloud' | null;

/**
 * Integrations panel — the single entry point for Minerva's own sync
 * backend (a self-hosted Cloudflare Worker, deployed by the user).
 *
 * Every third-party integration (KOReader, BookOrbit, Readwise, Hardcover,
 * Pagebound, Notion, WebDAV, Google Drive, S3, OneDrive, iCloud, Minerva
 * Cloud, OPDS, Audiobookshelf, Send to Minerva, Nearby BookDrop, Discord
 * presence) has been removed from this panel: the fork ships one sync
 * path, and it is the user's own Cloudflare deployment. The underlying
 * sync engines still live in `src/services/sync/` — only their settings
 * UI is gone, so an account configured before the removal keeps syncing.
 *
 * Pattern: boxed list of NavigationRows. Each row pushes the panel into an
 * inline sub-page (with breadcrumb back-navigation matching the Dictionaries
 * pattern) — no nested modals.
 */
const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();
  const { requestedSubPage, setRequestedSubPage } = useSettingsStore();
  const [subPage, setSubPage] = useState<SubPage>(null);

  // Deep-link consumption: when a caller sets `requestedSubPage` in the store
  // before opening the dialog, drill straight into that sub-page on mount and
  // clear the request so it doesn't stick to the next open. Only Minerva
  // Cloud (Cloudflare) has a sub-page left; any other (stale) request is
  // consumed and ignored so the panel always opens on its list.
  useEffect(() => {
    if (!requestedSubPage) return;
    if (requestedSubPage === 'minerva-cloud') {
      setSubPage('minerva-cloud');
    }
    setRequestedSubPage(null);
  }, [requestedSubPage, setRequestedSubPage]);

  // Android Back / Esc: when the Minerva Cloud sub-page is open, intercept
  // and step back to the integrations list instead of letting <Dialog>'s
  // listener close the whole Settings dialog. The hook registers its
  // sync `native-key-down` listener *after* <Dialog>'s, and
  // `dispatchSync` walks listeners LIFO — so this one claims Back first
  // when enabled and `return true` consumes the event. When subPage is
  // null the hook is disabled and Back falls through to close the dialog
  // as before.
  useKeyDownActions({
    enabled: subPage !== null,
    onCancel: () => setSubPage(null),
  });

  // Sub-page wrapper matches the list-view's `my-4 w-full` so the
  // SubPageHeader's "Integrations" label lands at the exact same Y position
  // as the list-view's h2 — clicking a row reads as a navigation morph
  // rather than a layout shift.
  if (subPage === 'minerva-cloud')
    return <CloudflareAssistantForm onBack={() => setSubPage(null)} />;

  const customBackendUrl = getCustomBackendUrl();
  const minervaCloudStatus = customBackendUrl
    ? _('Conectado a {{url}}', { url: customBackendUrl.replace(/^https?:\/\//, '') })
    : _('Auto-hosting en Cloudflare');

  return (
    <div className='my-4 w-full space-y-6'>
      <PanelHeader
        title={_('Integrations')}
        description={_('Connect Minerva to external services for sync, highlights, and catalogs.')}
      />

      <div className='w-full' data-setting-id='settings.integrations.cloudSync'>
        <SectionTitle className='mb-2'>{_('Cloud Sync')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div
            className='divide-base-200 divide-y'
            role='group'
            aria-label={_('Cloud sync providers')}
          >
            <IntegrationRow
              icon={RiCloudLine}
              title={_('Minerva Cloud (Cloudflare)')}
              status={minervaCloudStatus}
              onClick={() => setSubPage('minerva-cloud')}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

interface IntegrationRowProps {
  icon: React.ElementType;
  title: string;
  status: string;
  onClick: () => void;
}

const IntegrationRow: React.FC<IntegrationRowProps> = ({ icon: Icon, title, status, onClick }) => {
  return (
    <button
      type='button'
      onClick={onClick}
      className={clsx(
        'group flex w-full items-center gap-3 px-4 py-3 text-left',
        'transition-colors duration-150',
        'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset',
      )}
    >
      <span
        className={clsx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          'bg-base-200 text-base-content/70',
          'transition-colors duration-150',
          'group-hover:bg-base-300/70',
        )}
      >
        <Icon className='h-5 w-5' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <SettingLabel>{title}</SettingLabel>
        <span className='text-base-content/65 truncate text-[0.85em]'>{status}</span>
      </div>
      <MdChevronRight className='text-base-content/50 h-5 w-5 shrink-0' />
    </button>
  );
};

export default IntegrationsPanel;
