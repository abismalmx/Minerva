import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PiSparkleFill } from 'react-icons/pi';

import Popup from '@/components/Popup';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { Position } from '@/utils/sel';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { GeminiApiError, GeminiProvider } from '@/services/ai/providers/GeminiProvider';
import type { AISettings, GeminiReadingAction, GeminiReadingContext } from '@/services/ai/types';
import {
  GEMINI_API_STUDIO_URL,
  GEMINI_HANDOFF_INSTRUCTIONS,
  dispatchGeminiHandoff,
} from '../../utils/geminiIntent';
import { parseGeminiAnswer } from '../../utils/geminiAnswer';
import { openExternalUrl } from '@/utils/open';
import { eventDispatcher } from '@/utils/event';

type GeminiErrorKind = 'offline' | 'auth' | 'quota' | 'unknown';

interface GeminiErrorState {
  kind: GeminiErrorKind;
  message: string;
}

/**
 * Classify a failure so the HUD can offer the right escape hatch: a missing
 * connection, a rejected key and an exhausted quota each need a different
 * next step.
 */
const classifyGeminiError = (error: unknown): GeminiErrorState => {
  if (error instanceof GeminiApiError) {
    if (error.isAuthError) return { kind: 'auth', message: error.message };
    if (error.isQuotaError) return { kind: 'quota', message: error.message };
    return { kind: 'unknown', message: error.message };
  }
  if (error instanceof TypeError) {
    // `fetch` rejects with a TypeError for DNS failures, refused connections
    // and offline devices alike.
    return { kind: 'offline', message: error.message };
  }
  return { kind: 'unknown', message: error instanceof Error ? error.message : String(error) };
};

interface GeminiReadingPopupProps {
  text: string;
  bookTitle: string;
  author?: string;
  currentPage?: number;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  /** The action the HUD opens with. */
  initialAction?: GeminiReadingAction;
  /** Start without a request, with the question box focused (`ask` mode). */
  autoStart?: boolean;
  /** Persist the answer as a note on the selection. */
  onSaveNote?: (answer: string) => void;
  /** Open the settings so the reader can paste an API key. */
  onOpenSettings?: () => void;
  onDismiss: () => void;
}

const GeminiReadingPopup: React.FC<GeminiReadingPopupProps> = ({
  text,
  bookTitle,
  author,
  currentPage,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  initialAction = 'explain',
  autoStart = true,
  onSaveNote,
  onOpenSettings,
  onDismiss,
}) => {
  const _ = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const aiSettings: AISettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;
  const apiKey = (aiSettings.geminiApiKey ?? '').trim();
  const handoffMode = aiSettings.geminiHandoffMode ?? 'external-app';
  const inAppBrowser = handoffMode === 'in-app-browser';
  // The two surfaces are different things, so the button says which one it
  // opens: the Gemini app on the system, or Gemini inside Minerva.
  const handoffLabel = inAppBrowser ? _('Open in Gemini') : _('Open in Gemini app');

  const [action, setAction] = useState<GeminiReadingAction>(initialAction);
  const [question, setQuestion] = useState('');
  const [askedQuestion, setAskedQuestion] = useState<string | undefined>(undefined);
  /**
   * Whether the reader has asked something.
   *
   * In `ask` mode the popup waits for the reader's own question, so changing
   * the shortcut must not start a request on its own: an unasked question
   * would spend the reader's Gemini quota without them having asked for it.
   */
  const [hasAsked, setHasAsked] = useState(false);
  const [runToken, setRunToken] = useState(0);
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const [error, setError] = useState<GeminiErrorState | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);

  const provider = useMemo(
    () =>
      new GeminiProvider({
        ...DEFAULT_AI_SETTINGS,
        geminiApiKey: apiKey,
        geminiModel: aiSettings.geminiModel,
      }),
    [apiKey, aiSettings.geminiModel],
  );

  const context: GeminiReadingContext = useMemo(
    () => ({ bookTitle, author, currentPage }),
    [bookTitle, author, currentPage],
  );

  // Every run replaces the previous one: the old request is aborted so the
  // network stops paying for an answer nobody will read.
  useEffect(() => {
    if (!apiKey) {
      setStatus('idle');
      return;
    }
    if (!autoStart && !hasAsked) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setAnswer('');
    setError(null);
    setStatus('streaming');

    void (async () => {
      try {
        await provider.streamExplanation(
          text,
          action,
          context,
          (delta) => {
            setAnswer((prev) => prev + delta);
          },
          controller.signal,
          askedQuestion,
        );
        if (!controller.signal.aborted) setStatus('done');
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(classifyGeminiError(e));
        setStatus('error');
      }
    })();

    return () => {
      controller.abort();
    };
  }, [action, askedQuestion, hasAsked, runToken, provider, text, context, apiKey, autoStart]);

  // A page turn, a tap outside or a dismissal must free the request at once.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (autoStart) return;
    questionInputRef.current?.focus();
  }, [autoStart]);

  const blocks = useMemo(() => parseGeminiAnswer(answer), [answer]);

  const handleActionChange = useCallback((next: GeminiReadingAction) => {
    setAction(next);
    setRunToken((token) => token + 1);
  }, []);

  const handleAskSubmit = useCallback(() => {
    const trimmed = question.trim();
    setHasAsked(true);
    setAskedQuestion(trimmed || undefined);
    setRunToken((token) => token + 1);
  }, [question]);

  const handleSave = useCallback(() => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    onSaveNote?.(trimmed);
  }, [answer, onSaveNote]);

  // The offline escape hatch: keep the passage itself as a note, without an
  // explanation, so the reader can come back to it later.
  const handleSaveSelection = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSaveNote?.(trimmed);
  }, [text, onSaveNote]);

  // Hand-off to Gemini itself. The reader picks the surface in the AI
  // settings: Minerva's own webview (companion window on desktop, native
  // browser sheet on mobile) or the operating system's browser.
  const handleOpenGemini = useCallback(async () => {
    try {
      await dispatchGeminiHandoff(text, action, {
        mode: handoffMode,
        instruction: _(GEMINI_HANDOFF_INSTRUCTIONS[action]),
        translate: _,
      });
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Could not open Gemini'),
        timeout: 3000,
      });
    }
  }, [text, action, handoffMode, _]);
  const actionPills: { value: GeminiReadingAction; label: string }[] = [
    { value: 'explain', label: _('Simplify') },
    { value: 'context', label: _('Context') },
    { value: 'character', label: _('Who is this?') },
  ];

  const hasKey = apiKey.length > 0;
  const canSave = answer.trim().length > 0;

  return (
    <Popup
      trianglePosition={trianglePosition}
      width={popupWidth}
      minHeight={popupHeight}
      position={position}
      className='flex flex-col overflow-hidden rounded-lg'
      onDismiss={onDismiss}
    >
      <div className='flex shrink-0 items-center justify-between gap-2 border-b border-base-content/10 px-3 py-2'>
        <div className='flex min-w-0 items-center gap-1.5'>
          <PiSparkleFill className='text-primary size-4 shrink-0' aria-hidden='true' />
          <span className='truncate text-sm font-medium'>Gemini</span>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {actionPills.map((pill) => (
            <button
              key={pill.value}
              type='button'
              onClick={() => handleActionChange(pill.value)}
              aria-pressed={action === pill.value}
              className={clsx(
                'rounded-md px-2 py-1 text-xs transition-colors',
                'eink-bordered',
                action === pill.value
                  ? 'bg-primary text-primary-content'
                  : 'bg-base-200 text-base-content/80 hover:bg-base-300',
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-3 py-2 select-text'>
        <p
          className='text-base-content/70 line-clamp-2 border-l-2 border-base-content/20 pl-2 text-xs italic'
          title={text}
        >
          &quot;{text}&quot;
        </p>

        <div className='mt-2 flex items-center gap-2'>
          <input
            ref={questionInputRef}
            type='text'
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAskSubmit();
              }
            }}
            placeholder={_('Ask Gemini about this selection...')}
            className='bg-base-200 text-base-content placeholder:text-base-content/40 border-base-300 focus:border-primary focus:ring-primary eink-bordered min-w-0 flex-1 rounded-md border px-2 py-1 text-sm transition-all focus:outline-hidden focus:ring-1'
          />
          <button
            type='button'
            onClick={handleAskSubmit}
            className='btn btn-sm btn-contrast shrink-0 px-2 font-medium'
          >
            {_('Ask')}
          </button>
        </div>

        {!hasKey ? (
          <div className='mt-3 space-y-2'>
            <p className='text-sm'>{_('Add a free Gemini key to use the reading assistant.')}</p>
            <div className='flex flex-wrap items-center gap-2'>
              <button
                type='button'
                onClick={() => openExternalUrl(GEMINI_API_STUDIO_URL)}
                className='btn btn-sm btn-outline'
              >
                {_('Get Key')}
              </button>
              {onOpenSettings && (
                <button type='button' onClick={onOpenSettings} className='btn btn-sm btn-outline'>
                  {_('Settings')}
                </button>
              )}
              <button type='button' onClick={handleOpenGemini} className='btn btn-sm btn-ghost'>
                {handoffLabel}
              </button>
            </div>
          </div>
        ) : error ? (
          <div className='mt-3 space-y-2'>
            <p className='text-sm text-error'>
              {error.kind === 'offline'
                ? _('No connection. Check your network and try again.')
                : error.kind === 'auth'
                  ? _('Gemini rejected the API key. Check it in the settings.')
                  : error.kind === 'quota'
                    ? _('The Gemini quota for this key is exhausted. Try again later.')
                    : _('Gemini could not answer right now.')}
            </p>
            <div className='flex flex-wrap items-center gap-2'>
              <button
                type='button'
                onClick={() => setRunToken((token) => token + 1)}
                className='btn btn-sm btn-outline'
              >
                {_('Retry')}
              </button>
              {onOpenSettings && error.kind === 'auth' && (
                <button type='button' onClick={onOpenSettings} className='btn btn-sm btn-ghost'>
                  {_('Settings')}
                </button>
              )}
              {error.kind === 'offline' && (
                // No answer to keep, but the passage itself is worth keeping:
                // save it as a plain note and read on (BACKEND_SPEC_2 §4.1).
                <button
                  type='button'
                  onClick={handleSaveSelection}
                  className='btn btn-sm btn-ghost'
                >
                  {_('Save selection as note')}
                </button>
              )}
              <button type='button' onClick={handleOpenGemini} className='btn btn-sm btn-ghost'>
                {handoffLabel}
              </button>
            </div>
          </div>
        ) : status === 'idle' ? (
          <p className='text-base-content/60 mt-3 text-sm'>
            {_('Ask a question, or pick one of the shortcuts above.')}
          </p>
        ) : (
          <div className='mt-3 space-y-1 text-sm'>
            {blocks.map((block, index) =>
              block.kind === 'bullet' ? (
                <p key={index} className='flex gap-1.5'>
                  <span aria-hidden='true' className='text-primary shrink-0'>
                    •
                  </span>
                  <span className='min-w-0'>{block.text}</span>
                </p>
              ) : (
                <p key={index} className='text-base-content/85'>
                  {block.text}
                </p>
              ),
            )}
            {status === 'streaming' && blocks.length === 0 && (
              <p className='text-base-content/60 italic'>{_('Loading...')}</p>
            )}
          </div>
        )}
      </div>

      <div className='flex shrink-0 items-center justify-between gap-2 border-t border-base-content/10 px-3 py-2'>
        <button
          type='button'
          onClick={handleOpenGemini}
          className='btn btn-sm btn-ghost px-2 font-medium'
        >
          {handoffLabel}
        </button>
        <button
          type='button'
          onClick={handleSave}
          disabled={!canSave}
          className='btn btn-sm btn-contrast px-2 font-medium'
        >
          {_('Save as note')}
        </button>
      </div>
    </Popup>
  );
};

export default GeminiReadingPopup;
