import clsx from 'clsx';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  navigateToNotebookCitation,
  normalizeNotebookCitationText,
  readNotebookCitationCfi,
  type NotebookCitationSource,
} from '@/app/reader/utils/notebookCitation';
import { serializeNotebookMarkdown } from '@/app/reader/utils/notebookMarkdown';
import { createNotebookEditorExtensions } from './extensions/notebookEditorExtensions';
import NotebookToolbar from './NotebookToolbar';

export interface RichNotebookEditorRef {
  /** Replace the document without emitting a change (used to revert a rejected mutation). */
  setMarkdown: (markdown: string) => void;
  focus: () => void;
}

interface RichNotebookEditorProps {
  bookKey: string;
  content: string;
  onChange: (markdown: string) => void;
  onSave?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  citations?: NotebookCitationSource[];
  className?: string;
}

/**
 * WYSIWYG editor for the notebook.
 *
 * The durable format stays Markdown: the document is parsed from Markdown on
 * load and serialized back to Markdown on every change, so the notebook keeps
 * working with the existing store, sync and export pipeline unchanged.
 */
const RichNotebookEditor = forwardRef<RichNotebookEditorRef, RichNotebookEditorProps>(
  (
    {
      bookKey,
      content,
      onChange,
      onSave,
      onBlur,
      placeholder,
      ariaLabel,
      citations = [],
      className,
    },
    ref,
  ) => {
    const onChangeRef = useRef(onChange);
    const onBlurRef = useRef(onBlur);
    const onSaveRef = useRef(onSave);
    const placeholderRef = useRef(placeholder);
    const contentRef = useRef(content);
    // The Markdown the editor last produced. Comparing it with the incoming
    // content keeps the sync below O(1) on every keystroke instead of
    // serializing the whole document again.
    const emittedRef = useRef(content);
    const dispatchedPlaceholderRef = useRef(placeholder);

    useEffect(() => {
      onChangeRef.current = onChange;
      onBlurRef.current = onBlur;
      onSaveRef.current = onSave;
      placeholderRef.current = placeholder;
    }, [onBlur, onChange, onSave, placeholder]);

    const handleSave = useCallback(() => {
      if (!onSaveRef.current) return false;
      onSaveRef.current();
      return true;
    }, []);

    const editor = useEditor(
      {
        extensions: createNotebookEditorExtensions({
          placeholder: () => placeholderRef.current ?? '',
          onSave: handleSave,
        }),
        content: contentRef.current,
        immediatelyRender: false,
        editorProps: {
          attributes: {
            class: 'notebook-editor-content content font-size-sm select-text outline-hidden',
            'aria-label': ariaLabel ?? '',
            dir: 'auto',
            spellcheck: 'true',
            // Read Aloud stops following the voice while a note editor has focus.
            'data-note-editor': '',
          },
          handleDOMEvents: {
            click: (_view, event) => {
              const target = event.target as HTMLElement | null;
              const anchor = target?.closest('a');
              if (!anchor) return false;
              const cfi = readNotebookCitationCfi(anchor);
              if (!cfi) return false;
              event.preventDefault();
              event.stopPropagation();
              navigateToNotebookCitation(bookKey, cfi);
              return true;
            },
          },
        },
        onUpdate: ({ editor: instance }) => {
          const markdown = serializeNotebookMarkdown(instance);
          emittedRef.current = markdown;
          onChangeRef.current(markdown);
        },
        onBlur: () => {
          onBlurRef.current?.();
        },
      },
      [],
    );

    // Adopt content that changed outside the editor (remote sync, recovery
    // choice, discarded draft). The editor's own changes are already in the
    // store, so they are skipped by comparing against the last emission.
    useEffect(() => {
      if (!editor) return;
      if (emittedRef.current === content) return;
      emittedRef.current = content;
      editor.commands.setContent(content, { emitUpdate: false });
    }, [content, editor]);

    // The placeholder is painted as a decoration, so a language switch only
    // becomes visible once the decorations are rebuilt.
    useEffect(() => {
      if (!editor) return;
      if (dispatchedPlaceholderRef.current === placeholder) return;
      dispatchedPlaceholderRef.current = placeholder;
      editor.view.dispatch(editor.state.tr);
    }, [editor, placeholder]);

    useImperativeHandle(
      ref,
      () => ({
        setMarkdown: (markdown: string) => {
          emittedRef.current = markdown;
          editor?.commands.setContent(markdown, { emitUpdate: false });
        },
        focus: () => {
          editor?.commands.focus();
        },
      }),
      [editor],
    );

    const insertCitation = useCallback(
      (citation: NotebookCitationSource) => {
        if (!editor) return;
        const quote = normalizeNotebookCitationText(citation.text);
        editor
          .chain()
          .focus()
          .insertContent([
            {
              type: 'blockquote',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: quote }] },
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: citation.label,
                      marks: [{ type: 'bookLink', attrs: { cfi: citation.cfi } }],
                    },
                  ],
                },
              ],
            },
          ])
          .run();
      },
      [editor],
    );

    return (
      <div className={clsx('flex min-h-0 flex-1 flex-col', className)}>
        <NotebookToolbar editor={editor} citations={citations} onInsertCitation={insertCitation} />
        <div className='min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3'>
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  },
);

RichNotebookEditor.displayName = 'RichNotebookEditor';

export default RichNotebookEditor;
