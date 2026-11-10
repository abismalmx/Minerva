import type { AnnotationToolType } from '@/types/annotator';
import { BookFormat, FIXED_LAYOUT_FORMATS } from '@/types/book';

// Proofread rewrites the rendered text through the content transformers, which
// every reflowable format runs (Markdown wires the same pipeline in utils/md.ts
// without an EPUB conversion). Only the fixed-layout formats are out: they
// render pages, not text. The toolbar button used to require EPUB, the sole
// format the feature shipped for (#2725).
export const supportsProofread = (format: BookFormat | undefined): boolean =>
  !!format && !FIXED_LAYOUT_FORMATS.has(format);

// Canonical order of every annotation tool. Kept in sync with
// `annotationToolButtons` in AnnotationTools.tsx (asserted by a unit test).
export const ALL_ANNOTATION_TOOL_TYPES: AnnotationToolType[] = [
  'copy',
  'copylink',
  'highlight',
  'annotate',
  'image',
  'search',
  'dictionary',
  'translate',
  'gemini',
  'tts',
  'proofread',
  'share',
  'quotecard',
];

// Default toolbar: tools shown on selection in canonical order.
export const DEFAULT_ANNOTATION_TOOLBAR_ITEMS: AnnotationToolType[] = [
  'copy',
  'highlight',
  'annotate',
  'image',
  'search',
  'dictionary',
  'translate',
  'gemini',
  'tts',
  'proofread',
];

// Legacy defaults before image or gemini was added to the default bar.
const LEGACY_DEFAULT_TOOLBAR_ITEMS_8: AnnotationToolType[] = [
  'copy',
  'highlight',
  'annotate',
  'search',
  'dictionary',
  'translate',
  'tts',
  'proofread',
];

const LEGACY_DEFAULT_TOOLBAR_ITEMS_9: AnnotationToolType[] = [
  'copy',
  'highlight',
  'annotate',
  'search',
  'dictionary',
  'translate',
  'gemini',
  'tts',
  'proofread',
];

const isLegacyDefault = (items: AnnotationToolType[]): boolean =>
  (items.length === LEGACY_DEFAULT_TOOLBAR_ITEMS_8.length &&
    items.every((tool, i) => tool === LEGACY_DEFAULT_TOOLBAR_ITEMS_8[i])) ||
  (items.length === LEGACY_DEFAULT_TOOLBAR_ITEMS_9.length &&
    items.every((tool, i) => tool === LEGACY_DEFAULT_TOOLBAR_ITEMS_9[i]));

// Drop unknown/duplicate entries; fall back to the default when unset (a
// pre-existing per-book config may not carry the field yet), or upgrade legacy defaults.
const sanitize = (items: AnnotationToolType[] | undefined): AnnotationToolType[] => {
  const source = !items || isLegacyDefault(items) ? DEFAULT_ANNOTATION_TOOLBAR_ITEMS : items;
  const seen = new Set<AnnotationToolType>();
  const out: AnnotationToolType[] = [];
  for (const type of source) {
    if (ALL_ANNOTATION_TOOL_TYPES.includes(type) && !seen.has(type)) {
      seen.add(type);
      out.push(type);
    }
  }
  return out;
};

// Visible tools to render in the live selection toolbar, in order.
export const getToolbarToolTypes = (
  items: AnnotationToolType[] | undefined,
  canShare: boolean,
): AnnotationToolType[] => sanitize(items).filter((type) => canShare || type !== 'share');

// One-tap highlighting (#5983): whenever the highlight tool is on the toolbar,
// the style/color strip shows as soon as text is selected, so picking a color
// needs no prior tap on Highlight. A popup-window selection without a CFI
// (synthesized footnote text) can't anchor a highlight and keeps the plain
// bar; an already-annotated selection always gets the strip, as before.
export const shouldShowHighlightOptions = (
  toolTypes: AnnotationToolType[],
  selection: { annotated?: boolean; popup?: boolean; cfi?: string } | null,
): boolean => {
  if (!selection) return false;
  if (selection.annotated) return true;
  return toolTypes.includes('highlight') && !(selection.popup && !selection.cfi);
};

// Hidden tools (the "Available" tray), in canonical order.
export const getAvailableToolTypes = (
  items: AnnotationToolType[] | undefined,
  canShare: boolean,
): AnnotationToolType[] => {
  const visible = new Set(sanitize(items));
  return ALL_ANNOTATION_TOOL_TYPES.filter(
    (type) => !visible.has(type) && (canShare || type !== 'share'),
  );
};

// Add `type` to the visible list at `atIndex` (default: end). No-op if present.
export const addToolToToolbar = (
  visible: AnnotationToolType[],
  type: AnnotationToolType,
  atIndex?: number,
): AnnotationToolType[] => {
  if (visible.includes(type)) return visible;
  const next = [...visible];
  next.splice(atIndex ?? next.length, 0, type);
  return next;
};

// Remove `type` from the visible list. No-op if absent.
export const removeToolFromToolbar = (
  visible: AnnotationToolType[],
  type: AnnotationToolType,
): AnnotationToolType[] => visible.filter((type_) => type_ !== type);

// Move `fromType` to where `toType` currently sits within the visible list.
export const reorderToolbar = (
  visible: AnnotationToolType[],
  fromType: AnnotationToolType,
  toType: AnnotationToolType,
): AnnotationToolType[] => {
  const from = visible.indexOf(fromType);
  const to = visible.indexOf(toType);
  if (from < 0 || to < 0 || from === to) return visible;
  const next = [...visible];
  const spliced = next.splice(from, 1);
  next.splice(to, 0, spliced[0]!);
  return next;
};
