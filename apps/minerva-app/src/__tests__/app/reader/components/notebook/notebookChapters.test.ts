import { describe, expect, it } from 'vitest';
import type { TOCItem } from '@/libs/document';
import {
  ALL_CHAPTERS_KEY,
  GENERAL_NOTES_KEY,
  flattenToc,
  getChapterAndDescendantKeys,
  getChapterContent,
  parseChapterSections,
  updateChapterContent,
} from '@/app/reader/utils/notebookChapters';

describe('notebookChapters', () => {
  const sampleToc: TOCItem[] = [
    {
      id: 1,
      index: 0,
      href: 'text/ch1.xhtml',
      label: 'Introducción',
      subitems: [
        {
          id: 2,
          index: 1,
          href: 'text/ch1_1.xhtml',
          label: '1. Filosofía',
        },
        {
          id: 3,
          index: 2,
          href: 'text/ch1_2.xhtml',
          label: '2. Verdad',
        },
      ],
    },
    {
      id: 4,
      index: 3,
      href: 'text/ch2.xhtml',
      label: 'Capítulo 2',
    },
  ];

  it('flattens hierarchical TOC with correct depths and keys', () => {
    const flat = flattenToc(sampleToc);
    expect(flat).toHaveLength(4);
    expect(flat[0]).toEqual({
      key: 'text/ch1.xhtml',
      label: 'Introducción',
      depth: 0,
      href: 'text/ch1.xhtml',
      cfi: undefined,
    });
    expect(flat[1]).toEqual({
      key: 'text/ch1_1.xhtml',
      label: '1. Filosofía',
      depth: 1,
      href: 'text/ch1_1.xhtml',
      cfi: undefined,
    });
    expect(flat[2]).toEqual({
      key: 'text/ch1_2.xhtml',
      label: '2. Verdad',
      depth: 1,
      href: 'text/ch1_2.xhtml',
      cfi: undefined,
    });
    expect(flat[3]).toEqual({
      key: 'text/ch2.xhtml',
      label: 'Capítulo 2',
      depth: 0,
      href: 'text/ch2.xhtml',
      cfi: undefined,
    });
  });

  it('collects descendant keys for hierarchical chapters', () => {
    const keys = getChapterAndDescendantKeys(sampleToc[0]!);
    expect(keys.has('text/ch1.xhtml')).toBe(true);
    expect(keys.has('text/ch1_1.xhtml')).toBe(true);
    expect(keys.has('text/ch1_2.xhtml')).toBe(true);
    expect(keys.has('text/ch2.xhtml')).toBe(false);
  });

  it('parses markdown with general notes and chapter sections', () => {
    const md = `Notas preliminares del lector.

<!-- minerva-chapter:text%2Fch1.xhtml:Introducci%C3%B3n -->
# Introducción

Primera nota de la introducción.
Segunda línea.

<!-- minerva-chapter:text%2Fch2.xhtml:Cap%C3%ADtulo%202 -->
# Capítulo 2

Nota del capítulo dos.`;

    const parsed = parseChapterSections(md);
    expect(parsed.general).toBe('Notas preliminares del lector.');
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]!.key).toBe('text/ch1.xhtml');
    expect(parsed.sections[0]!.title).toBe('Introducción');
    expect(parsed.sections[0]!.content).toBe('Primera nota de la introducción.\nSegunda línea.');
    expect(parsed.sections[1]!.key).toBe('text/ch2.xhtml');
    expect(parsed.sections[1]!.title).toBe('Capítulo 2');
    expect(parsed.sections[1]!.content).toBe('Nota del capítulo dos.');
  });

  it('extracts chapter content correctly for different keys', () => {
    const md = `Notas generales.

<!-- minerva-chapter:ch1:Cap%C3%ADtulo%201 -->
# Capítulo 1

Contenido de Cap 1.`;

    expect(getChapterContent(md, ALL_CHAPTERS_KEY)).toBe(md);
    expect(getChapterContent(md, GENERAL_NOTES_KEY)).toBe('Notas generales.');
    expect(getChapterContent(md, 'ch1')).toBe('Contenido de Cap 1.');
    expect(getChapterContent(md, 'non-existent')).toBe('');
  });

  it('updates an existing chapter section without altering other sections', () => {
    const initial = `<!-- minerva-chapter:ch1:Cap1 -->
# Cap1

Nota vieja cap 1.

<!-- minerva-chapter:ch2:Cap2 -->
# Cap2

Nota cap 2.`;

    const updated = updateChapterContent(initial, 'ch1', 'Cap1', 'Nota nueva cap 1.');
    expect(getChapterContent(updated, 'ch1')).toBe('Nota nueva cap 1.');
    expect(getChapterContent(updated, 'ch2')).toBe('Nota cap 2.');
  });

  it('appends a new chapter section when none existed', () => {
    const initial = 'Mis notas generales.';
    const updated = updateChapterContent(initial, 'ch1', 'Introducción', 'Primera nota de cap 1.');

    expect(getChapterContent(updated, GENERAL_NOTES_KEY)).toBe('Mis notas generales.');
    expect(getChapterContent(updated, 'ch1')).toBe('Primera nota de cap 1.');
    expect(updated).toContain('<!-- minerva-chapter:ch1:Introducci%C3%B3n -->');
    expect(updated).toContain('# Introducción');
  });

  it('removes a chapter section when its content is cleared', () => {
    const initial = `<!-- minerva-chapter:ch1:Cap1 -->
# Cap1

Nota cap 1.

<!-- minerva-chapter:ch2:Cap2 -->
# Cap2

Nota cap 2.`;

    const updated = updateChapterContent(initial, 'ch1', 'Cap1', '   ');
    expect(getChapterContent(updated, 'ch1')).toBe('');
    expect(getChapterContent(updated, 'ch2')).toBe('Nota cap 2.');
    expect(updated).not.toContain('minerva-chapter:ch1');
  });
});
