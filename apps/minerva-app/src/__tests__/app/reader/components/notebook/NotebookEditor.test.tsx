import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotebookEditor from '@/app/reader/components/notebook/NotebookEditor';
import { DropdownProvider } from '@/context/DropdownContext';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { BookNote } from '@/types/book';

const flushNotebookDocument = vi.fn(async (_bookKey: string) => 'saved');
const handleOpenAnnotations = vi.fn();
const onDeleteExcerpt = vi.fn();
const defaultProps = {
  bookKey: 'book-view',
  handleOpenAnnotations,
  excerpts: [] as BookNote[],
  onDeleteExcerpt,
};
vi.mock('@/app/reader/hooks/useNotebookDocumentCoordinator', () => ({
  flushNotebookDocument: (bookKey: string) => flushNotebookDocument(bookKey),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const renderEditor = () =>
  render(
    <DropdownProvider>
      <NotebookEditor {...defaultProps} />
    </DropdownProvider>,
  );

describe('NotebookEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotebookDocumentStore.getState().reset();
    useNotebookDocumentStore.getState().hydrate('book', '', null);
  });

  afterEach(cleanup);

  it('renders a rich editor as the blank state', async () => {
    renderEditor();
    await flush();

    const editor = screen.getByRole('textbox', { name: 'Notebook' });
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(editor.getAttribute('dir')).toBe('auto');
    expect(editor.getAttribute('spellcheck')).toBe('true');
    expect(editor.classList.contains('notebook-editor-content')).toBe(true);
    expect(screen.queryByText('No Notes')).toBeNull();
  });

  it('updates the isolated document session while typing', async () => {
    renderEditor();
    await flush();

    const editor = screen.getByRole('textbox', { name: 'Notebook' });
    editor.textContent = 'Reading notes';
    await flush();

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'Reading notes',
      status: 'dirty',
      revision: 1,
    });
  });

  it('stores the typed text as Markdown', async () => {
    renderEditor();
    await flush();

    const editor = screen.getByRole('textbox', { name: 'Notebook' });
    editor.textContent = '**Reading notes**';
    await flush();

    expect(useNotebookDocumentStore.getState().sessions['book']?.content).toBe('**Reading notes**');
  });

  it('flushes on the save shortcut and blur', async () => {
    renderEditor();
    await flush();

    const editor = screen.getByRole('textbox', { name: 'Notebook' });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    fireEvent.blur(editor);

    expect(flushNotebookDocument).toHaveBeenCalledTimes(2);
    expect(flushNotebookDocument).toHaveBeenCalledWith('book-view');
  });

  it('shows local durability status in a polite live region', () => {
    renderEditor();

    act(() => {
      useNotebookDocumentStore.getState().mutate('book', 'draft');
      useNotebookDocumentStore.getState().markSaving('book', 1);
    });
    expect(screen.getByRole('status').textContent).toBe('Saving…');

    act(() => {
      useNotebookDocumentStore.getState().markSaved('book', 1, 'draft', 100);
    });
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('offers both recovery choices without overwriting either copy', async () => {
    useNotebookDocumentStore.getState().reset();
    useNotebookDocumentStore.getState().hydrate('book', 'latest saved', 200, 'local draft');
    renderEditor();
    await flush();

    expect(screen.getByRole('textbox', { name: 'Notebook' }).textContent).toBe('latest saved');
    fireEvent.click(screen.getByRole('button', { name: 'Recover draft' }));

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'local draft',
      status: 'dirty',
    });
  });

  it('rolls the editor back when the store refuses an oversize document', async () => {
    const huge = 'x'.repeat(300_000);
    useNotebookDocumentStore.getState().reset();
    useNotebookDocumentStore.getState().hydrate('book', huge, null);
    renderEditor();
    await flush();

    const editor = screen.getByRole('textbox', { name: 'Notebook' });
    editor.textContent = `${huge}more`;
    await flush();

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: huge,
      error: 'size-limit',
    });
  });

  it('shows excerpts above the editor and can delete them', () => {
    const excerpt: BookNote = {
      id: 'excerpt-1',
      type: 'excerpt',
      cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)',
      text: 'To be, or not to be',
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
    };
    const onDeleteExcerpt = vi.fn();

    render(
      <DropdownProvider>
        <NotebookEditor {...defaultProps} excerpts={[excerpt]} onDeleteExcerpt={onDeleteExcerpt} />
      </DropdownProvider>,
    );

    expect(screen.getByText('Excerpts')).toBeTruthy();
    expect(screen.getAllByText('To be, or not to be')).toHaveLength(2);
    expect(
      screen
        .getByRole('textbox', { name: 'Notebook' })
        .compareDocumentPosition(screen.getByText('Excerpts')) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    fireEvent.click(screen.getByText('To be, or not to be', { selector: 'summary span' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteExcerpt).toHaveBeenCalledWith(excerpt);
  });
});
