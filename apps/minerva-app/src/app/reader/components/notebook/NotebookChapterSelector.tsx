import React, { useMemo } from 'react';
import { PiBookOpen, PiCompass } from 'react-icons/pi';
import type { TOCItem } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import {
  ALL_CHAPTERS_KEY,
  GENERAL_NOTES_KEY,
  flattenToc,
  matchExcerptChapter,
  getTocItemKey,
} from '@/app/reader/utils/notebookChapters';

interface NotebookChapterSelectorProps {
  toc: TOCItem[];
  selectedChapterKey: string;
  onSelectChapter: (chapterKey: string) => void;
  excerptsCountByChapter: Record<string, number>;
  hasNotesByChapter: Record<string, boolean>;
  currentReadingCfi?: string | null;
}

const NotebookChapterSelector: React.FC<NotebookChapterSelectorProps> = ({
  toc,
  selectedChapterKey,
  onSelectChapter,
  excerptsCountByChapter,
  hasNotesByChapter,
  currentReadingCfi,
}) => {
  const _ = useTranslation();

  const flatChapters = useMemo(() => flattenToc(toc), [toc]);

  const currentReadingChapterKey = useMemo(() => {
    if (!currentReadingCfi || toc.length === 0) return null;
    const match = matchExcerptChapter(toc, currentReadingCfi);
    return match ? getTocItemKey(match) : null;
  }, [currentReadingCfi, toc]);

  return (
    <div className='flex items-center gap-1.5 border-b border-base-300 pb-1.5' dir='auto'>
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <PiBookOpen className='text-base-content/60 size-4 shrink-0' aria-hidden='true' />
        <select
          aria-label={_('Filter by chapter')}
          className='select select-bordered select-xs eink-bordered h-7 min-h-7 w-full max-w-full text-xs font-normal'
          value={selectedChapterKey}
          onChange={(e) => onSelectChapter(e.target.value)}
        >
          <option value={ALL_CHAPTERS_KEY}>📖 {_('All chapters')}</option>
          <option value={GENERAL_NOTES_KEY}>📝 {_('General notes')}</option>
          {flatChapters.map((chap) => {
            const count = excerptsCountByChapter[chap.key] || 0;
            const hasNotes = hasNotesByChapter[chap.key];
            const badge =
              count > 0 && hasNotes
                ? ` (${count} ✦)`
                : count > 0
                  ? ` (${count})`
                  : hasNotes
                    ? ' (✦)'
                    : '';
            return (
              <option key={chap.key} value={chap.key}>
                {'\u00A0\u00A0'.repeat(chap.depth)}
                {chap.label}
                {badge}
              </option>
            );
          })}
        </select>
      </div>

      {currentReadingChapterKey && (
        <button
          type='button'
          onClick={() => onSelectChapter(currentReadingChapterKey)}
          title={_('Jump to current reading chapter')}
          aria-label={_('Jump to current reading chapter')}
          className='eink-bordered btn btn-ghost btn-xs h-7 min-h-7 px-2 text-xs'
        >
          <PiCompass size={14} className='shrink-0' />
          <span className='sr-only'>{_('Current chapter')}</span>
        </button>
      )}
    </div>
  );
};

export default NotebookChapterSelector;
