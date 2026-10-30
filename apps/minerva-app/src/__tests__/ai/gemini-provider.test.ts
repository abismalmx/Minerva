import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/services/ai/logger', () => ({
  aiLogger: {
    provider: {
      init: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    chatModel: vi.fn(),
    textEmbeddingModel: vi.fn(),
  })),
}));

import {
  GeminiApiError,
  GeminiProvider,
  splitSseEvents,
} from '@/services/ai/providers/GeminiProvider';
import { getAIProvider } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS, DEFAULT_GEMINI_MODEL } from '@/services/ai/constants';
import type { AISettings } from '@/services/ai/types';

const settings = (overrides: Partial<AISettings> = {}): AISettings => ({
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  provider: 'gemini',
  geminiApiKey: 'test-key',
  ...overrides,
});

const encoder = new TextEncoder();

/** A response whose body streams the given chunks. */
const streamingResponse = (chunks: string[]) => ({
  ok: true,
  status: 200,
  body: {
    getReader: () => {
      let index = 0;
      return {
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]!) }
            : { done: true, value: undefined },
        cancel: async () => undefined,
        releaseLock: () => undefined,
      };
    },
  },
  text: async () => chunks.join(''),
});

/** A response whose body was buffered by the runtime. */
const bufferedResponse = (payload: string) => ({
  ok: true,
  status: 200,
  body: null,
  text: async () => payload,
});

const sseEvent = (text: string) =>
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

describe('GeminiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('exposes the provider identity', () => {
    const provider = new GeminiProvider(settings());
    expect(provider.id).toBe('gemini');
    expect(provider.name).toBe('Google Gemini');
    expect(provider.requiresAuth).toBe(true);
  });

  test('isAvailable reflects whether a key is configured', async () => {
    expect(await new GeminiProvider(settings()).isAvailable()).toBe(true);
    expect(await new GeminiProvider(settings({ geminiApiKey: '' })).isAvailable()).toBe(false);
    expect(await new GeminiProvider(settings({ geminiApiKey: '   ' })).isAvailable()).toBe(false);
  });

  test('healthCheck asks the models endpoint with the key header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    const provider = new GeminiProvider(settings());

    expect(await provider.healthCheck()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-goog-api-key': 'test-key' }),
      }),
    );
  });

  test('healthCheck returns false when the endpoint rejects the key', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    const provider = new GeminiProvider(settings());

    expect(await provider.healthCheck()).toBe(false);
  });

  test('healthCheck returns false without a key, without touching the network', async () => {
    const provider = new GeminiProvider(settings({ geminiApiKey: '' }));

    expect(await provider.healthCheck()).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('streamExplanation posts to the SSE endpoint and streams the deltas', async () => {
    mockFetch.mockResolvedValueOnce(
      streamingResponse([
        sseEvent('The sentence '),
        sseEvent('turns on itself.'),
        sseEvent('\n- It works'),
      ]),
    );
    const provider = new GeminiProvider(settings());
    const chunks: string[] = [];

    const full = await provider.streamExplanation(
      'some passage',
      'explain',
      { bookTitle: 'Book', author: 'Author', currentPage: 12 },
      (delta) => chunks.push(delta),
    );

    expect(chunks).toEqual(['The sentence ', 'turns on itself.', '\n- It works']);
    expect(full).toBe('The sentence turns on itself.\n- It works');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string) as {
      contents: { parts: { text: string }[] }[];
    };
    expect(body.contents[0]?.parts[0]?.text).toContain('some passage');
  });

  test('streamExplanation handles a body buffered by the runtime', async () => {
    mockFetch.mockResolvedValueOnce(bufferedResponse(`${sseEvent('Hello')}${sseEvent(' world')}`));
    const provider = new GeminiProvider(settings());
    const chunks: string[] = [];

    const full = await provider.streamExplanation(
      'passage',
      'explain',
      { bookTitle: 'Book' },
      (delta) => chunks.push(delta),
    );

    expect(chunks).toEqual(['Hello', ' world']);
    expect(full).toBe('Hello world');
  });

  test('streamExplanation drops the model’s internal reasoning parts', async () => {
    const payload = `data: ${JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: 'thinking...', thought: true }, { text: 'answer' }],
          },
        },
      ],
    })}\n\n`;
    mockFetch.mockResolvedValueOnce(bufferedResponse(payload));
    const provider = new GeminiProvider(settings());

    const full = await provider.streamExplanation(
      'passage',
      'explain',
      { bookTitle: 'Book' },
      () => undefined,
    );

    expect(full).toBe('answer');
  });

  test('streamExplanation surfaces the API error message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' },
        }),
    });
    const provider = new GeminiProvider(settings());

    const error = await provider
      .streamExplanation('passage', 'explain', { bookTitle: 'Book' }, () => undefined)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GeminiApiError);
    expect((error as GeminiApiError).status).toBe(400);
    expect((error as GeminiApiError).message).toContain('API key not valid');
  });

  test('streamExplanation reports an exhausted quota as a quota error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { code: 429, message: 'quota exceeded' } }),
    });
    const provider = new GeminiProvider(settings());

    const error = await provider
      .streamExplanation('passage', 'explain', { bookTitle: 'Book' }, () => undefined)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GeminiApiError);
    expect((error as GeminiApiError).isQuotaError).toBe(true);
    expect((error as GeminiApiError).isAuthError).toBe(false);
  });

  test('streamExplanation refuses to run without a key', async () => {
    const provider = new GeminiProvider(settings({ geminiApiKey: '' }));

    const error = await provider
      .streamExplanation('passage', 'explain', { bookTitle: 'Book' }, () => undefined)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GeminiApiError);
    expect((error as GeminiApiError).isAuthError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('streamExplanation refuses to run on an empty selection', async () => {
    const provider = new GeminiProvider(settings());

    await expect(
      provider.streamExplanation('   ', 'explain', { bookTitle: 'Book' }, () => undefined),
    ).rejects.toBeInstanceOf(GeminiApiError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('streamExplanation rejects with an AbortError once the signal fires', async () => {
    const controller = new AbortController();
    mockFetch.mockImplementationOnce(async () => {
      controller.abort();
      return streamingResponse([sseEvent('late')]);
    });
    const provider = new GeminiProvider(settings());

    const error = await provider
      .streamExplanation(
        'passage',
        'explain',
        { bookTitle: 'Book' },
        () => undefined,
        controller.signal,
      )
      .catch((e: unknown) => e);

    expect(error).toBeDefined();
    expect((error as Error).name).toBe('AbortError');
  });

  test('streamExplanation streams a CRLF-framed response frame by frame', async () => {
    // A proxy that normalizes the line endings answers with "\r\n\r\n". The
    // reader must still deliver the deltas as they arrive instead of waiting
    // for the whole response to end.
    const trace: string[] = [];
    const crlfEvent = (text: string) =>
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`;
    const frames = [crlfEvent('The sentence '), crlfEvent('turns on itself.')];
    let index = 0;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            trace.push(`read:${index}`);
            if (index < frames.length) {
              return { done: false, value: encoder.encode(frames[index++]!) };
            }
            return { done: true, value: undefined };
          },
          cancel: async () => undefined,
          releaseLock: () => undefined,
        }),
      },
      text: async () => frames.join(''),
    });

    const provider = new GeminiProvider(settings());
    const chunks: string[] = [];
    const full = await provider.streamExplanation(
      'some passage',
      'explain',
      { bookTitle: 'Book' },
      (delta) => {
        trace.push(`chunk:${delta}`);
        chunks.push(delta);
      },
    );

    expect(chunks).toEqual(['The sentence ', 'turns on itself.']);
    expect(full).toBe('The sentence turns on itself.');
    // The first delta was delivered before the second frame was read.
    expect(trace.indexOf('chunk:The sentence ')).toBeLessThan(trace.indexOf('read:1'));
  });

  test('a model id that is not on the allowlist falls back to the default', async () => {
    // The model id travels in the request URL, so a value that did not come
    // from the settings picker must not be able to rewrite it.
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, body: null, text: async () => '' });
    const provider = new GeminiProvider(
      settings({ geminiModel: 'evil?alt=sse&x=' as unknown as AISettings['geminiModel'] }),
    );

    await provider
      .streamExplanation('passage', 'explain', { bookTitle: 'Book' }, () => undefined)
      .catch(() => undefined);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(`/models/${DEFAULT_GEMINI_MODEL}:streamGenerateContent`);
    expect(url).not.toContain('evil');
  });
});

describe('splitSseEvents', () => {
  test('splits on blank lines and drops empty frames', () => {
    expect(splitSseEvents('data: a\n\n\n\ndata: b\n\n')).toEqual(['data: a', 'data: b']);
  });

  test('handles CRLF separators', () => {
    expect(splitSseEvents('data: a\r\n\r\ndata: b\r\n\r\n')).toEqual(['data: a', 'data: b']);
  });
});

describe('getAIProvider', () => {
  test('returns a GeminiProvider for the gemini provider', () => {
    const provider = getAIProvider(settings());
    expect(provider.id).toBe('gemini');
  });

  test('builds a Gemini provider even without a key, so it can report unavailability', () => {
    const provider = getAIProvider(settings({ geminiApiKey: '' }));
    expect(provider.id).toBe('gemini');
  });
});
