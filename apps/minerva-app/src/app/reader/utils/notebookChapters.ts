import type { TOCItem } from '@/libs/document';
import { findTocItemBS } from '@/services/nav/lookup';

export const ALL_CHAPTERS_KEY = '__all__';
export const GENERAL_NOTES_KEY = '__general__';

export interface ChapterItem {
  key: string;
  label: string;
  depth: number;
  href?: string;
  cfi?: string;
}

export interface ChapterSection {
  key: string;
  title: string;
  content: string;
}

export interface ParsedNotebookDocument {
  general: string;
  sections: ChapterSection[];
}

export const getTocItemKey = (item: {
  href?: string;
  id?: string | number;
  label?: string;
  cfi?: string;
}): string => {
  return (
    item.href ||
    (item.id !== undefined && item.id !== null ? String(item.id) : '') ||
    item.cfi ||
    item.label ||
    ''
  );
};

/**
 * Flattens the hierarchical table of contents into an indented list.
 */
export const flattenToc = (toc: TOCItem[], depth = 0): ChapterItem[] => {
  const result: ChapterItem[] = [];
  toc.forEach((item, index) => {
    const key = getTocItemKey(item) || `chapter-${depth}-${index}`;
    result.push({
      key,
      label: item.label?.trim() || `Chapter ${index + 1}`,
      depth,
      href: item.href,
      cfi: item.cfi,
    });
    if (item.subitems && item.subitems.length > 0) {
      result.push(...flattenToc(item.subitems, depth + 1));
    }
  });
  return result;
};

/**
 * Finds all keys belonging to a chapter and any of its nested subchapters.
 */
export const getChapterAndDescendantKeys = (item: TOCItem): Set<string> => {
  const keys = new Set<string>();
  const add = (node: TOCItem) => {
    const key = getTocItemKey(node);
    if (key) keys.add(key);
    node.subitems?.forEach(add);
  };
  add(item);
  return keys;
};

/**
 * Finds which chapter an excerpt belongs to via its CFI.
 */
export const matchExcerptChapter = (toc: TOCItem[], cfi: string | undefined): TOCItem | null => {
  if (!cfi) return null;
  return findTocItemBS(toc, cfi);
};

const CHAPTER_MARKER_REGEX = /^<!--\s*minerva-chapter:([^\s:>]+)(?::([^\n>]*))?\s*-->\s*$/;

/**
 * Parses a notebook Markdown string into its general notes and chapter sections.
 */
export const parseChapterSections = (markdown: string): ParsedNotebookDocument => {
  if (!markdown) {
    return { general: '', sections: [] };
  }

  const lines = markdown.split('\n');
  const generalLines: string[] = [];
  const sections: ChapterSection[] = [];

  let currentSection: { key: string; title: string; lines: string[]; titleFound: boolean } | null =
    null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const markerMatch = line.match(CHAPTER_MARKER_REGEX);

    if (markerMatch) {
      if (currentSection) {
        sections.push({
          key: currentSection.key,
          title: currentSection.title,
          content: currentSection.lines.join('\n').trim(),
        });
      }
      const rawKey = markerMatch[1]!;
      const key = decodeURIComponent(rawKey);
      const titleHint = markerMatch[2] ? decodeURIComponent(markerMatch[2].trim()) : '';
      currentSection = {
        key,
        title: titleHint,
        lines: [],
        titleFound: false,
      };
      continue;
    }

    if (!currentSection) {
      generalLines.push(line);
    } else {
      // If we haven't seen a heading yet, check if this line is `# Title`
      if (!currentSection.titleFound && /^#+\s+/.test(line)) {
        currentSection.titleFound = true;
        if (!currentSection.title) {
          currentSection.title = line.replace(/^#+\s*/, '').trim();
        }
        continue;
      }
      currentSection.lines.push(line);
    }
  }

  if (currentSection) {
    sections.push({
      key: currentSection.key,
      title: currentSection.title,
      content: currentSection.lines.join('\n').trim(),
    });
  }

  return {
    general: generalLines.join('\n').trim(),
    sections,
  };
};

/**
 * Returns the markdown text to show in the editor for the selected chapter.
 */
export const getChapterContent = (markdown: string, chapterKey: string): string => {
  if (chapterKey === ALL_CHAPTERS_KEY) {
    return markdown;
  }
  const parsed = parseChapterSections(markdown);
  if (chapterKey === GENERAL_NOTES_KEY) {
    return parsed.general;
  }
  const section = parsed.sections.find((s) => s.key === chapterKey);
  return section ? section.content : '';
};

/**
 * Re-serializes the notebook document when notes in a specific chapter or view change.
 */
export const updateChapterContent = (
  currentMarkdown: string,
  chapterKey: string,
  chapterTitle: string,
  newContent: string,
): string => {
  if (chapterKey === ALL_CHAPTERS_KEY) {
    return newContent;
  }

  const parsed = parseChapterSections(currentMarkdown);

  if (chapterKey === GENERAL_NOTES_KEY) {
    parsed.general = newContent.trim();
  } else {
    const existingIndex = parsed.sections.findIndex((s) => s.key === chapterKey);
    const trimmed = newContent.trim();

    if (trimmed === '') {
      if (existingIndex >= 0) {
        parsed.sections.splice(existingIndex, 1);
      }
    } else if (existingIndex >= 0) {
      parsed.sections[existingIndex]!.content = trimmed;
      if (chapterTitle) {
        parsed.sections[existingIndex]!.title = chapterTitle;
      }
    } else {
      parsed.sections.push({
        key: chapterKey,
        title: chapterTitle || 'Chapter Notes',
        content: trimmed,
      });
    }
  }

  const parts: string[] = [];
  if (parsed.general) {
    parts.push(parsed.general);
  }
  for (const sec of parsed.sections) {
    if (sec.content) {
      const headerTitle = sec.title || 'Chapter Notes';
      parts.push(
        `<!-- minerva-chapter:${encodeURIComponent(sec.key)}:${encodeURIComponent(headerTitle)} -->\n# ${headerTitle}\n\n${sec.content}`,
      );
    }
  }

  return parts.join('\n\n');
};
