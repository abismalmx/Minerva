import React, { useMemo, useRef, useState } from 'react';
import { PiCaretDown, PiNotePencil } from 'react-icons/pi';
import type { TOCItem } from '@/libs/document';
import { findTocItemBS } from '@/services/nav/lookup';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { BookNote } from '@/types/book';
import type { NotebookCitationSource } from '@/app/reader/utils/notebookCitation';
import {
  ALL_CHAPTERS_KEY,
  GENERAL_NOTES_KEY,
  flattenToc,
  getChapterContent,
  getTocItemKey,
  matchExcerptChapter,
  parseChapterSections,
  updateChapterContent,
} from '@/app/reader/utils/notebookChapters';
import { flushNotebookDocument } from '../../hooks/useNotebookDocumentCoordinator';
import RichNotebookEditor, { RichNotebookEditorRef } from './RichNotebookEditor';
import NotebookChapterSelector from './NotebookChapterSelector';

interface NotebookEditorProps {
  bookKey: string;
  handleOpenAnnotations: () => void;
  excerpts: BookNote[];
  onDeleteExcerpt: (excerpt: BookNote) => void;
  toc?: TOCItem[];
}

const NotebookEditor: React.FC<NotebookEditorProps> = ({
  bookKey,
  handleOpenAnnotations,
  excerpts,
  onDeleteExcerpt,
  toc = [],
}) => {
  const _ = useTranslation();
  const bookHash = bookKey.split('-')[0]!;
  const session = useNotebookDocumentStore((state) => state.sessions[bookHash]);
  const mutate = useNotebookDocumentStore((state) => state.mutate);
  const chooseRecovery = useNotebookDocumentStore((state) => state.chooseRecovery);
  const currentReadingCfi = useBookDataStore((state) => state.getConfig(bookKey)?.location);
  const editorRef = useRef<RichNotebookEditorRef>(null);

  const [selectedChapterKey, setSelectedChapterKey] = useState<string>(ALL_CHAPTERS_KEY);

  const flatChapters = useMemo(() => flattenToc(toc), [toc]);

  const selectedChapterTitle = useMemo(() => {
    if (selectedChapterKey === ALL_CHAPTERS_KEY || selectedChapterKey === GENERAL_NOTES_KEY) {
      return '';
    }
    return flatChapters.find((f) => f.key === selectedChapterKey)?.label || '';
  }, [flatChapters, selectedChapterKey]);

  const parsedDoc = useMemo(() => parseChapterSections(session?.content ?? ''), [session?.content]);

  const hasNotesByChapter = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (parsedDoc.general) {
      map[GENERAL_NOTES_KEY] = true;
    }
    for (const sec of parsedDoc.sections) {
      if (sec.content.trim()) {
        map[sec.key] = true;
      }
    }
    return map;
  }, [parsedDoc]);

  const { filteredExcerpts, excerptsCountByChapter } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const exc of excerpts) {
      const matched = matchExcerptChapter(toc, exc.cfi);
      const key = matched ? getTocItemKey(matched) : GENERAL_NOTES_KEY;
      counts[key] = (counts[key] || 0) + 1;
    }

    if (selectedChapterKey === ALL_CHAPTERS_KEY) {
      return { filteredExcerpts: excerpts, excerptsCountByChapter: counts };
    }

    if (selectedChapterKey === GENERAL_NOTES_KEY) {
      const filtered = excerpts.filter((exc) => !matchExcerptChapter(toc, exc.cfi));
      return { filteredExcerpts: filtered, excerptsCountByChapter: counts };
    }

    const filtered = excerpts.filter((exc) => {
      const matched = matchExcerptChapter(toc, exc.cfi);
      return matched && getTocItemKey(matched) === selectedChapterKey;
    });

    return { filteredExcerpts: filtered, excerptsCountByChapter: counts };
  }, [excerpts, selectedChapterKey, toc]);

  const buildCitationLabel = (excerpt: BookNote) => {
    const chapter = findTocItemBS(toc, excerpt.cfi)?.label;
    const page = excerpt.page && excerpt.page > 0 ? excerpt.page : null;
    if (chapter && page) return `${chapter} · ${_('Page {{number}}', { number: page })}`;
    if (chapter) return chapter;
    if (page) return _('Page {{number}}', { number: page });
    return _('Source');
  };

  const citations = useMemo<NotebookCitationSource[]>(() => {
    return filteredExcerpts
      .filter((excerpt) => excerpt.cfi && excerpt.text)
      .map((excerpt) => ({
        id: excerpt.id,
        label: buildCitationLabel(excerpt),
        text: excerpt.text ?? '',
        cfi: excerpt.cfi,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredExcerpts, toc]);

  if (!session) return null;

  const currentEditorContent = getChapterContent(session.content, selectedChapterKey);

  const applyContent = (value: string) => {
    const updatedMaster = updateChapterContent(
      session.content,
      selectedChapterKey,
      selectedChapterTitle,
      value,
    );
    const result = mutate(bookHash, updatedMaster);
    if (!result.accepted) {
      const accepted = useNotebookDocumentStore.getState().sessions[bookHash]?.content ?? '';
      const revertedContent = getChapterContent(accepted, selectedChapterKey);
      editorRef.current?.setMarkdown(revertedContent);
    }
  };

  const placeholder = (() => {
    if (selectedChapterKey === ALL_CHAPTERS_KEY) {
      return _('Start writing about this book…');
    }
    if (selectedChapterKey === GENERAL_NOTES_KEY) {
      return _('General notes about this book…');
    }
    return _('Write notes for {{chapter}}…', { chapter: selectedChapterTitle });
  })();

  const status = (() => {
    if (session.status === 'saving') return _('Saving…');
    if (session.status === 'error') return _("Couldn't save");
    if (session.status === 'waiting-for-position') return _('Waiting for a valid book position');
    if (session.status === 'clean' && session.hasEdited) return _('Saved');
    return '';
  })();

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2 px-3 pb-2'>
      {toc.length > 0 && (
        <NotebookChapterSelector
          toc={toc}
          selectedChapterKey={selectedChapterKey}
          onSelectChapter={setSelectedChapterKey}
          excerptsCountByChapter={excerptsCountByChapter}
          hasNotesByChapter={hasNotesByChapter}
          currentReadingCfi={currentReadingCfi}
        />
      )}

      {session.status === 'recovery-choice' && (
        <div className='eink-bordered bg-base-100 rounded-lg border p-3 text-sm'>
          <p>{_('Unsaved Notebook changes conflict with the latest saved version.')}</p>
          <div className='mt-2 flex justify-end gap-2' dir='ltr'>
            <button
              type='button'
              className='eink-bordered btn btn-ghost h-8 min-h-8 px-3'
              onClick={() => chooseRecovery(bookHash, 'latest')}
            >
              {_('Use latest saved')}
            </button>
            <button
              type='button'
              className='btn btn-contrast h-8 min-h-8 px-3'
              onClick={() => chooseRecovery(bookHash, 'recover')}
            >
              {_('Recover draft')}
            </button>
          </div>
        </div>
      )}

      {filteredExcerpts.length > 0 && (
        <section className='shrink-0' aria-labelledby='notebook-excerpts-heading'>
          <h2 id='notebook-excerpts-heading' className='content font-size-base mb-1'>
            {_('Excerpts')}
          </h2>
          <ul className='max-h-48 overflow-y-auto'>
            {filteredExcerpts.map((excerpt) => (
              <li key={excerpt.id} className='mb-2'>
                <details className='booknote-item eink-bordered border-base-300 bg-base-100 group rounded-lg border'>
                  <summary className='focus-visible:ring-base-content/15 flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium focus-visible:outline-hidden focus-visible:ring-2'>
                    <span className='line-clamp-1 min-w-0 flex-1'>{excerpt.text}</span>
                    <PiCaretDown
                      aria-hidden='true'
                      className='size-4 shrink-0 transition-transform group-open:rotate-180'
                    />
                  </summary>
                  <div className='font-size-xs select-text px-3 pb-2'>
                    <p className='hyphens-auto text-justify'>{excerpt.text}</p>
                    <div className='flex justify-end' dir='ltr'>
                      <button
                        type='button'
                        aria-label={_('Delete')}
                        onClick={() => onDeleteExcerpt(excerpt)}
                        className='eink-bordered btn btn-ghost h-8 min-h-8 px-2 text-xs font-normal max-sm:h-11 max-sm:min-h-11'
                      >
                        {_('Delete')}
                      </button>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className='eink-bordered bg-base-100 flex min-h-0 flex-1 flex-col rounded-lg border'>
        <RichNotebookEditor
          ref={editorRef}
          bookKey={bookKey}
          content={currentEditorContent}
          citations={citations}
          onChange={applyContent}
          onSave={() => void flushNotebookDocument(bookKey)}
          onBlur={() => void flushNotebookDocument(bookKey)}
          placeholder={placeholder}
          ariaLabel={_('Notebook')}
        />
      </div>

      <div className='flex min-h-8 flex-wrap items-center gap-2 text-xs'>
        <button
          type='button'
          onClick={handleOpenAnnotations}
          className='eink-bordered btn btn-ghost h-8 min-h-8 gap-1 px-2 text-xs font-normal max-sm:h-11 max-sm:min-h-11'
        >
          <PiNotePencil size={16} />
          {_('All notes')}
        </button>
        <span className='text-error flex-1'>
          {session.error === 'size-limit'
            ? _('Notebook is too large to save. Copy or remove some text to continue.')
            : !session.recoveryAvailable && session.revision > session.savedRevision
              ? _('Notebook recovery is unavailable. Keep this book open until it saves.')
              : ''}
        </span>
        <span role='status' aria-live='polite' className='text-base-content/60 ms-auto shrink-0'>
          {status}
        </span>
      </div>
    </div>
  );
};

export default NotebookEditor;
