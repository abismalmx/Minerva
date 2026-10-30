/**
 * The Gemini reading HUD: it streams the answer into the popup, offers the
 * save-as-note hand-off, and degrades gracefully when the key is missing or
 * the network is down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

afterEach(cleanup);

const mockStreamExplanation = vi.fn();
const mockDispatchGeminiHandoff = vi.fn();
const mockOpenExternalUrl = vi.fn();
let mockSettings: { aiSettings?: Record<string, unknown> } = {};

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: unknown }) => unknown) =>
    selector({ settings: mockSettings }),
}));

vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/utils/open', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

vi.mock('@/app/reader/utils/geminiIntent', () => ({
  GEMINI_API_STUDIO_URL: 'https://aistudio.google.com/apikey',
  GEMINI_HANDOFF_INSTRUCTIONS: {
    explain: 'Please explain and contextualize the following passage from the book:',
    context: 'Please give the historical and literary context of the following passage:',
    character: 'Please tell me who this character is and what they want in this scene:',
    ask: 'Please discuss the following passage with me:',
  },
  dispatchGeminiHandoff: (...args: unknown[]) => mockDispatchGeminiHandoff(...args),
}));

vi.mock('@/services/ai/providers/GeminiProvider', () => ({
  GeminiApiError: class GeminiApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'GeminiApiError';
      this.status = status;
    }
    get isAuthError() {
      return this.status === 401 || this.status === 403;
    }
    get isQuotaError() {
      return this.status === 429;
    }
  },
  GeminiProvider: class {
    streamExplanation = mockStreamExplanation;
    healthCheck = vi.fn().mockResolvedValue(true);
  },
}));

import GeminiReadingPopup from '@/app/reader/components/annotator/GeminiReadingPopup';

type PopupProps = React.ComponentProps<typeof GeminiReadingPopup>;

const renderPopup = (props: Partial<Omit<PopupProps, 'onDismiss'>> = {}) =>
  render(
    <GeminiReadingPopup
      text='It was the best of times.'
      bookTitle='A Tale of Two Cities'
      author='Charles Dickens'
      currentPage={12}
      position={{ point: { x: 0, y: 0 } }}
      trianglePosition={{ point: { x: 0, y: 0 }, dir: 'up' }}
      popupWidth={320}
      popupHeight={240}
      onDismiss={() => undefined}
      {...props}
    />,
  );

describe('GeminiReadingPopup', () => {
  beforeEach(() => {
    mockStreamExplanation.mockReset();
    mockDispatchGeminiHandoff.mockReset();
    mockDispatchGeminiHandoff.mockResolvedValue({ target: 'web' });
    mockOpenExternalUrl.mockReset();
    mockSettings = { aiSettings: { geminiApiKey: 'test-key', geminiModel: 'gemini-2.0-flash' } };
    mockStreamExplanation.mockImplementation(
      async (_text: string, _mode: string, _context: unknown, onChunk: (delta: string) => void) => {
        onChunk('- The city is in upheaval.\n');
        onChunk('- The narrator is ironic.\n');
        onChunk('In short, it is the opening of a famous novel.');
      },
    );
  });

  it('streams the answer into bullets and a closing line', async () => {
    renderPopup();

    await waitFor(() => {
      expect(screen.getByText('The city is in upheaval.')).toBeTruthy();
    });
    expect(screen.getByText('The narrator is ironic.')).toBeTruthy();
    expect(screen.getByText('In short, it is the opening of a famous novel.')).toBeTruthy();
  });

  it('asks the provider for the selected passage and the book context', async () => {
    renderPopup();

    await waitFor(() => expect(mockStreamExplanation).toHaveBeenCalled());
    const [text, mode, context] = mockStreamExplanation.mock.calls[0] as [
      string,
      string,
      { bookTitle: string; author?: string; currentPage?: number },
    ];
    expect(text).toBe('It was the best of times.');
    expect(mode).toBe('explain');
    expect(context).toEqual({
      bookTitle: 'A Tale of Two Cities',
      author: 'Charles Dickens',
      currentPage: 12,
    });
  });

  it('hands the answer to the save-as-note callback', async () => {
    const onSaveNote = vi.fn();
    renderPopup({ onSaveNote });

    await waitFor(() => expect(screen.getByText('The city is in upheaval.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save as note' }));

    expect(onSaveNote).toHaveBeenCalledWith(
      '- The city is in upheaval.\n- The narrator is ironic.\nIn short, it is the opening of a famous novel.',
    );
  });

  it('offers the key setup instead of calling the provider when no key is set', async () => {
    mockSettings = { aiSettings: { geminiApiKey: '' } };
    renderPopup();

    expect(
      await screen.findByText('Add a free Gemini key to use the reading assistant.'),
    ).toBeTruthy();
    expect(mockStreamExplanation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Get Key' }));
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://aistudio.google.com/apikey');
  });

  it('reports a network failure and offers a retry', async () => {
    mockStreamExplanation.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderPopup();

    expect(
      await screen.findByText('No connection. Check your network and try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('reports a rejected key and points at the settings', async () => {
    const { GeminiApiError } = await import('@/services/ai/providers/GeminiProvider');
    mockStreamExplanation.mockRejectedValueOnce(new GeminiApiError('bad key', 401));
    const onOpenSettings = vi.fn();
    renderPopup({ onOpenSettings });

    expect(
      await screen.findByText('Gemini rejected the API key. Check it in the settings.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('sends the selection to the official Gemini app', async () => {
    renderPopup();

    await waitFor(() => expect(mockStreamExplanation).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: 'Open in Gemini app' })[0]!);

    expect(mockDispatchGeminiHandoff).toHaveBeenCalledWith(
      'It was the best of times.',
      'explain',
      expect.objectContaining({
        mode: 'external-app',
        instruction: expect.any(String),
      }),
    );
  });

  it('opens Gemini inside Minerva when the reader chose the in-app browser', async () => {
    mockSettings = {
      aiSettings: {
        geminiApiKey: 'test-key',
        geminiModel: 'gemini-2.0-flash',
        geminiHandoffMode: 'in-app-browser',
      },
    };
    renderPopup();

    await waitFor(() => expect(mockStreamExplanation).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: 'Open in Gemini' })[0]!);

    expect(mockDispatchGeminiHandoff).toHaveBeenCalledWith(
      'It was the best of times.',
      'explain',
      expect.objectContaining({ mode: 'in-app-browser' }),
    );
  });

  it('offers the hand-off even without an API key', async () => {
    mockSettings = { aiSettings: { geminiApiKey: '' } };
    renderPopup();

    const buttons = await screen.findAllByRole('button', { name: 'Open in Gemini app' });
    // The footer button is offered even without a key: the hand-off to
    // Gemini itself never needed one.
    expect((buttons[buttons.length - 1] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(buttons[buttons.length - 1]!);

    expect(mockDispatchGeminiHandoff).toHaveBeenCalledWith(
      'It was the best of times.',
      'explain',
      expect.objectContaining({ mode: 'external-app' }),
    );
  });

  it('reports a failure to open the Gemini browser', async () => {
    const { eventDispatcher } = await import('@/utils/event');
    const toast = vi.fn();
    eventDispatcher.on('toast', toast);
    mockDispatchGeminiHandoff.mockRejectedValueOnce(new Error('no window'));
    renderPopup();

    await waitFor(() => expect(mockStreamExplanation).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: 'Open in Gemini app' })[0]!);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({ type: 'error', message: 'Could not open Gemini' }),
        }),
      ),
    );
    eventDispatcher.off('toast', toast);
  });

  it('does not stream in ask mode until the reader submits a question', async () => {
    renderPopup({ autoStart: false });

    expect(
      await screen.findByText('Ask a question, or pick one of the shortcuts above.'),
    ).toBeTruthy();
    expect(mockStreamExplanation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Ask Gemini about this selection...'), {
      target: { value: 'Who is the narrator?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(mockStreamExplanation).toHaveBeenCalled());
    const call = mockStreamExplanation.mock.calls[0] as unknown[];
    expect(call[5]).toBe('Who is the narrator?');
  });

  it('does not start a request when the reader only switches the shortcut in ask mode', async () => {
    // Switching the shortcut must not spend the reader's Gemini quota: in ask
    // mode nothing is asked until the reader asks it.
    renderPopup({ autoStart: false });

    expect(
      await screen.findByText('Ask a question, or pick one of the shortcuts above.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Context' }));
    fireEvent.click(screen.getByRole('button', { name: 'Who is this?' }));

    expect(mockStreamExplanation).not.toHaveBeenCalled();
  });
});
