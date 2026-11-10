import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';

/**
 * URL scheme that carries an EPUB CFI inside a notebook citation link.
 *
 * The notebook document is durable Markdown: it travels through the local
 * store, the cloud sync and the export pipeline as plain text. A citation
 * therefore has to survive a Markdown round trip, which rules out metadata
 * that only exists inside the editor. Encoding the CFI in the link target
 * keeps the citation readable (`[Chapter 3](minerva-cfi:epubcfi(/6/4))`) and
 * clickable in the editor.
 */
export const NOTEBOOK_CFI_SCHEME = 'minerva-cfi:';

/** A quote taken from the book that can be inserted into the notebook. */
export interface NotebookCitationSource {
  /** Stable identity of the source excerpt. */
  id: string;
  /** Visible text of the citation chip, e.g. `Chapter 3 · p. 42`. */
  label: string;
  /** The quoted passage itself. */
  text: string;
  /** EPUB CFI the citation points at. */
  cfi: string;
}

/** Build the link target that carries a CFI. */
export const buildNotebookCitationHref = (cfi: string): string => `${NOTEBOOK_CFI_SCHEME}${cfi}`;

/** Recover the CFI from a citation chip's `data-cfi` attribute. */
export const readNotebookCitationCfi = (element: Element | null): string | null => {
  const cfi = element?.getAttribute('data-cfi')?.trim();
  return cfi ? cfi : null;
};

/**
 * Collapse a quoted passage into a single line that can be embedded in a
 * blockquote: line breaks inside a blockquote would split the quote into
 * several Markdown blocks.
 */
export const normalizeNotebookCitationText = (text: string, maxLength = 600): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
};

/**
 * Send the reader to the exact position a citation was taken from.
 *
 * The `navigate` event is the app-wide signal that the reader takes over the
 * screen: the notebook panel listens for it and steps aside when it is not
 * pinned, so the reader stays visible behind the jump.
 */
export const navigateToNotebookCitation = (bookKey: string, cfi: string): void => {
  const view = useReaderStore.getState().getView(bookKey);
  if (!view) return;
  void eventDispatcher.dispatch('navigate', { bookKey, cfi });
  view.goTo(cfi);
};
