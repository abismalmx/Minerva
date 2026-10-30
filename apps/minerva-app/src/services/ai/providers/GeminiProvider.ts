import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, EmbeddingModel } from 'ai';
import type {
  AIProvider,
  AIProviderName,
  AISettings,
  GeminiReadingAction,
  GeminiReadingContext,
} from '../types';
import { aiLogger } from '../logger';
import { AI_TIMEOUTS } from '../utils/retry';
import { getAIFetch } from '../utils/httpFetch';
import { buildGeminiReadingPrompt } from '../prompts';
import { DEFAULT_GEMINI_MODEL, GEMINI_EMBEDDING_MODEL, isGeminiModelId } from '../constants';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Google's OpenAI-compatible surface — used for the chat / embedding models. */
const GEMINI_OPENAI_BASE = `${GEMINI_API_BASE}/openai`;
/** Generous enough for the 80-word answer plus its prompt echo. */
const MAX_OUTPUT_TOKENS = 512;

/**
 * A failure returned by the Gemini REST API.
 *
 * The status and the API status string are kept so callers can tell a
 * misconfigured key (400/403) apart from a quota problem (429) or a plain
 * network failure, which surfaces as a plain `TypeError` instead.
 */
export class GeminiApiError extends Error {
  readonly status: number;
  readonly apiStatus?: string;

  constructor(message: string, status: number, apiStatus?: string) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
    this.apiStatus = apiStatus;
  }

  /** True when the failure is an authentication / authorization problem. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True when the free-tier quota is exhausted. */
  get isQuotaError(): boolean {
    return this.status === 429;
  }
}

interface GeminiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

/** Pull the human-readable message out of a Google API error body. */
const parseGeminiError = (status: number, body: string): GeminiApiError => {
  let message = '';
  let apiStatus: string | undefined;
  try {
    const parsed = JSON.parse(body) as GeminiErrorPayload;
    message = parsed.error?.message ?? '';
    apiStatus = parsed.error?.status;
  } catch {
    // Not JSON — the raw body (or an HTML error page) is all we have.
  }
  const detail = message || body.slice(0, 300) || `HTTP ${status}`;
  return new GeminiApiError(`Gemini API error (${status}): ${detail}`, status, apiStatus);
};

/**
 * Read the text deltas out of one SSE event.
 *
 * Gemini's `alt=sse` stream sends `data: {json}` lines, one JSON document per
 * event. A document carries the delta under
 * `candidates[0].content.parts[].text`; several parts may be present, and a
 * part may carry `thought: true` (a model's internal reasoning), which is not
 * part of the answer and is dropped here.
 */
const readDelta = (event: string): string => {
  let delta = '';
  for (const line of event.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      // A partial JSON frame: the stream was cut mid-event. Skip it — the
      // remaining bytes complete it in the next read.
      continue;
    }
    if (!json || typeof json !== 'object') continue;
    const candidates = (json as { candidates?: unknown }).candidates;
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const typed = part as { text?: unknown; thought?: unknown };
        if (typeof typed.text !== 'string') continue;
        if (typed.thought === true) continue;
        delta += typed.text;
      }
    }
  }
  return delta;
};

/**
 * The blank line that ends an SSE frame.
 *
 * The SSE spec allows `\r\n`, `\n` and `\r` as line terminators, and a frame
 * ends at the first empty line. Google answers with `\n\n`, but a proxy (or
 * an HTTP/2 gateway) that normalizes to CRLF answers with `\r\n\r\n` — so the
 * boundary has to accept both, in the streaming path as well as in the
 * buffered one.
 */
const SSE_FRAME_BOUNDARY = /\r?\n\r?\n/;

/**
 * Split a raw SSE document into its events. Handles both `\n\n` and `\r\n\r\n`
 * separators, which different proxies emit.
 */
export const splitSseEvents = (payload: string): string[] => {
  return payload
    .split(SSE_FRAME_BOUNDARY)
    .map((event) => event.trim())
    .filter((event) => event.length > 0);
};

/**
 * Provider for Google's Gemini.
 *
 * Two transports are used on purpose:
 *
 * - {@link GeminiProvider.streamExplanation} talks to the native REST API
 *   (`streamGenerateContent?alt=sse`) because the in-situ reading HUD needs
 *   token-by-token delivery, and the native surface is the only one that
 *   exposes it without an extra dependency.
 * - {@link GeminiProvider.getModel} / {@link GeminiProvider.getEmbeddingModel}
 *   go through Google's OpenAI-compatible surface so the provider can also
 *   back the notebook chat and the RAG indexer without a second SDK.
 *
 * Transport for every outbound call is {@link getAIFetch}, so under Tauri the
 * request leaves through the Rust HTTP client (no CORS preflight, no Android
 * cleartext block).
 */
export class GeminiProvider implements AIProvider {
  id: AIProviderName = 'gemini';
  name = 'Google Gemini';
  requiresAuth = true;

  private apiKey: string;
  private model: string;
  private httpFetch: typeof fetch;
  private client: ReturnType<typeof createOpenAICompatible>;

  constructor(settings: AISettings) {
    this.apiKey = settings.geminiApiKey?.trim() ?? '';
    // The model id travels in the request URL, so only the ids the settings
    // picker offers are accepted: a value that came from anywhere else (an
    // edited settings file, a restored backup) falls back to the default
    // instead of rewriting the path or the query of the API call.
    this.model = isGeminiModelId(settings.geminiModel)
      ? settings.geminiModel
      : DEFAULT_GEMINI_MODEL;
    this.httpFetch = getAIFetch();
    this.client = createOpenAICompatible({
      name: 'gemini',
      baseURL: GEMINI_OPENAI_BASE,
      apiKey: this.apiKey,
      fetch: this.httpFetch,
    });
    aiLogger.provider.init('gemini', this.model);
  }

  getModel(): LanguageModel {
    return this.client.chatModel(this.model);
  }

  getEmbeddingModel(): EmbeddingModel {
    return this.client.textEmbeddingModel(GEMINI_EMBEDDING_MODEL);
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await this.httpFetch(`${GEMINI_API_BASE}/models/${this.model}`, {
        method: 'GET',
        headers: { 'x-goog-api-key': this.apiKey },
        signal: AbortSignal.timeout(AI_TIMEOUTS.HEALTH_CHECK),
      });
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      return true;
    } catch (e) {
      aiLogger.provider.error('gemini', `healthCheck failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Stream an explanation of `selectedText` through Gemini's SSE endpoint.
   *
   * `onChunk` receives the raw text delta of every frame, in order, so the
   * HUD can render it as it arrives. The resolved value is the whole answer,
   * which is what "save as note" persists.
   *
   * Aborts through `signal` (a page turn, a tap outside, a dismissed popup)
   * cancel the in-flight request and reject with an `AbortError`.
   */
  async streamExplanation(
    selectedText: string,
    mode: GeminiReadingAction,
    context: GeminiReadingContext,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    question?: string,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new GeminiApiError('Gemini API key is not configured', 401, 'UNAUTHENTICATED');
    }
    const text = selectedText.trim();
    if (!text) {
      throw new GeminiApiError('Nothing selected to explain', 400, 'INVALID_ARGUMENT');
    }

    const prompt = buildGeminiReadingPrompt(mode, text, context, question);
    const response = await this.httpFetch(
      `${GEMINI_API_BASE}/models/${this.model}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // The key travels in a header rather than in the query string: a URL
          // is far more likely to end up in a proxy log or an error report.
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            topP: 0.9,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        }),
        signal,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw parseGeminiError(response.status, body);
    }

    const full = await this.consumeStream(response, onChunk, signal);
    return full;
  }

  /**
   * Drain an SSE response, forwarding every text delta to `onChunk`.
   *
   * Two shapes are handled: a streaming body (`response.body` with a reader)
   * and a buffered one (`response.text()`), which is what a runtime without
   * streaming support — or a proxy that buffers — hands back. Both produce the
   * same deltas in the same order.
   */
  private async consumeStream(
    response: Response,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    let full = '';
    const emit = (delta: string) => {
      if (!delta) return;
      full += delta;
      onChunk(delta);
    };

    const body = response.body;
    if (!body || typeof body.getReader !== 'function') {
      // Buffered transport: parse the whole SSE document at once.
      const text = await response.text();
      for (const event of splitSseEvents(text)) {
        emit(readDelta(event));
      }
      return full;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => undefined);
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // A frame ends at a blank line; anything after it is the next frame.
        // The boundary accepts CRLF as well as LF, so a stream framed with
        // "\r\n\r\n" is delivered incrementally instead of in one lump at the
        // end of the response.
        let boundary = SSE_FRAME_BOUNDARY.exec(buffer);
        while (boundary) {
          const event = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          emit(readDelta(event));
          boundary = SSE_FRAME_BOUNDARY.exec(buffer);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) emit(readDelta(buffer));
    } catch (e) {
      if (signal?.aborted && !(e instanceof Error && e.name === 'AbortError')) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      throw e;
    } finally {
      reader.releaseLock();
    }
    return full;
  }
}
