import type React from 'react';
import { memo, useMemo } from 'react';
import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { SHOW_UNREAD_STATUS_BADGE } from '@/services/constants';
import StatusBadge from './StatusBadge';
import { BookFolio } from './BookSpine';
import {
  getDisplayedTimeRemaining,
  getProgressPercentage,
  formatTimeLeft,
} from '../utils/libraryUtils';
import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';

interface ReadingProgressProps {
  book: Book;
  showTimeRemaining: boolean;
  /**
   * `percent` is the list row: the percentage, in prose. `folio` is the grid
   * tile: the page counter set as a figure (mono, tabular), with the time
   * left beside it — the shelf reads as a column of folios instead of a row of
   * percentages.
   */
  variant?: 'percent' | 'folio';
}

const ReadingProgress: React.FC<ReadingProgressProps> = memo(
  ({ book, showTimeRemaining, variant = 'percent' }) => {
    const _ = useTranslation();
    const progressPercentage = useMemo(() => getProgressPercentage(book), [book]);
    const medianPageDurationSecs = useMedianPageDurationSecs(book.hash) ?? undefined;
    const minutes = getDisplayedTimeRemaining(book, medianPageDurationSecs);
    const progressLabel =
      showTimeRemaining && minutes
        ? `${progressPercentage}% · ${formatTimeLeft(minutes, _)}`
        : `${progressPercentage}%`;

    // The grid tile prints the state of the book as a set of figures: the
    // status, the folio (page counter) and the time left. A shelf reads as a
    // column of numbers rather than a row of percentages.
    if (variant === 'folio') {
      const hasProgress = progressPercentage !== null && !Number.isNaN(progressPercentage);
      const badge =
        book.readingStatus === 'finished' ? (
          <StatusBadge status={book.readingStatus}>{_('Finished')}</StatusBadge>
        ) : book.readingStatus === 'abandoned' ? (
          <StatusBadge status={book.readingStatus}>{_('On hold')}</StatusBadge>
        ) : book.readingStatus === 'unread' && SHOW_UNREAD_STATUS_BADGE ? (
          <StatusBadge status={book.readingStatus}>{_('Unread')}</StatusBadge>
        ) : null;

      return (
        <div
          className='text-base-content/70 flex min-w-0 items-center gap-2 text-[11px] leading-none'
          // The badge carries its own `status` role; a second one here would
          // make the row announce itself twice.
          role={badge ? undefined : 'status'}
          aria-label={!badge && hasProgress ? `${progressPercentage}%` : undefined}
        >
          {badge}
          <BookFolio book={book} />
          {showTimeRemaining && minutes ? (
            <span className='truncate text-base-content/55'>{formatTimeLeft(minutes, _)}</span>
          ) : null}
        </div>
      );
    }

    if (book.readingStatus === 'finished') {
      return (
        <div className='flex justify-start'>
          <StatusBadge status={book.readingStatus}>{_('Finished')}</StatusBadge>
        </div>
      );
    }

    if (book.readingStatus === 'abandoned') {
      return (
        <div
          className='text-neutral-content/70 flex items-center justify-between gap-2 text-xs'
          role='status'
        >
          <StatusBadge status={book.readingStatus}>{_('On hold')}</StatusBadge>
          {progressPercentage !== null && !Number.isNaN(progressPercentage) && (
            <span>{progressPercentage}%</span>
          )}
        </div>
      );
    }

    if (book.readingStatus === 'unread') {
      if (SHOW_UNREAD_STATUS_BADGE) {
        return (
          <div className='flex justify-start'>
            <StatusBadge status={book.readingStatus}>{_('Unread')}</StatusBadge>
          </div>
        );
      } else {
        return <div className='flex justify-start'></div>;
      }
    }

    if (progressPercentage === null || Number.isNaN(progressPercentage)) {
      return <div className='flex justify-start'></div>;
    }

    return (
      <div
        className='text-neutral-content/70 flex min-w-0 justify-between text-xs'
        role='status'
        aria-label={`${progressPercentage}%`}
      >
        <span className='truncate'>{progressLabel}</span>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.book.updatedAt === nextProps.book.updatedAt &&
      prevProps.book.readingStatus === nextProps.book.readingStatus &&
      prevProps.showTimeRemaining === nextProps.showTimeRemaining &&
      prevProps.variant === nextProps.variant
    );
  },
);

ReadingProgress.displayName = 'ReadingProgress';

export default ReadingProgress;
