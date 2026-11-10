import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { createNotebookEditorExtensions } from '@/app/reader/components/notebook/extensions/notebookEditorExtensions';
import { serializeNotebookMarkdown } from '@/app/reader/utils/notebookMarkdown';

const createEditor = (markdown = '') =>
  new Editor({
    extensions: createNotebookEditorExtensions({
      placeholder: () => 'Start writing…',
      onSave: () => true,
    }),
    content: markdown,
  });

const roundTrip = (markdown: string) => {
  const editor = createEditor(markdown);
  const output = serializeNotebookMarkdown(editor);
  editor.destroy();
  return output;
};

describe('notebook markdown round trip', () => {
  it('keeps headings, emphasis and lists', () => {
    expect(roundTrip('# Title\n\n## Sub\n\n### Deep\n\n**bold** *italic* ~~gone~~')).toBe(
      '# Title\n\n## Sub\n\n### Deep\n\n**bold** *italic* ~~gone~~',
    );
  });

  it('keeps bullet and ordered lists', () => {
    expect(roundTrip('- one\n- two\n\n1. first\n2. second')).toBe(
      '- one\n- two\n\n1. first\n2. second',
    );
  });

  it('keeps block quotes', () => {
    expect(roundTrip('> quoted line')).toBe('> quoted line');
  });

  it('keeps the colourless highlight', () => {
    expect(roundTrip('a ==marked== word')).toBe('a ==marked== word');
  });

  it('keeps a coloured highlight', () => {
    expect(roundTrip('a <mark data-color="mint">marked</mark> word')).toBe(
      'a <mark data-color="mint">marked</mark> word',
    );
  });

  it('keeps a citation link with its CFI', () => {
    expect(roundTrip('> quoted\n>\n> [Chapter 3](minerva-cfi:epubcfi(/6/4!/4/2/1:0))')).toBe(
      '> quoted\n>\n> [Chapter 3](minerva-cfi:epubcfi(/6/4!/4/2/1:0))',
    );
  });

  it('keeps emphasis that opens at the start of a quoted block', () => {
    expect(roundTrip('> quoted\n>\n> **bold**')).toBe('> quoted\n>\n> **bold**');
    expect(roundTrip('> quoted\n>\n> *italic*')).toBe('> quoted\n>\n> *italic*');
  });

  it('keeps a citation that opens at the start of a quoted block', () => {
    expect(roundTrip('> quoted\n>\n> [Chapter 3](minerva-cfi:epubcfi(/6/4))')).toBe(
      '> quoted\n>\n> [Chapter 3](minerva-cfi:epubcfi(/6/4))',
    );
  });

  it('escapes markdown punctuation typed as plain text', () => {
    const output = roundTrip('2 * 3 * 4');
    expect(output).toBe('2 \\* 3 \\* 4');
    expect(roundTrip(output)).toBe('2 \\* 3 \\* 4');
  });

  it('does not let raw HTML through', () => {
    const editor = createEditor('<img src=x onerror="alert(1)">');
    expect(editor.getHTML()).not.toContain('<img');
    editor.destroy();
  });
});
