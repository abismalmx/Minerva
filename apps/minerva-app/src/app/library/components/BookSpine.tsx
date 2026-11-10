import clsx from 'clsx';
import type { Book } from '@/types/book';
import { isAudiobook } from '@/utils/audiobook';
import { getProgressPercentage } from '../utils/libraryUtils';

/**
 * "El lomo" — the spine.
 *
 * Minerva's signature component: a book tells you where you stopped through its
 * own binding. A vertical rule runs down the leading edge of the cover and its
 * filled portion is the reading progress, so the state of a shelf is legible
 * without a badge, a percentage or a colour that has to mean something.
 *
 * The rule is drawn by `.minerva-spine` (globals.css) so the e-ink variant —
 * a 1px rule instead of a 3px one — stays in the stylesheet with the rest of
 * the e-ink conventions.
 */
export const BookSpine: React.FC<{ book: Book; className?: string }> = ({ book, className }) => {
  const progress = getProgressPercentage(book);

  // The lomo only marks a book that has been opened: a shelf of untouched
  // spines would be noise, and the rule means "you have been here".
  const engaged = book.readingStatus === 'finished' || (progress !== null && progress > 0);
  if (!engaged) return null;

  // A finished book is full; a book that was never opened has nothing to
  // show. Both fall back to an empty rule rather than a wrong one.
  const filled = book.readingStatus === 'finished' ? 100 : (progress ?? 0);

  return (
    <div
      className={clsx('minerva-spine', className)}
      aria-hidden='true'
      style={{ '--minerva-spine-progress': filled } as React.CSSProperties}
    >
      <div className='minerva-spine-fill' />
    </div>
  );
};

/**
 * The folio: the page counter, set as a figure (mono, tabular) rather than as
 * prose. Reads "77 / 180"; an untouched book shows the total only, so the
 * column of folios stays aligned down the shelf.
 */
export const BookFolio: React.FC<{ book: Book; className?: string }> = ({ book, className }) => {
  // An audiobook's progress is measured in seconds, not pages: its folio would
  // print a duration as if it were a page count.
  if (isAudiobook(book)) return null;

  const total = book.progress?.[1] ?? book.pageCount ?? 0;
  const current = book.progress?.[0] ?? 0;

  if (!total) return null;

  const finished = book.readingStatus === 'finished';

  // A finished or untouched book has no position to report — only the length
  // of the run. One figure keeps the column of folios aligned down the shelf.
  if (finished || !current) {
    return <span className={clsx('minerva-folio', className)}>{total}</span>;
  }

  return (
    <span className={clsx('minerva-folio', className)}>
      {current}
      <span className='opacity-45'>/</span>
      {total}
    </span>
  );
};
