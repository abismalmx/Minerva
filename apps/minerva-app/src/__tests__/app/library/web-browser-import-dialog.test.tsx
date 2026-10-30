import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WebBrowserImportDialog from '@/app/library/components/WebBrowserImportDialog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) => {
    if (!options) return key;
    return key.replace(/{{(\w+)}}/g, (_match, name) => String(options[name] ?? ''));
  },
}));

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({
    title,
    children,
    onClose,
  }: {
    title?: string;
    children: React.ReactNode;
    onClose: () => void;
  }) => (
    <div role='dialog' aria-label={title}>
      <h2>{title}</h2>
      <button type='button' aria-label='close-dialog' onClick={onClose} />
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('WebBrowserImportDialog', () => {
  it('names the file that was downloaded', () => {
    render(
      <WebBrowserImportDialog
        download={{
          url: 'https://example.com/dune.epub',
          path: '/cache/dune.epub',
          filename: 'dune.epub',
          success: true,
        }}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Add to my library' })).toBeTruthy();
    expect(screen.getByText('File downloaded: dune.epub')).toBeTruthy();
  });

  it('confirms the import when the reader accepts the file', () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <WebBrowserImportDialog
        download={{
          url: 'https://example.com/dune.epub',
          path: '/cache/dune.epub',
          filename: 'dune.epub',
          success: true,
        }}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add to my library' }));

    expect(onConfirm).toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('leaves the file out of the library when the reader cancels', () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <WebBrowserImportDialog
        download={{
          url: 'https://example.com/dune.epub',
          path: '/cache/dune.epub',
          filename: 'dune.epub',
          success: true,
        }}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByText('Cancel'));

    expect(onDismiss).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
