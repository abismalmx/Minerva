/**
 * Parsing of the Gemini answer into the blocks the reading HUD renders.
 *
 * The prompt asks for two bullets and a closing line, so the model answers
 * with Markdown-ish text. Parsing it live — while it is still streaming — is
 * what lets the bullets appear one after another instead of as a wall of
 * text.
 */

/** A rendered piece of the answer: a bullet from the list, or a plain line. */
export interface GeminiAnswerBlock {
  kind: 'bullet' | 'line';
  text: string;
}

const BULLET_RE = /^(?:[-*•‣▪⁃])\s+(.*)$/;

export const parseGeminiAnswer = (raw: string): GeminiAnswerBlock[] => {
  const blocks: GeminiAnswerBlock[] = [];
  let current: GeminiAnswerBlock | null = null;

  const flush = () => {
    if (current && current.text.trim()) blocks.push(current);
    current = null;
  };

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const trimmed = line.trim();
    // An indented line continues the bullet above it; an unindented one
    // starts the closing line the prompt asks for.
    const indented = /^\s/.test(line);
    const bullet = BULLET_RE.exec(trimmed);
    if (bullet) {
      flush();
      current = { kind: 'bullet', text: bullet[1] ?? '' };
      continue;
    }
    if (current && (current.kind === 'line' || indented)) {
      current.text = `${current.text} ${trimmed}`;
      continue;
    }
    flush();
    current = { kind: 'line', text: trimmed };
  }
  flush();
  return blocks;
};
