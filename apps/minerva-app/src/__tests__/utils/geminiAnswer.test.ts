import { describe, test, expect } from 'vitest';
import { parseGeminiAnswer } from '@/app/reader/utils/geminiAnswer';

describe('parseGeminiAnswer', () => {
  test('splits the answer into bullets and a closing line', () => {
    const blocks = parseGeminiAnswer('- First point.\n- Second point.\nThat is the gist.');

    expect(blocks).toEqual([
      { kind: 'bullet', text: 'First point.' },
      { kind: 'bullet', text: 'Second point.' },
      { kind: 'line', text: 'That is the gist.' },
    ]);
  });

  test('accepts the common bullet markers', () => {
    for (const marker of ['-', '*', '•', '‣', '▪']) {
      expect(parseGeminiAnswer(`${marker} Point`)).toEqual([{ kind: 'bullet', text: 'Point' }]);
    }
  });

  test('joins a bullet that wraps onto the next line', () => {
    const blocks = parseGeminiAnswer('- A long point that\n  wraps onto a second line.');

    expect(blocks).toEqual([
      { kind: 'bullet', text: 'A long point that wraps onto a second line.' },
    ]);
  });

  test('keeps a paragraph that precedes the bullets as a line', () => {
    const blocks = parseGeminiAnswer('A short summary.\n- First point.');

    expect(blocks).toEqual([
      { kind: 'line', text: 'A short summary.' },
      { kind: 'bullet', text: 'First point.' },
    ]);
  });

  test('renders a partial bullet while the answer is still streaming', () => {
    expect(parseGeminiAnswer('- Half a sen')).toEqual([{ kind: 'bullet', text: 'Half a sen' }]);
  });

  test('returns nothing for an empty answer', () => {
    expect(parseGeminiAnswer('')).toEqual([]);
    expect(parseGeminiAnswer('\n\n  \n')).toEqual([]);
  });
});
