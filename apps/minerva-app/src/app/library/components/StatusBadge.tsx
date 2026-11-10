import clsx from 'clsx';
import type { ReadingStatus } from '@/types/book';

interface StatusBadgeProps {
  status?: ReadingStatus;
  children: React.ReactNode;
  className?: string;
}

/**
 * The status badge.
 *
 * A badge is a fixed-height chip: one size, one radius, and the semantic
 * colour carried by a translucent fill plus an inset ring at ~25 % — never a
 * filled block of colour. The label stays dark enough to read on the paper
 * (the colour marks the state, it does not replace the text), and the brand
 * accent is never used here: the meaning of a colour has to stay stable.
 *
 * The text is the only thing inside the badge — the state is carried by the
 * colour, so a screen reader reads "Finished", not "Finished green".
 */
const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children, className }) => {
  if (status !== 'finished' && status !== 'unread' && status !== 'abandoned') return null;

  return (
    <span
      className={clsx(
        'inline-flex h-4 items-center justify-center rounded-sm px-1',
        'text-[10px] font-medium uppercase leading-none tracking-wide',
        status === 'finished' &&
          'bg-emerald-500/10 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300 dark:bg-emerald-400/15 dark:ring-emerald-300/30',
        status === 'unread' &&
          'bg-amber-500/10 text-amber-700 ring-amber-600/25 dark:text-amber-300 dark:bg-amber-400/15 dark:ring-amber-300/30',
        status === 'abandoned' &&
          'bg-slate-500/10 text-slate-600 ring-slate-600/25 dark:text-slate-300 dark:bg-slate-400/15 dark:ring-slate-300/30',
        'ring-1 ring-inset',
        className,
      )}
      role='status'
    >
      {children}
    </span>
  );
};

export default StatusBadge;
