import { Mark, mergeAttributes } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline';
import { NOTEBOOK_CFI_SCHEME } from '@/app/reader/utils/notebookCitation';

/**
 * Pastel highlight palette.
 *
 * The colour names are part of the durable Markdown contract
 * (`<mark data-color="mint">…</mark>`), so they must stay stable: renaming
 * one would silently drop the colour of every already saved highlight.
 */
export const NOTEBOOK_HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'mint', label: 'Mint' },
  { id: 'blue', label: 'Blue' },
  { id: 'coral', label: 'Coral' },
] as const;

export type NotebookHighlightColor = (typeof NOTEBOOK_HIGHLIGHT_COLORS)[number]['id'];

const HIGHLIGHT_COLOR_IDS = new Set<string>(NOTEBOOK_HIGHLIGHT_COLORS.map((color) => color.id));

/** Whether a colour name belongs to the notebook palette. */
export const isNotebookHighlightColor = (value: string): value is NotebookHighlightColor =>
  HIGHLIGHT_COLOR_IDS.has(value);

/**
 * markdown-it instances are reused by the Markdown extension and its parse
 * hook runs on every `setContent`. Registering the rules once per instance
 * keeps the inline ruler from growing with every parse. Each rule family
 * tracks its own instances so one family cannot suppress the other.
 */
const registeredHighlightParsers = new WeakSet<object>();
const registeredCitationParsers = new WeakSet<object>();

const MARK_OPEN_PATTERN = /^<mark data-color="([a-z]+)">/;
const MARK_CLOSE_TAG = '</mark>';
const HIGHLIGHT_EQUALS_PATTERN = /^==(?!\s)([^=]*[^=\s])(==)/;

/**
 * `<mark data-color="mint">text</mark>` — the coloured variant of the
 * notebook highlight. Only palette colours are accepted, so the rule can
 * never smuggle arbitrary HTML into the rendered document.
 */
const parseHighlightTag = (state: StateInline, silent: boolean): boolean => {
  if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
  const match = MARK_OPEN_PATTERN.exec(state.src.slice(state.pos));
  if (!match) return false;
  const color = match[1]!;
  if (!isNotebookHighlightColor(color)) return false;
  const contentStart = state.pos + match[0].length;
  const contentEnd = state.src.indexOf(MARK_CLOSE_TAG, contentStart);
  if (contentEnd === -1) return false;
  if (!silent) {
    const open = state.push('mark_open', 'mark', 1);
    open.markup = '<mark>';
    open.info = color;
    state.md.inline.parse(
      state.src.slice(contentStart, contentEnd),
      state.md,
      state.env,
      state.tokens,
    );
    const close = state.push('mark_close', 'mark', -1);
    close.markup = MARK_CLOSE_TAG;
    close.info = color;
  }
  state.pos = contentEnd + MARK_CLOSE_TAG.length;
  return true;
};

/** `==text==` — the colourless variant of the notebook highlight. */
const parseHighlightEquals = (state: StateInline, silent: boolean): boolean => {
  if (state.src.charCodeAt(state.pos) !== 0x3d /* = */) return false;
  const match = HIGHLIGHT_EQUALS_PATTERN.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const open = state.push('mark_open', 'mark', 1);
    open.markup = '==';
    open.info = '';
    state.md.inline.parse(match[1]!, state.md, state.env, state.tokens);
    const close = state.push('mark_close', 'mark', -1);
    close.markup = '==';
    close.info = '';
  }
  state.pos += match[0].length;
  return true;
};

/** Registers the `==…==` and `<mark data-color="…">` inline rules. */
const setupHighlightMarkdown = (md: MarkdownIt): void => {
  if (registeredHighlightParsers.has(md)) return;
  registeredHighlightParsers.add(md);
  md.inline.ruler.before('emphasis', 'notebook_highlight_tag', parseHighlightTag);
  md.inline.ruler.before('emphasis', 'notebook_highlight_equals', parseHighlightEquals);
  md.renderer.rules['mark_open'] = (tokens, idx) => {
    const color = tokens[idx]!.info;
    return color ? `<mark data-color="${color}">` : '<mark>';
  };
  md.renderer.rules['mark_close'] = () => MARK_CLOSE_TAG;
};

/**
 * Turns a `minerva-cfi:` link target into a `data-cfi` attribute.
 *
 * The citation must not be a plain web link: the reader only accepts a fixed
 * set of protocols, and the CFI has to survive as a dedicated attribute so
 * the editor can jump to it.
 */
const setupCitationMarkdown = (md: MarkdownIt): void => {
  if (registeredCitationParsers.has(md)) return;
  registeredCitationParsers.add(md);
  const fallback = md.renderer.rules['link_open'];
  md.renderer.rules['link_open'] = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const href = token.attrGet('href');
    if (href && href.startsWith(NOTEBOOK_CFI_SCHEME)) {
      token.attrs = [['data-cfi', href.slice(NOTEBOOK_CFI_SCHEME.length)]];
    }
    return fallback
      ? fallback(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
};

/**
 * Highlight mark with a named pastel colour.
 *
 * The stock extension renders the colour as an inline `background-color`
 * style, which cannot follow the Minerva themes (a fixed pastel wash is
 * unreadable on the dark palette) and cannot be expressed on e-ink screens.
 * The colour is kept as a data attribute instead and resolved by CSS.
 */
export const NotebookHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-color'),
        renderHTML: (attributes) => {
          const color = attributes['color'] as string | null;
          if (!color) return {};
          return {
            'data-color': color,
            class: `notebook-highlight notebook-highlight-${color}`,
          };
        },
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: Record<string, unknown> }) => {
            const color = mark.attrs['color'] as string | null;
            return color ? `<mark data-color="${color}">` : '==';
          },
          close: (_state: unknown, mark: { attrs: Record<string, unknown> }) => {
            const color = mark.attrs['color'] as string | null;
            return color ? MARK_CLOSE_TAG : '==';
          },
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup: setupHighlightMarkdown,
        },
      },
    };
  },
});

/**
 * Link to a position in the book, addressed by EPUB CFI.
 *
 * The mark renders as a chip without an `href`, so it never competes with
 * the plain web links the reader allows — and the CFI travels inside the
 * Markdown source as `minerva-cfi:` link target.
 */
export const BookLink = Mark.create({
  name: 'bookLink',
  inclusive: false,
  addAttributes() {
    return {
      cfi: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-cfi'),
        renderHTML: (attributes) => {
          const cfi = attributes['cfi'] as string | null;
          return cfi ? { 'data-cfi': cfi } : {};
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-cfi]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes({ class: 'notebook-citation' }, HTMLAttributes), 0];
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: '[',
          close: (_state: unknown, mark: { attrs: Record<string, unknown> }) => {
            const cfi = mark.attrs['cfi'] as string | null;
            return `](${NOTEBOOK_CFI_SCHEME}${cfi ?? ''})`;
          },
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup: setupCitationMarkdown,
        },
      },
    };
  },
});
