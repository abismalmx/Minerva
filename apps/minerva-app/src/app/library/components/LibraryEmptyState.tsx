import * as React from 'react';
import clsx from 'clsx';
import { PiBooks } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { navigateToLogin } from '@/utils/nav';
import LibraryImportButton from './LibraryImportButton';

interface LibraryEmptyStateProps {
  onImport: (anchor: HTMLElement) => void;
}

/**
 * The empty library.
 *
 * An empty shelf is not an error, it is the first page of the product: it
 * says what Minerva is for and offers the one action that fills it. The
 * emblem sits on a halftone plate — the print motif of the identity — so the
 * screen already looks like a cover rather than like a placeholder.
 */
const LibraryEmptyState: React.FC<LibraryEmptyStateProps> = ({ onImport }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const router = useAppRouter();
  const isMobile = appService?.isMobile ?? false;

  return (
    <div className='hero-content text-base-content relative flex w-full flex-col items-center text-center'>
      <div className='relative mb-8 flex size-28 items-center justify-center'>
        {/* The print motif: a halftone plate behind the emblem. */}
        <div
          className='minerva-halftone bg-base-200/60 absolute inset-0 rounded-full'
          aria-hidden='true'
        />
        <PiBooks aria-hidden className='text-primary relative size-11' />
      </div>
      <h1 className='font-display mb-4 max-w-md text-balance text-4xl leading-tight font-medium tracking-tight sm:text-5xl'>
        {_('Start your library')}
      </h1>
      <p className='text-base-content/70 mb-8 max-w-sm text-pretty text-base leading-relaxed'>
        {isMobile
          ? _('Pick a book from your device to add it to your library.')
          : _('Drop a book anywhere on this window, or pick one from your computer.')}
      </p>
      <div className='flex w-full max-w-xs flex-col gap-3'>
        <LibraryImportButton onImport={onImport} primary />
        {/* TODO: add a 'Browse free catalogs' secondary action that opens the
            OPDS dialog (handleShowOPDSDialog) once we settle on placement. */}
        {!user && (
          <button
            type='button'
            className={clsx(
              'text-base-content/70 hover:text-base-content mt-1 py-2 text-sm font-medium',
              'underline underline-offset-4',
              'focus-visible:text-base-content focus-visible:outline-hidden',
            )}
            onClick={() => navigateToLogin(router)}
          >
            {_('Sign in to sync your library')}
          </button>
        )}
      </div>
    </div>
  );
};

export default LibraryEmptyState;
