import type { Editor } from '@tiptap/core';
import { MarkdownSerializerState } from 'prosemirror-markdown';

type NotebookSerializerState = MarkdownSerializerState & { out: string };

type NotebookSerializerStateConstructor = new (
  nodes: Record<string, unknown>,
  marks: Record<string, unknown>,
  options: { hardBreakNodeName: string },
) => NotebookSerializerState;

/**
 * The published types of `prosemirror-markdown` declare the serializer state
 * without a constructor and without the `out` buffer, although both exist at
 * runtime.
 */
const SerializerState = MarkdownSerializerState as unknown as NotebookSerializerStateConstructor;

const getSerializerTables = (
  editor: Editor,
): { nodes: Record<string, unknown>; marks: Record<string, unknown> } | null => {
  const storage = editor.storage as unknown as Record<string, unknown>;
  const markdown = storage['markdown'] as
    | { serializer?: { nodes?: Record<string, unknown>; marks?: Record<string, unknown> } }
    | undefined;
  const serializer = markdown?.serializer;
  if (!serializer?.nodes || !serializer.marks) return null;
  return { nodes: serializer.nodes, marks: serializer.marks };
};

/**
 * Serialize the editor document to Markdown.
 *
 * `tiptap-markdown` ships its own serializer state that adds a second
 * "expel enclosing whitespace" pass on top of the one ProseMirror already
 * implements. That extra pass records the offset of the opening delimiter
 * *before* the pending block separator is flushed, so a mark that opens at
 * the start of a block gets its delimiter shifted into the previous block:
 *
 *     > quoted
 *     > **bold**      →      > quoted
 *                              > ****bold**
 *
 * The notebook stores every keystroke as Markdown, so that corruption would
 * be written to disk on the next save. ProseMirror's own state already
 * expels the whitespace correctly (it moves the whitespace outside the mark),
 * so the serializer is driven with the upstream state class while keeping
 * `tiptap-markdown`'s node and mark tables.
 */
export const serializeNotebookMarkdown = (editor: Editor): string => {
  const tables = getSerializerTables(editor);
  if (!tables) return '';
  const state = new SerializerState(tables.nodes, tables.marks, {
    hardBreakNodeName: 'hardBreak',
  });
  state.renderContent(editor.state.doc);
  return state.out;
};
