import clsx from 'clsx';
import React from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  PiCaretDown,
  PiHighlighter,
  PiListBullets,
  PiListNumbers,
  PiQuotes,
  PiTextB,
  PiTextHOne,
  PiTextHThree,
  PiTextHTwo,
  PiTextItalic,
  PiTextStrikethrough,
} from 'react-icons/pi';
import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';
import { useTranslation } from '@/hooks/useTranslation';
import type { NotebookCitationSource } from '@/app/reader/utils/notebookCitation';
import { NOTEBOOK_HIGHLIGHT_COLORS } from './extensions/notebookMarkdownExtensions';

interface NotebookToolbarProps {
  editor: Editor | null;
  citations: NotebookCitationSource[];
  onInsertCitation: (citation: NotebookCitationSource) => void;
}

interface NotebookMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
  menuClassName?: string;
  children: React.ReactNode;
}

/** Menu panel of the toolbar dropdowns. */
const NotebookMenu: React.FC<NotebookMenuProps> = ({
  setIsDropdownOpen,
  menuClassName,
  children,
}) => (
  <Menu
    className={clsx('notebook-toolbar-menu dropdown-content z-20 shadow-2xl', menuClassName)}
    onCancel={() => setIsDropdownOpen?.(false)}
  >
    {children}
  </Menu>
);

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}) => (
  <button
    type='button'
    aria-label={label}
    aria-pressed={active}
    title={label}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
    className={clsx(
      'eink-bordered btn btn-ghost h-8 min-h-8 w-8 shrink-0 p-0 font-normal max-sm:h-11 max-sm:min-h-11 max-sm:w-11',
      active && 'bg-base-300 text-base-content',
    )}
  >
    {children}
  </button>
);

const NotebookToolbar: React.FC<NotebookToolbarProps> = ({
  editor,
  citations,
  onInsertCitation,
}) => {
  const _ = useTranslation();

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      isParagraph: instance?.isActive('paragraph') ?? false,
      isHeading1: instance?.isActive('heading', { level: 1 }) ?? false,
      isHeading2: instance?.isActive('heading', { level: 2 }) ?? false,
      isHeading3: instance?.isActive('heading', { level: 3 }) ?? false,
      isBold: instance?.isActive('bold') ?? false,
      isItalic: instance?.isActive('italic') ?? false,
      isStrike: instance?.isActive('strike') ?? false,
      isBulletList: instance?.isActive('bulletList') ?? false,
      isOrderedList: instance?.isActive('orderedList') ?? false,
      isBlockquote: instance?.isActive('blockquote') ?? false,
      highlightColor: (instance?.getAttributes('highlight')['color'] as string | null) ?? null,
    }),
  });

  const styleLabel = state?.isHeading1
    ? _('Heading 1')
    : state?.isHeading2
      ? _('Heading 2')
      : state?.isHeading3
        ? _('Heading 3')
        : _('Text');

  const applyHighlight = (color: string | null) => {
    if (!editor) return;
    if (!color) {
      editor.chain().focus().unsetHighlight().run();
      return;
    }
    editor.chain().focus().toggleHighlight({ color }).run();
  };

  return (
    <div
      className='notebook-toolbar flex flex-wrap items-center gap-1 border-b border-base-300 px-1 py-1'
      role='toolbar'
      aria-label={_('Notebook formatting')}
    >
      <Dropdown
        label={_('Text style')}
        toggleButton={
          <span className='flex items-center gap-1 text-xs'>
            <span>{styleLabel}</span>
            <PiCaretDown aria-hidden='true' className='size-3' />
          </span>
        }
        buttonClassName='eink-bordered btn btn-ghost h-8 min-h-8 gap-1 px-2 text-xs font-normal max-sm:h-11 max-sm:min-h-11'
        disabled={!editor}
      >
        <NotebookMenu>
          <MenuItem
            label={_('Text')}
            toggled={state?.isParagraph}
            transient
            onClick={() => editor?.chain().focus().setParagraph().run()}
          />
          <MenuItem
            label={_('Heading 1')}
            Icon={PiTextHOne}
            toggled={state?.isHeading1}
            transient
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <MenuItem
            label={_('Heading 2')}
            Icon={PiTextHTwo}
            toggled={state?.isHeading2}
            transient
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <MenuItem
            label={_('Heading 3')}
            Icon={PiTextHThree}
            toggled={state?.isHeading3}
            transient
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          />
        </NotebookMenu>
      </Dropdown>

      <div className='bg-base-300 mx-0.5 h-5 w-px' aria-hidden='true' />

      <ToolbarButton
        label={_('Bold')}
        active={state?.isBold}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <PiTextB aria-hidden='true' size={16} />
      </ToolbarButton>
      <ToolbarButton
        label={_('Italic')}
        active={state?.isItalic}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <PiTextItalic aria-hidden='true' size={16} />
      </ToolbarButton>
      <ToolbarButton
        label={_('Strikethrough')}
        active={state?.isStrike}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <PiTextStrikethrough aria-hidden='true' size={16} />
      </ToolbarButton>

      <Dropdown
        label={_('Highlight')}
        toggleButton={
          <span
            className={clsx(
              'notebook-highlight-swatch',
              state?.highlightColor
                ? `notebook-highlight-${state.highlightColor}`
                : 'notebook-highlight-none',
            )}
            aria-hidden='true'
          />
        }
        buttonClassName='eink-bordered btn btn-ghost h-8 min-h-8 w-8 p-0 font-normal max-sm:h-11 max-sm:min-h-11 max-sm:w-11'
        disabled={!editor}
      >
        <NotebookMenu>
          {NOTEBOOK_HIGHLIGHT_COLORS.map((color) => (
            <MenuItem
              key={color.id}
              label={_(color.label)}
              Icon={
                <span
                  className={clsx('notebook-highlight-swatch', `notebook-highlight-${color.id}`)}
                  aria-hidden='true'
                />
              }
              transient
              onClick={() => applyHighlight(color.id)}
            />
          ))}
          <MenuItem label={_('No highlight')} transient onClick={() => applyHighlight(null)} />
        </NotebookMenu>
      </Dropdown>

      <div className='bg-base-300 mx-0.5 h-5 w-px' aria-hidden='true' />

      <ToolbarButton
        label={_('Bulleted list')}
        active={state?.isBulletList}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <PiListBullets aria-hidden='true' size={16} />
      </ToolbarButton>
      <ToolbarButton
        label={_('Numbered list')}
        active={state?.isOrderedList}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <PiListNumbers aria-hidden='true' size={16} />
      </ToolbarButton>
      <ToolbarButton
        label={_('Quote')}
        active={state?.isBlockquote}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <PiQuotes aria-hidden='true' size={16} />
      </ToolbarButton>

      <div className='bg-base-300 mx-0.5 h-5 w-px' aria-hidden='true' />

      {citations.length > 0 ? (
        <Dropdown
          label={_('Quote from the book')}
          toggleButton={<PiHighlighter aria-hidden='true' size={16} />}
          buttonClassName='eink-bordered btn btn-ghost h-8 min-h-8 w-8 p-0 font-normal max-sm:h-11 max-sm:min-h-11 max-sm:w-11'
          disabled={!editor}
        >
          <NotebookMenu>
            {citations.map((citation) => (
              <MenuItem
                key={citation.id}
                label={citation.label}
                description={citation.text}
                transient
                onClick={() => onInsertCitation(citation)}
              />
            ))}
          </NotebookMenu>
        </Dropdown>
      ) : (
        <ToolbarButton label={_('Quote from the book')} disabled onClick={() => undefined}>
          <PiHighlighter aria-hidden='true' size={16} />
        </ToolbarButton>
      )}
    </div>
  );
};

export default NotebookToolbar;
