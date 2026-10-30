import { describe, expect, test } from 'vitest';
import {
  buildBasePath,
  buildBookDirPath,
  buildBookConfigPath,
  buildLibraryPath,
  buildBookFilePath,
  buildBookCoverPath,
  ancestorsOf,
  normalizeRoot,
} from '@/services/sync/file/layout';
import type { Book } from '@/types/book';

const book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'My Book',
  sourceTitle: 'My Book',
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
} as Book;

describe('sync layout (frozen)', () => {
  test('book tree paths under <root>/Minerva/books/<hash>', () => {
    expect(buildBasePath('/')).toBe('/Minerva');
    expect(buildBasePath('/MyDav')).toBe('/MyDav/Minerva');
    expect(buildBookDirPath('/', 'h1')).toBe('/Minerva/books/h1');
    expect(buildBookConfigPath('/', 'h1')).toBe('/Minerva/books/h1/config.json');
    expect(buildBookCoverPath('/', 'h1')).toBe('/Minerva/books/h1/cover.png');
    expect(buildLibraryPath('/')).toBe('/Minerva/library.json');
  });

  test('book file path uses safe title + ext inside the hash dir', () => {
    expect(buildBookFilePath('/', book)).toBe('/Minerva/books/h1/My Book.epub');
  });

  test('normalizeRoot strips trailing slash, adds leading', () => {
    expect(normalizeRoot('')).toBe('/');
    expect(normalizeRoot('books/')).toBe('/books');
    expect(normalizeRoot('/a/b/')).toBe('/a/b');
  });

  test('ancestorsOf walks parents top-down excluding the leaf', () => {
    expect(ancestorsOf('/a/b/c/file.json')).toEqual(['/a', '/a/b', '/a/b/c']);
    expect(ancestorsOf('/file.json')).toEqual([]);
  });
});
