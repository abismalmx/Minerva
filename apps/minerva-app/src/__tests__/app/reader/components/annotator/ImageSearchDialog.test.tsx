import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ImageSearchDialog } from '@/app/reader/components/annotator/ImageSearchDialog';
import * as imageSearchService from '@/services/imageSearch/imageSearchService';

vi.mock('@/components/Dialog', () => ({
  default: ({
    isOpen,
    children,
    header,
    onClose,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    header?: React.ReactNode;
    onClose?: () => void;
  }) =>
    isOpen ? (
      <div data-testid='dialog'>
        <button data-testid='dialog-close' onClick={onClose}>
          Close
        </button>
        <div data-testid='dialog-header'>{header}</div>
        <div data-testid='dialog-body'>{children}</div>
      </div>
    ) : null,
}));

describe('ImageSearchDialog', () => {
  const mockOnSelectImage = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders search input with initial query and triggers search on open', async () => {
    const mockSearch = vi.spyOn(imageSearchService, 'searchPersonImages').mockResolvedValue([
      {
        id: 'wiki-1',
        title: 'Napoleón Bonaparte',
        thumbnailUrl: 'https://example.com/napoleon_thumb.jpg',
        originalUrl: 'https://example.com/napoleon_orig.jpg',
        extract: 'Militar y estadista francés.',
        source: 'wikipedia',
      },
    ]);

    render(
      <ImageSearchDialog
        isOpen={true}
        initialQuery='Napoleón'
        onSelectImage={mockOnSelectImage}
        onClose={mockOnClose}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Napoleón');

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith(
        'Napoleón',
        expect.any(String),
        expect.any(AbortSignal),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText('Napoleón Bonaparte')).not.toBeNull();
      expect(screen.queryByText('Militar y estadista francés.')).not.toBeNull();
    });
  });

  it('selects an image card and confirms selection with extract', async () => {
    vi.spyOn(imageSearchService, 'searchPersonImages').mockResolvedValue([
      {
        id: 'wiki-1',
        title: 'Marie Curie',
        thumbnailUrl: 'https://example.com/curie_thumb.jpg',
        originalUrl: 'https://example.com/curie_orig.jpg',
        extract: 'Física y química polaca-francesa.',
        source: 'wikipedia',
      },
    ]);

    render(
      <ImageSearchDialog
        isOpen={true}
        initialQuery='Marie Curie'
        onSelectImage={mockOnSelectImage}
        onClose={mockOnClose}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText('Marie Curie')).not.toBeNull();
    });

    // Clicking the Select button on the card
    const selectButtons = screen.getAllByRole('button', { name: /select/i });
    const selectButton = selectButtons[selectButtons.length - 1];
    expect(selectButton).toBeDefined();
    fireEvent.click(selectButton!);

    expect(mockOnSelectImage).toHaveBeenCalledWith({
      title: 'Marie Curie',
      url: 'https://example.com/curie_orig.jpg',
      extract: 'Física y química polaca-francesa.',
      includeExtract: true,
    });
  });

  it('supports custom URL submission', async () => {
    vi.spyOn(imageSearchService, 'searchPersonImages').mockResolvedValue([]);

    render(
      <ImageSearchDialog
        isOpen={true}
        initialQuery='Custom Character'
        onSelectImage={mockOnSelectImage}
        onClose={mockOnClose}
      />,
    );

    // Switch to URL tab (SegmentedControl button with role radio)
    const urlTab = screen.getByRole('radio', { name: /URL/i });
    fireEvent.click(urlTab);

    // Enter custom image URL
    const urlInput = screen.getByPlaceholderText('https://example.com/photo.jpg');
    fireEvent.change(urlInput, { target: { value: 'https://custom.org/image.png' } });

    // Submit custom image
    const attachBtn = screen.getByRole('button', { name: /attach image/i });
    fireEvent.click(attachBtn);

    expect(mockOnSelectImage).toHaveBeenCalledWith({
      title: 'Custom Character',
      url: 'https://custom.org/image.png',
      includeExtract: false,
    });
  });
});
