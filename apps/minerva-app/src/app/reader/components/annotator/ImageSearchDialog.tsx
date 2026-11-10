'use client';

import clsx from 'clsx';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FiSearch, FiX, FiImage, FiExternalLink, FiCheck } from 'react-icons/fi';
import Dialog from '@/components/Dialog';
import SegmentedControl from '@/components/SegmentedControl';
import { useTranslation } from '@/hooks/useTranslation';
import {
  ImageSearchResult,
  searchPersonImages,
  searchWikipediaImages,
  searchWikimediaCommons,
} from '@/services/imageSearch/imageSearchService';

export interface SelectedImageData {
  title: string;
  url: string;
  extract?: string;
  includeExtract?: boolean;
}

interface ImageSearchDialogProps {
  isOpen: boolean;
  initialQuery: string;
  bookLanguage?: string;
  onSelectImage: (data: SelectedImageData) => void;
  onClose: () => void;
}

type SearchSource = 'all' | 'wikipedia' | 'commons' | 'custom';

export const ImageSearchDialog: React.FC<ImageSearchDialogProps> = ({
  isOpen,
  initialQuery,
  bookLanguage,
  onSelectImage,
  onClose,
}) => {
  const _ = useTranslation();
  const [query, setQuery] = useState(initialQuery.trim());
  const [source, setSource] = useState<SearchSource>('all');
  const [lang, setLang] = useState(() => {
    if (bookLanguage && /^[a-z]{2}/i.test(bookLanguage)) {
      return bookLanguage.slice(0, 2).toLowerCase();
    }
    return 'es';
  });
  const [results, setResults] = useState<ImageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Selected item pending confirmation or custom url
  const [previewItem, setPreviewItem] = useState<ImageSearchResult | null>(null);
  const [includeExtract, setIncludeExtract] = useState(true);

  // Custom URL inputs
  const [customUrl, setCustomUrl] = useState('');
  const [customTitle, setCustomTitle] = useState(initialQuery.trim());
  const [customImageValid, setCustomImageValid] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const executeSearch = useCallback(
    async (searchQuery: string, searchSource: SearchSource, searchLang: string) => {
      const q = searchQuery.trim();
      if (!q) {
        setResults([]);
        setLoading(false);
        return;
      }

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setLoading(true);
      setError(null);
      setHasSearched(true);
      setPreviewItem(null);

      try {
        let items: ImageSearchResult[] = [];
        if (searchSource === 'all') {
          items = await searchPersonImages(q, searchLang, abortController.signal);
        } else if (searchSource === 'wikipedia') {
          items = await searchWikipediaImages(q, searchLang, 12, abortController.signal);
        } else if (searchSource === 'commons') {
          items = await searchWikimediaCommons(q, 15, abortController.signal);
        }
        setResults(items);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(_('Failed to search images. Please check your internet connection.'));
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [_],
  );

  // Trigger search on mount or when dialog opens
  useEffect(() => {
    if (isOpen) {
      const cleanInitial = initialQuery.trim();
      setQuery(cleanInitial);
      setCustomTitle(cleanInitial);
      setPreviewItem(null);
      if (cleanInitial) {
        void executeSearch(cleanInitial, source, lang);
      }
    } else {
      abortControllerRef.current?.abort();
    }
  }, [isOpen, initialQuery, executeSearch, source, lang]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (source === 'custom') return;
    void executeSearch(query, source, lang);
  };

  const handleSourceChange = (newSource: SearchSource) => {
    setSource(newSource);
    setPreviewItem(null);
    if (newSource !== 'custom' && query.trim()) {
      void executeSearch(query, newSource, lang);
    }
  };

  const handleConfirmSelect = (item: ImageSearchResult) => {
    onSelectImage({
      title: item.title,
      url: item.originalUrl || item.thumbnailUrl,
      extract: includeExtract ? item.extract : undefined,
      includeExtract,
    });
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;
    onSelectImage({
      title: customTitle.trim() || _('Image'),
      url: customUrl.trim(),
      includeExtract: false,
    });
  };

  const sourceOptions = [
    { value: 'all' as SearchSource, label: _('All') },
    { value: 'wikipedia' as SearchSource, label: 'Wikipedia' },
    { value: 'commons' as SearchSource, label: 'Commons' },
    { value: 'custom' as SearchSource, label: _('URL') },
  ];

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      snapHeight={0.85}
      dismissible
      header={
        <div className='flex w-full flex-col gap-2 pt-1 pb-2 sm:pt-0'>
          <div className='flex items-center justify-between'>
            <h3 className='text-base-content flex items-center gap-2 font-semibold text-lg'>
              <FiImage className='text-primary' size={20} />
              {_('Search Image / Photo')}
            </h3>
            <div className='flex items-center gap-2'>
              {source !== 'custom' && (
                <select
                  value={lang}
                  onChange={(e) => {
                    const nextLang = e.target.value;
                    setLang(nextLang);
                    if (query.trim()) void executeSearch(query, source, nextLang);
                  }}
                  className='select select-bordered select-sm min-h-9 text-xs'
                  aria-label={_('Language')}
                >
                  <option value='es'>Español</option>
                  <option value='en'>English</option>
                  <option value='fr'>Français</option>
                  <option value='de'>Deutsch</option>
                  <option value='it'>Italiano</option>
                  <option value='pt'>Português</option>
                </select>
              )}
            </div>
          </div>

          <div className='flex flex-wrap items-center justify-between gap-2'>
            <SegmentedControl<SearchSource>
              options={sourceOptions}
              value={source}
              onChange={handleSourceChange}
              size='sm'
              itemClassName='min-h-9'
            />
          </div>

          {source !== 'custom' ? (
            <form onSubmit={handleSearchSubmit} className='relative mt-1 flex w-full items-center'>
              <input
                type='text'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={_('Search person, character, place...')}
                className='input input-bordered input-sm min-h-9 text-base-content w-full pr-16 pl-9'
                autoFocus
              />
              <FiSearch
                className='text-base-content/50 pointer-events-none absolute left-3'
                size={16}
              />
              {query && (
                <button
                  type='button'
                  onClick={() => setQuery('')}
                  className='btn btn-ghost btn-xs min-h-9 min-w-9 text-base-content/50 hover:text-base-content absolute right-10'
                  aria-label={_('Clear')}
                >
                  <FiX size={14} />
                </button>
              )}
              <button
                type='submit'
                disabled={loading || !query.trim()}
                className='btn btn-primary btn-xs min-h-9 absolute right-1.5'
              >
                {_('Search')}
              </button>
            </form>
          ) : null}
        </div>
      }
      boxClassName='max-w-2xl'
      contentClassName='p-3 sm:p-4'
    >
      {/* Custom URL mode */}
      {source === 'custom' ? (
        <form onSubmit={handleCustomSubmit} className='flex flex-col gap-4 py-2'>
          <div className='form-control w-full'>
            <label className='label py-1'>
              <span className='label-text font-medium text-xs sm:text-sm'>{_('Image URL')}</span>
            </label>
            <input
              type='url'
              value={customUrl}
              onChange={(e) => {
                setCustomUrl(e.target.value);
                setCustomImageValid(false);
              }}
              placeholder='https://example.com/photo.jpg'
              className='input input-bordered input-sm w-full'
              required
              autoFocus
            />
          </div>

          <div className='form-control w-full'>
            <label className='label py-1'>
              <span className='label-text font-medium text-xs sm:text-sm'>{_('Title / Name')}</span>
            </label>
            <input
              type='text'
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder={_('Name of the person')}
              className='input input-bordered input-sm w-full'
            />
          </div>

          {customUrl && (
            <div className='border-base-300 bg-base-200 flex flex-col items-center justify-center rounded-lg border p-3'>
              <span className='text-base-content/70 mb-2 text-xs'>{_('Preview')}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={customUrl}
                alt={customTitle || 'Preview'}
                onLoad={() => setCustomImageValid(true)}
                onError={() => setCustomImageValid(false)}
                className='max-h-56 max-w-full rounded-md object-contain shadow-sm'
              />
              {!customImageValid && (
                <span className='text-warning mt-1 text-xs'>
                  {_('Could not load image preview. Check that the link is direct.')}
                </span>
              )}
            </div>
          )}

          <div className='mt-2 flex justify-end gap-2'>
            <button type='button' onClick={onClose} className='btn btn-ghost btn-sm'>
              {_('Cancel')}
            </button>
            <button type='submit' disabled={!customUrl.trim()} className='btn btn-primary btn-sm'>
              <FiCheck size={16} />
              {_('Attach Image')}
            </button>
          </div>
        </form>
      ) : (
        /* Search results mode */
        <div className='flex flex-col gap-3'>
          {/* Item details confirmation overlay/panel */}
          {previewItem && (
            <div className='border-primary/40 bg-base-200/90 mb-3 flex flex-col rounded-lg border p-3 shadow-md sm:flex-row sm:gap-4'>
              <div className='flex shrink-0 justify-center sm:justify-start'>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewItem.thumbnailUrl}
                  alt={previewItem.title}
                  className='h-36 w-32 rounded-md object-cover shadow-sm'
                />
              </div>
              <div className='mt-2 flex min-w-0 flex-1 flex-col justify-between sm:mt-0'>
                <div>
                  <div className='flex items-start justify-between gap-2'>
                    <h4 className='text-base-content font-bold text-sm sm:text-base'>
                      {previewItem.title}
                    </h4>
                    {previewItem.pageUrl && (
                      <a
                        href={previewItem.pageUrl}
                        target='_blank'
                        rel='noreferrer'
                        className='text-primary hover:text-primary-focus p-1'
                        title={_('Open source in browser')}
                      >
                        <FiExternalLink size={16} />
                      </a>
                    )}
                  </div>
                  {previewItem.extract && (
                    <p className='text-base-content/80 mt-1 text-xs leading-relaxed'>
                      {previewItem.extract}
                    </p>
                  )}
                </div>

                <div className='mt-3 flex flex-wrap items-center justify-between gap-2 pt-2'>
                  {previewItem.extract ? (
                    <label className='flex cursor-pointer items-center gap-2'>
                      <input
                        type='checkbox'
                        checked={includeExtract}
                        onChange={(e) => setIncludeExtract(e.target.checked)}
                        className='checkbox checkbox-primary checkbox-xs'
                      />
                      <span className='text-base-content/80 text-xs'>
                        {_('Include biographical summary in note')}
                      </span>
                    </label>
                  ) : (
                    <span />
                  )}
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={() => setPreviewItem(null)}
                      className='btn btn-ghost btn-xs'
                    >
                      {_('Cancel')}
                    </button>
                    <button
                      type='button'
                      onClick={() => handleConfirmSelect(previewItem)}
                      className='btn btn-primary btn-xs'
                    >
                      <FiCheck size={14} />
                      {_('Use this photo')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4'>
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className='bg-base-200 flex animate-pulse flex-col overflow-hidden rounded-lg'
                >
                  <div className='bg-base-300 aspect-3/4 w-full' />
                  <div className='p-2'>
                    <div className='bg-base-300 mb-1.5 h-3.5 w-3/4 rounded' />
                    <div className='bg-base-300 h-2.5 w-1/2 rounded' />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error message */}
          {!loading && error && (
            <div className='alert alert-error my-4 text-xs sm:text-sm'>
              <span>{error}</span>
            </div>
          )}

          {/* Empty results */}
          {!loading && !error && hasSearched && results.length === 0 && (
            <div className='flex flex-col items-center justify-center py-12 text-center'>
              <FiImage className='text-base-content/30 mb-2' size={40} />
              <p className='text-base-content font-medium text-sm'>
                {_('No photos found for "{{query}}"', { query })}
              </p>
              <p className='text-base-content/60 mt-1 max-w-xs text-xs'>
                {_('Try searching with the full name, switching language, or paste an image URL.')}
              </p>
              <button
                type='button'
                onClick={() => setSource('custom')}
                className='btn btn-outline btn-xs mt-3'
              >
                {_('Paste image URL instead')}
              </button>
            </div>
          )}

          {/* Results grid */}
          {!loading && results.length > 0 && (
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4'>
              {results.map((item) => {
                const isSelected = previewItem?.id === item.id;
                return (
                  <div
                    key={item.id}
                    role='button'
                    tabIndex={0}
                    aria-label={item.title}
                    onClick={() => setPreviewItem(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPreviewItem(item);
                      }
                    }}
                    className={clsx(
                      'group border-base-300 bg-base-100 relative flex cursor-pointer flex-col overflow-hidden rounded-lg border text-left transition-all duration-200',
                      'hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary',
                      isSelected && 'border-primary ring-2 ring-primary shadow-md',
                    )}
                  >
                    <div className='bg-base-300 relative aspect-3/4 w-full overflow-hidden'>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        loading='lazy'
                        className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-105'
                      />
                      <span className='badge badge-neutral badge-xs bg-black/60 text-white absolute top-1.5 right-1.5 backdrop-blur-xs'>
                        {item.source === 'wikipedia' ? 'Wiki' : 'Commons'}
                      </span>
                    </div>

                    <div className='flex flex-1 flex-col justify-between p-2'>
                      <div>
                        <h4
                          className='text-base-content font-semibold text-xs sm:text-sm line-clamp-1'
                          title={item.title}
                        >
                          {item.title}
                        </h4>
                        {item.extract && (
                          <p
                            className='text-base-content/70 mt-1 text-[11px] leading-tight line-clamp-2'
                            title={item.extract}
                          >
                            {item.extract}
                          </p>
                        )}
                      </div>

                      <button
                        type='button'
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmSelect(item);
                        }}
                        className='btn btn-primary btn-xs mt-2 w-full opacity-90 transition-opacity hover:opacity-100'
                      >
                        {_('Select')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
};

export default ImageSearchDialog;
