'use client';

import React from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { WebBrowserDownload } from '@/services/webBrowser/webBrowser';

interface WebBrowserImportDialogProps {
  download: WebBrowserDownload | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

/**
 * Asks before a file downloaded inside the in-app web browser joins the
 * library.
 *
 * The page chose that file, not the reader: importing it silently would put
 * a book the user never asked for in their library, and from there in their
 * own sync, behind a browser they were only reading in.
 */
const WebBrowserImportDialog: React.FC<WebBrowserImportDialogProps> = ({
  download,
  onConfirm,
  onDismiss,
}) => {
  const _ = useTranslation();

  return (
    <Dialog
      isOpen={!!download}
      onClose={onDismiss}
      title={_('Add to my library')}
      boxClassName='sm:w-[420px]! sm:max-w-[420px]! sm:h-auto! sm:max-h-[80vh]!'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('File downloaded: {{title}}', { title: download?.filename ?? '' })}
        </p>
        <div className='flex justify-end gap-2 pt-1'>
          <button type='button' className='btn btn-ghost btn-sm eink-bordered' onClick={onDismiss}>
            {_('Cancel')}
          </button>
          <button type='button' className='btn btn-contrast btn-sm' onClick={onConfirm}>
            {_('Add to my library')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default WebBrowserImportDialog;
