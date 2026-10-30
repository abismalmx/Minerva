'use client';

import React from 'react';

interface PageFooterProps {
  tagline: string;
}

export const PageFooter: React.FC<PageFooterProps> = ({ tagline }) => (
  <p className='text-base-content/50 mt-6 text-center text-xs'>
    <a
      href='/'
      className='font-display hover:text-base-content/80 text-sm font-semibold tracking-wide transition-colors'
    >
      Minerva
    </a>
    <span className='mx-1.5'>·</span>
    <span>{tagline}</span>
  </p>
);
