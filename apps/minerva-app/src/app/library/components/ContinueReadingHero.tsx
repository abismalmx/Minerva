import clsx from 'clsx';
import { useMemo } from 'react';
import { MdChevronRight } from 'react-icons/md';

import { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';
import { formatAuthors } from '@/utils/book';
import BookCover from '@/components/BookCover';
import { BookFolio, BookSpine } from './BookSpine';
import {
  formatTimeLeft,
  getDisplayedTimeRemaining,
  getProgressPercentage,
} from '../utils/libraryUtils';

interface ContinueReadingHeroProps {
  book: Book;
  onOpen: (book: Book) => void;
}

/**
 * The poster of the library.
 *
 * The shelf answers "what do I own"; this panel answers "where was I". It is
 * the one thing on the screen big enough to be the protagonist — the book you
 * are in the middle of, its progress set as a figure rather than as a badge,
 * and one action to pick it back up.
 *
 * The composition is a dust jacket: the book and its details on the paper, the
 * reading percentage printed on a tonal panel beside it, the way a jacket
 * states the edition of a classic. The number is the hero; everything else is
 * set small enough to let it speak.
 */
const ContinueReadingHero: React.FC<ContinueReadingHeroProps> = ({ book, onOpen }) => {
  const _ = useTranslation();
  const progress = useMemo(() => getProgressPercentage(book), [book]);
  const medianPageDurationSecs = useMedianPageDurationSecs(book.hash) ?? undefined;
  const minutes = getDisplayedTimeRemaining(book, medianPageDurationSecs);

  if (progress === null || Number.isNaN(progress)) return null;

  const author = formatAuthors(book.author, book.primaryLanguage);

  return (
    <section
      aria-label={_('Continue reading')}
      className='minerva-surface relative mx-4 mt-3 overflow-hidden rounded-2xl sm:mx-6'
    >
      <div className='relative flex flex-col sm:flex-row'>
        <div className='flex min-w-0 flex-1 items-center gap-4 p-4 sm:gap-6 sm:p-6'>
          <button
            type='button'
            onClick={() => onOpen(book)}
            aria-label={_('Continue reading {{title}}', { title: book.title })}
            className='focus-visible:ring-base-content/20 focus-visible:outline-hidden focus-visible:ring-2 shrink-0'
          >
            <div className='minerva-cover relative aspect-28/41 w-20 overflow-hidden rounded-md sm:w-28'>
              <BookCover
                book={book}
                mode='grid'
                coverFit='crop'
                imageClassName='minerva-cover rounded-md'
              />
              <BookSpine book={book} />
            </div>
          </button>

          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <p className='minerva-accent font-mono text-[10px] font-medium tracking-[0.18em] uppercase'>
              {_('Continue reading')}
            </p>
            <h2 className='font-display truncate text-2xl leading-tight font-medium tracking-tight sm:text-[2rem]'>
              {book.title}
            </h2>
            <p className='text-base-content/70 truncate text-sm'>{author}</p>

            <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1'>
              {/* The rule of the lomo, laid flat: the same mark as the cover
                  edge, read horizontally. */}
              <div
                className='bg-base-content/12 relative h-[3px] w-full max-w-56 overflow-hidden rounded-full'
                role='progressbar'
                aria-label={_('Reading progress')}
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className='bg-primary absolute inset-y-0 start-0 rounded-full'
                  style={{ width: `${progress}%` }}
                />
              </div>
              <BookFolio book={book} className='text-base-content/60 shrink-0 text-[11px]' />
              {minutes ? (
                <span className='text-base-content/50 shrink-0 text-[11px]'>
                  {formatTimeLeft(minutes, _)}
                </span>
              ) : null}
            </div>

            <button
              type='button'
              onClick={() => onOpen(book)}
              className={clsx(
                'btn btn-primary mt-3 h-9 min-h-9 self-start gap-1 px-4 text-sm',
                'active:translate-y-px',
              )}
            >
              {_('Continue')}
              <MdChevronRight size={16} aria-hidden='true' />
            </button>
          </div>
        </div>

        {/* The poster: the figure printed on its own panel. */}
        <div className='minerva-poster border-base-content/10 relative flex shrink-0 items-center justify-center gap-3 border-t px-6 py-4 sm:w-40 sm:flex-col sm:gap-0 sm:border-t-0 sm:border-s sm:py-5 lg:w-48'>
          {/* The print motif: a halftone screen bleeding off the corner. */}
          <div
            className='minerva-halftone pointer-events-none absolute inset-0'
            aria-hidden='true'
          />
          <span className='font-display relative text-5xl leading-none font-medium tracking-tight tabular-nums sm:text-7xl lg:text-8xl'>
            {progress}
            <span className='minerva-accent text-2xl align-top sm:text-3xl'>%</span>
          </span>
          <span className='text-base-content/50 relative font-mono text-[10px] tracking-[0.18em] uppercase'>
            {_('Read')}
          </span>
        </div>
      </div>
    </section>
  );
};

export default ContinueReadingHero;
