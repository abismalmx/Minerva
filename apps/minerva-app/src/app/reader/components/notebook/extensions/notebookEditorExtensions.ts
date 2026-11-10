import { Extension } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { BookLink, NotebookHighlight } from './notebookMarkdownExtensions';

interface NotebookEditorExtensionOptions {
  /** Reads the placeholder text lazily so a language switch does not need a new editor. */
  placeholder: () => string;
  /** Runs the notebook flush. Returns true when the shortcut was handled. */
  onSave: () => boolean;
}

const NotebookShortcuts = Extension.create<{ onSave: () => boolean }>({
  name: 'notebookShortcuts',
  addOptions() {
    return { onSave: () => false };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.options.onSave(),
    };
  },
});

/**
 * Extension stack of the notebook editor.
 *
 * `underline` is disabled on purpose: the durable format is Markdown, and
 * underline has no portable Markdown spelling, so enabling it would let the
 * user apply a style that cannot be saved.
 *
 * `html` is disabled for the Markdown parser as well. Raw HTML in a synced
 * document is an injection vector, and the two extended constructs the
 * notebook needs — coloured highlights and CFI citations — are recognised by
 * dedicated inline rules instead.
 */
export const createNotebookEditorExtensions = (options: NotebookEditorExtensionOptions) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    underline: false,
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
    },
  }),
  Placeholder.configure({
    placeholder: () => options.placeholder(),
    showOnlyCurrent: false,
  }),
  NotebookHighlight,
  BookLink,
  Markdown.configure({
    html: false,
    linkify: false,
    breaks: false,
    tightLists: true,
    bulletListMarker: '-',
    transformPastedText: false,
    transformCopiedText: false,
  }),
  NotebookShortcuts.configure({ onSave: options.onSave }),
];
