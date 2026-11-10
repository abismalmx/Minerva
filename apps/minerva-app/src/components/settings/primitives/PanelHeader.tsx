import clsx from 'clsx';
import React from 'react';

interface PanelHeaderProps {
  /** The panel name. Rendered as the panel's `<h2>`. */
  title: React.ReactNode;
  /**
   * One line explaining what this surface does. Required by DESIGN.md §2.9
   * for every panel and sub-page: it orients the user before the rows.
   */
  description?: React.ReactNode;
  className?: string;
}

/**
 * The opening of a settings panel: its name and one line about what it does.
 *
 * Every panel opens with the same shape, so the reader always knows where
 * they are and what the surface is for before the first row. The title keeps
 * the canonical `text-lg font-semibold tracking-tight` of DESIGN.md §2.9 — the
 * interface stays in the UI face; the display face belongs to the product.
 *
 * It also carries the first Minerva sign (§1.1.1): a bronze rule above the
 * name and the halftone screen bleeding off the corner, so a settings panel
 * reads as part of this product and not as a generic list of switches.
 */
const PanelHeader: React.FC<PanelHeaderProps> = ({ title, description, className }) => {
  return (
    <div className={clsx('relative w-full overflow-hidden px-4', className)}>
      {/* The print motif: a halftone screen off the corner of the panel. */}
      <div className='minerva-halftone pointer-events-none absolute inset-0' aria-hidden='true' />
      <div className='relative'>
        <span className='bg-primary mb-2 block h-[2px] w-8 rounded-full' aria-hidden='true' />
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{title}</h2>
        {description && (
          <p className='text-base-content/70 text-sm leading-relaxed'>{description}</p>
        )}
      </div>
    </div>
  );
};

export default PanelHeader;
