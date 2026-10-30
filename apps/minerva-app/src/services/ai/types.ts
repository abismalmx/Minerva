import type { LanguageModel, EmbeddingModel } from 'ai';

export type AIProviderName = 'ollama' | 'ai-gateway' | 'openrouter' | 'gemini';

/**
 * Gemini models offered for the in-situ reading assistant.
 *
 * Kept as a closed union so the settings UI can offer a picker instead of a
 * free-text field, and so a model id can never be misspelled by a caller.
 */
export type GeminiModelId = 'gemini-1.5-flash' | 'gemini-2.0-flash' | 'gemini-1.5-pro';

/**
 * What the selection toolbar's Gemini button does when it is pressed.
 *
 * - `popover`: open the in-situ HUD and stream the explanation there.
 * - `external`: hand the selection straight to the official Gemini app.
 * - `ask`: open the in-situ HUD focused on a free-form question box.
 */
export type GeminiDefaultAction = 'popover' | 'external' | 'ask';

/**
 * Where the hand-off to the official Gemini app lands.
 *
 * - `in-app-browser`: Minerva's own webview — a native browser sheet on
 *   mobile, a companion window docked next to the reader on desktop. The
 *   reader never leaves the app, and the Google session lives in the
 *   webview's cookie jar, so it is signed in once.
 * - `external-app`: the operating system's browser or the Gemini app.
 */
export type GeminiHandoffMode = 'in-app-browser' | 'external-app';

/**
 * The three comprehension actions the in-situ HUD offers for a selection.
 */
export type GeminiReadingAction = 'explain' | 'context' | 'character';

/** Book context handed to Gemini so the answer fits the book being read. */
export interface GeminiReadingContext {
  bookTitle: string;
  author?: string;
  currentPage?: number;
}

export interface AIProvider {
  id: AIProviderName;
  name: string;
  requiresAuth: boolean;

  getModel(): LanguageModel;
  getEmbeddingModel(): EmbeddingModel;

  isAvailable(): Promise<boolean>;
  healthCheck(): Promise<boolean>;
}

export interface AISettings {
  enabled: boolean;
  provider: AIProviderName;

  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaEmbeddingModel: string;

  aiGatewayApiKey?: string;
  aiGatewayModel?: string;
  aiGatewayCustomModel?: string;
  aiGatewayEmbeddingModel?: string;

  // OpenAI-compatible provider (OpenRouter, Together, Groq, vLLM, ...).
  // Default base URL is OpenRouter's, but any compatible endpoint works.
  openrouterApiKey?: string;
  openrouterBaseUrl?: string;
  openrouterModel?: string;
  openrouterEmbeddingModel?: string;

  // Google Gemini — the in-situ reading assistant. These are read by the
  // reader's selection HUD, independently of `provider`: the assistant can be
  // used while the notebook chat still runs on Ollama or the AI Gateway.
  geminiApiKey?: string;
  geminiModel?: GeminiModelId;
  geminiDefaultAction?: GeminiDefaultAction;
  /**
   * Where the hand-off to the official Gemini app lands: inside Minerva's
   * own webview or in the operating system's browser. Only the native
   * builds have an in-app browser; the web build falls back to a new tab.
   */
  geminiHandoffMode?: GeminiHandoffMode;

  spoilerProtection: boolean;
  maxContextChunks: number;
  indexingMode: 'on-demand' | 'background';

  /**
   * Reedy MVP retrieval (Turso vector + Tantivy FTS + CFI citations).
   * MVP is desktop-only — the runtime gate in `selectBackend()` enforces
   * isTauri() regardless of this flag. UI in M1.8 disables the toggle on web.
   */
  reedy?: {
    enabled: boolean;
    /**
     * 'mvp' (default) keeps the Phase 1B path: lookupPassage tool wired
     * through @assistant-ui/react's adapter. 'agent' switches the
     * notebook AI tab to the Phase 4 ReedyAssistant (custom AgentRuntime
     * + thread UI). Requires `reedy.enabled && isTauri() &&
     * runtime === 'agent'` to engage.
     */
    runtime?: 'mvp' | 'agent';
  };
}

export interface TextChunk {
  id: string;
  bookHash: string;
  sectionIndex: number;
  chapterTitle: string;
  text: string;
  embedding?: number[];
  pageNumber: number; // page number using Minerva's 1500 chars/page formula
}

export interface ScoredChunk extends TextChunk {
  score: number;
  searchMethod: 'bm25' | 'vector' | 'hybrid';
}

export interface BookIndexMeta {
  bookHash: string;
  bookTitle: string;
  authorName: string;
  totalSections: number;
  totalChunks: number;
  embeddingModel: string;
  lastUpdated: number;
}

export interface IndexingState {
  bookHash: string;
  status: 'idle' | 'indexing' | 'complete' | 'error';
  progress: number;
  chunksProcessed: number;
  totalChunks: number;
  error?: string;
}

export interface EmbeddingProgress {
  current: number;
  total: number;
  phase: 'chunking' | 'embedding' | 'indexing';
}

// stored AI conversation for a book
export interface AIConversation {
  id: string;
  bookHash: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// single message in an AI conversation
export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}
