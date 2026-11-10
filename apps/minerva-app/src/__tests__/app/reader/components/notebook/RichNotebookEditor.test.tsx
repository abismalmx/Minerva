import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RichNotebookEditor from '@/app/reader/components/notebook/RichNotebookEditor';
import { DropdownProvider } from '@/context/DropdownContext';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';
import type { NotebookCitationSource } from '@/app/reader/utils/notebookCitation';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

type EditorProps = React.ComponentProps<typeof RichNotebookEditor>;

const renderEditor = (props: Partial<EditorProps> = {}) =>
  render(
    <DropdownProvider>
      <RichNotebookEditor
        bookKey='book-view'
        content=''
        onChange={() => {}}
        ariaLabel='Notebook'
        {...props}
      />
    </DropdownProvider>,
  );

const typeInEditor = async (text: string) => {
  // The editing surface itself is the ProseMirror node; mutating it is what
  // the browser does while the user types.
  const editable = screen.getByRole('textbox', { name: 'Notebook' });
  editable.textContent = text;
  await flush();
};

describe('RichNotebookEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders a spellchecked, self-directed editing region', async () => {
    renderEditor({ placeholder: 'Start writing about this book…' });
    await flush();

    const editable = screen.getByRole('textbox', { name: 'Notebook' });
    expect(editable.getAttribute('contenteditable')).toBe('true');
    expect(editable.getAttribute('dir')).toBe('auto');
    expect(editable.getAttribute('spellcheck')).toBe('true');
    // The placeholder is painted on the empty block, not on the editing root.
    const emptyBlock = editable.querySelector('p');
    expect(emptyBlock?.getAttribute('data-placeholder')).toBe('Start writing about this book…');
  });

  it('reports the typed text as Markdown', async () => {
    const changes: string[] = [];
    renderEditor({ onChange: (markdown) => changes.push(markdown) });

    await typeInEditor('Reading notes');

    expect(changes.at(-1)).toBe('Reading notes');
  });

  it('adopts content that changed outside the editor', async () => {
    const { rerender } = renderEditor({ content: '# Saved' });

    expect(screen.getByRole('textbox', { name: 'Notebook' }).textContent).toBe('Saved');

    rerender(
      <DropdownProvider>
        <RichNotebookEditor
          bookKey='book-view'
          content='# Remote'
          onChange={() => {}}
          ariaLabel='Notebook'
        />
      </DropdownProvider>,
    );
    await flush();

    expect(screen.getByRole('textbox', { name: 'Notebook' }).textContent).toBe('Remote');
  });

  it('jumps the reader to the CFI of a clicked citation', async () => {
    const goTo = vi.fn();
    vi.spyOn(useReaderStore.getState(), 'getView').mockReturnValue({ goTo } as never);
    const dispatch = vi.spyOn(eventDispatcher, 'dispatch');

    renderEditor({
      content: '> quoted\n>\n> [Chapter 3](minerva-cfi:epubcfi(/6/4!/4/2/1:0))',
    });
    await flush();

    const citation = document.querySelector('a[data-cfi]') as HTMLAnchorElement;
    expect(citation).toBeTruthy();
    expect(citation.getAttribute('data-cfi')).toBe('epubcfi(/6/4!/4/2/1:0)');

    fireEvent.click(citation);

    expect(goTo).toHaveBeenCalledWith('epubcfi(/6/4!/4/2/1:0)');
    expect(dispatch).toHaveBeenCalledWith('navigate', {
      bookKey: 'book-view',
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
    });
  });

  it('inserts a quoted passage with a citation chip from the toolbar', async () => {
    const changes: string[] = [];
    const citation: NotebookCitationSource = {
      id: 'excerpt-1',
      label: 'Chapter 3',
      text: 'To be, or not to be',
      cfi: 'epubcfi(/6/4)',
    };

    renderEditor({
      onChange: (markdown) => changes.push(markdown),
      citations: [citation],
    });
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Quote from the book' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Chapter 3/ }));
    await flush();

    expect(changes.at(-1)).toBe(
      '> To be, or not to be\n>\n> [Chapter 3](minerva-cfi:epubcfi(/6/4))',
    );
  });

  it('does not open the citation picker when the book has no excerpts', async () => {
    renderEditor({ citations: [] });
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Quote from the book' }));
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('turns the current block into a heading from the toolbar', async () => {
    const changes: string[] = [];
    renderEditor({ onChange: (markdown) => changes.push(markdown) });
    await flush();

    await typeInEditor('Reading notes');
    fireEvent.click(screen.getByRole('button', { name: 'Text style' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Heading 2/ }));
    await flush();

    expect(changes.at(-1)).toBe('## Reading notes');
  });
});
