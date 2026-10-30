import type { AISettings, GeminiModelId } from './types';

// cheapest popular models as of 2025
export const GATEWAY_MODELS = {
  GEMINI_FLASH_LITE: 'google/gemini-2.5-flash-lite',
  GPT_5_NANO: 'openai/gpt-5-nano',
  LLAMA_4_SCOUT: 'meta/llama-4-scout',
  GROK_4_1_FAST: 'xai/grok-4.1-fast-reasoning',
  DEEPSEEK_V3_2: 'deepseek/deepseek-v3.2',
  QWEN_3_235B: 'alibaba/qwen-3-235b',
} as const;

/**
 * Gemini models offered by the in-situ reading assistant.
 *
 * `gemini-2.0-flash` is the default: it is the fastest of the three and the
 * only one of them still served on the free tier of AI Studio, which is what
 * the assistant targets. `gemini-1.5-flash` and `gemini-1.5-pro` remain
 * selectable for readers whose key is provisioned for them.
 */
export const GEMINI_MODELS = {
  FLASH_2_0: 'gemini-2.0-flash',
  FLASH_1_5: 'gemini-1.5-flash',
  PRO_1_5: 'gemini-1.5-pro',
} as const satisfies Record<string, GeminiModelId>;

export const DEFAULT_GEMINI_MODEL: GeminiModelId = GEMINI_MODELS.FLASH_2_0;

/**
 * Whether a value is one of the Gemini models the assistant offers.
 *
 * The model id is interpolated into the API URL, so a value that did not come
 * from the settings picker — a hand-edited settings file, a restored backup —
 * must not be able to rewrite the request path or its query string.
 */
export const isGeminiModelId = (value: unknown): value is GeminiModelId =>
  typeof value === 'string' && (Object.values(GEMINI_MODELS) as string[]).includes(value);

/** Google's embedding model, used when Gemini backs the RAG indexer. */
export const GEMINI_EMBEDDING_MODEL = 'text-embedding-004';

export const MODEL_PRICING: Record<string, { input: string; output: string }> = {
  [GATEWAY_MODELS.GEMINI_FLASH_LITE]: { input: '0.1', output: '0.4' },
  [GATEWAY_MODELS.GPT_5_NANO]: { input: '0.05', output: '0.4' },
  [GATEWAY_MODELS.LLAMA_4_SCOUT]: { input: '0.08', output: '0.3' },
  [GATEWAY_MODELS.GROK_4_1_FAST]: { input: '0.2', output: '0.5' },
  [GATEWAY_MODELS.DEEPSEEK_V3_2]: { input: '0.27', output: '0.4' },
  [GATEWAY_MODELS.QWEN_3_235B]: { input: '0.07', output: '0.46' },
};

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  provider: 'ollama',

  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.2',
  ollamaEmbeddingModel: 'nomic-embed-text',

  aiGatewayModel: 'google/gemini-2.5-flash-lite',
  aiGatewayEmbeddingModel: 'openai/text-embedding-3-small',

  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  openrouterModel: '',
  openrouterEmbeddingModel: '',

  geminiModel: DEFAULT_GEMINI_MODEL,
  geminiDefaultAction: 'popover',
  // The hand-off leaves Minerva by default: the in-app browser is opt-in,
  // because a companion window is only worth the screen space to a reader
  // who is already signed in to Google.
  geminiHandoffMode: 'external-app',

  spoilerProtection: true,
  maxContextChunks: 10,
  indexingMode: 'on-demand',
  reedy: { enabled: false },
};
