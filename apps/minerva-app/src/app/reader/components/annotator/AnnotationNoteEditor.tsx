import clsx from 'clsx';
import React, { useState } from 'react';
import { LuImagePlus } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import TextButton from '@/components/TextButton';
import TextEditor from '@/components/TextEditor';
import ImageSearchDialog, { SelectedImageData } from './ImageSearchDialog';

interface AnnotationNoteEditorProps {
  value: string;
  selectionText?: string;
  isVertical?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onSave: (note: string) => void;
  onCancel: () => void;
}

/**
 * The note editor the "Annotate" action opens on the selection itself — hosted
 * by the toolbar popup on desktop and by NoteEditorSheet on phone-sized
 * screens. Shares `booknote-note-editor` with the sidebar's inline editor so
 * both surfaces are drivable by the same tests; only one is ever presented at
 * a time.
 */
const AnnotationNoteEditor: React.FC<AnnotationNoteEditorProps> = ({
  value,
  selectionText,
  isVertical,
  className,
  style,
  onSave,
  onCancel,
}) => {
  const _ = useTranslation();
  const [draftText, setDraftText] = useState(value);
  const [showImageSearch, setShowImageSearch] = useState(false);

  const save = () => onSave(draftText);

  const handleSelectImage = (data: SelectedImageData) => {
    setShowImageSearch(false);
    let md = `![${data.title || _('Photo')}](${data.url})`;
    if (data.extract && data.includeExtract !== false) {
      md += `\n\n> ${data.extract}`;
    }
    setDraftText((prev) => (prev.trim() ? `${prev.trim()}\n\n${md}` : md));
  };

  return (
    // `content` carries the responsive base font size (16 / 18.4 / 20px) that
    // `font-size-sm` inside the editor is relative to. The sidebar's row has it
    // from `li.content`; without it here the popup and sheet fell back to the
    // root 16px and rendered a size smaller than the sidebar's editor.
    <div data-testid='booknote-note-editor' className={clsx('content', className)} style={style}>
      {/* The host sizes this editor (a fixed popup card, or 60% of the screen
          in the sheet), so the text area takes the slack and the action row
          stays pinned to the bottom edge instead of floating under a
          content-sized textarea. */}
      <div className={clsx('flex h-full min-h-0 gap-2 p-4', isVertical ? 'flex-row' : 'flex-col')}>
        <TextEditor
          value={draftText}
          onChange={setDraftText}
          onSave={save}
          onEscape={onCancel}
          className={clsx('min-h-0 flex-1 overflow-y-auto', isVertical && 'writing-vertical-rl')}
          placeholder={_('Add Note')}
          autoResize={false}
          spellCheck={false}
          autoFocus
        />
        <div
          className={clsx(
            'flex shrink-0 items-center justify-between gap-3',
            isVertical && 'flex-col',
          )}
          dir='ltr'
        >
          <button
            type='button'
            onClick={() => setShowImageSearch(true)}
            className='btn btn-ghost btn-xs text-base-content/70 hover:text-primary flex items-center gap-1.5'
            title={_('Search photo or attach image')}
          >
            <LuImagePlus size={16} />
            <span className='text-xs font-normal'>{_('Photo')}</span>
          </button>
          <div className='flex items-center gap-2'>
            <TextButton onClick={onCancel}>{_('Cancel')}</TextButton>
            <TextButton onClick={save}>{_('Save')}</TextButton>
          </div>
        </div>
      </div>

      {showImageSearch && (
        <ImageSearchDialog
          isOpen={showImageSearch}
          initialQuery={selectionText || ''}
          onSelectImage={handleSelectImage}
          onClose={() => setShowImageSearch(false)}
        />
      )}
    </div>
  );
};

export default AnnotationNoteEditor;
