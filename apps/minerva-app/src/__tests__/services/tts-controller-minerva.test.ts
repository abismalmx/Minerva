import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import type { TTSGranularity, TTSVoice } from '@/services/tts/types';
import type { FoliateView } from '@/types/view';
import type { AppService } from '@/types/system';

// Controller wiring of Minerva Voice: a BufferedTTSClient over the Minerva
// provider, sharing Edge's per-book cache store, registered everywhere the
// controller used to know only Edge.

const h = vi.hoisted(() => ({
  edgeArgs: [] as unknown[][],
  bufferedArgs: [] as unknown[][],
  minervaClient: null as Record<string, unknown> | null,
  warmup: vi.fn(),
  store: { get: async () => null, put: async () => {} },
  minervaInit: true,
  // The Minerva server never answers (init and voice list hang).
  minervaHang: false,
  minervaVoices: [] as TTSVoice[],
  customClient: null as Record<string, unknown> | null,
  customInit: true,
  customVoices: null as TTSVoice[] | null,
  customArgs: [] as unknown[],
}));

function mockClient(name: string): TTSClient {
  return {
    name,
    initialized: false,
    init: vi.fn().mockImplementation(async function (this: { initialized: boolean }) {
      this.initialized = true;
      return true;
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    speak: vi.fn().mockImplementation(async function* (): AsyncGenerator<TTSMessageEvent> {
      yield { code: 'end' };
    }),
    pause: vi.fn().mockResolvedValue(true),
    resume: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(undefined),
    setPrimaryLang: vi.fn(),
    setRate: vi.fn().mockResolvedValue(undefined),
    setPitch: vi.fn().mockResolvedValue(undefined),
    setVoice: vi.fn().mockResolvedValue(undefined),
    getAllVoices: vi.fn().mockResolvedValue([]),
    getVoices: vi.fn().mockResolvedValue([]),
    getGranularities: vi.fn().mockReturnValue(['sentence'] as TTSGranularity[]),
    getCapabilities: vi.fn().mockReturnValue({
      wordBoundaries: true,
      mediaClock: true,
      gapControl: true,
      liveRateChange: false,
    }),
    getVoiceId: vi.fn().mockReturnValue('voice-1'),
    getSpeakingLang: vi.fn().mockReturnValue('en'),
  };
}

const bufferedExtras = () => ({
  setSentenceGap: vi.fn(),
  setParagraphGap: vi.fn(),
  canDownload: vi.fn().mockReturnValue(true),
  getSectionCacheStatuses: vi.fn().mockResolvedValue(new Map()),
  getCacheBytes: vi.fn().mockResolvedValue(0),
  beginDownloadSections: vi.fn(),
  completeDownloadSections: vi.fn(),
  cancelDownloadSections: vi.fn(),
  clearDownloads: vi.fn(),
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockClient('web-speech'));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  // constants.ts imports this from here (circular import in production code).
  DEFAULT_SENTENCE_GAP_SEC: 0.15,
  EdgeTTSClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    ...args: unknown[]
  ) {
    h.edgeArgs.push(args);
    Object.assign(this, mockClient('edge-tts'), bufferedExtras());
    (this['getAllVoices'] as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' },
    ]);
  }),
}));
vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn(),
}));
vi.mock('@/services/tts/BufferedTTSClient', () => ({
  BufferedTTSClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    ...args: unknown[]
  ) {
    if ((args[0] as { id: string }).id === 'custom-tts') {
      Object.assign(this, mockClient('custom-tts'), bufferedExtras());
      (this['init'] as ReturnType<typeof vi.fn>).mockImplementation(async function (this: {
        initialized: boolean;
      }) {
        this.initialized = h.customInit;
        return h.customInit;
      });
      (this['getAllVoices'] as ReturnType<typeof vi.fn>).mockImplementation(
        async () => h.customVoices ?? CUSTOM_VOICES,
      );
      (this['getVoices'] as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'custom-tts:svc', name: 'My TTS', voices: CUSTOM_VOICES },
      ]);
      h.customClient = this;
      h.customArgs = args;
      return;
    }
    h.bufferedArgs.push(args);
    Object.assign(this, mockClient('minerva-tts'), bufferedExtras());
    (this['init'] as ReturnType<typeof vi.fn>).mockImplementation(async function (this: {
      initialized: boolean;
    }) {
      if (h.minervaHang) return new Promise<boolean>(() => {});
      this.initialized = h.minervaInit;
      return h.minervaInit;
    });
    (this['getAllVoices'] as ReturnType<typeof vi.fn>).mockImplementation(() =>
      h.minervaHang ? new Promise(() => {}) : Promise.resolve(h.minervaVoices),
    );
    h.minervaClient = this;
  }),
}));
vi.mock('@/services/tts/providers/minerva', () => ({
  MinervaVoiceProvider: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, { id: 'minerva-tts', warmup: h.warmup });
  }),
}));
vi.mock('@/services/tts/providers/openaiCompatible', () => ({
  OpenAICompatibleSpeechProvider: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
  ) {
    Object.assign(this, { id: 'custom-tts' });
  }),
}));
vi.mock('@/services/tts/providers/bookCacheStore', async (orig) => ({
  ...(await orig<typeof import('@/services/tts/providers/bookCacheStore')>()),
  createBookTTSCacheStore: vi.fn(() => h.store),
}));
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredClient: vi.fn().mockReturnValue(null),
    setPreferredClient: vi.fn(),
    setPreferredVoice: vi.fn(),
    getPreferredVoice: vi.fn().mockReturnValue(null),
  },
}));
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { highlight: 'highlightFn' } }));
vi.mock('@/utils/node', () => ({ createRejectFilter: vi.fn(() => () => 1) }));

import { TTSController } from '@/services/tts/TTSController';
import { TTSUtils } from '@/services/tts/TTSUtils';
import { CachingProvider } from '@/services/tts/providers/cache';
import { createBookTTSCacheStore } from '@/services/tts/providers/bookCacheStore';

const CUSTOM_VOICES = [
  { id: 'svc:nova', name: 'nova', lang: 'mul' },
  { id: 'kok:af_heart', name: 'af_heart', lang: 'en-US' },
];
const MINERVA_VOICES = [{ id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US' }];
const view = {
  renderer: { primaryIndex: 0, getContents: vi.fn().mockReturnValue([]) },
  book: { sections: [] },
  language: { isCJK: false },
  tts: null,
} as unknown as FoliateView;
const appService = { isAndroidApp: false, isIOSApp: false } as unknown as AppService;

let controller: TTSController;
const minerva = () => h.minervaClient as unknown as TTSClient & ReturnType<typeof bufferedExtras>;
const custom = () => h.customClient as unknown as TTSClient & ReturnType<typeof bufferedExtras>;
const edge = () => controller.ttsEdgeClient as unknown as ReturnType<typeof bufferedExtras>;

beforeEach(() => {
  h.edgeArgs = [];
  h.bufferedArgs = [];
  h.minervaInit = true;
  h.minervaVoices = MINERVA_VOICES;
  h.customInit = true;
  h.customVoices = null;
  h.warmup.mockReset();
  vi.mocked(TTSUtils.getPreferredClient).mockReturnValue(null);
  vi.mocked(createBookTTSCacheStore).mockClear();
  controller = new TTSController(appService, view, true);
});

afterEach(() => vi.clearAllMocks());

describe('construction', () => {
  test('Edge and Minerva share one per-book cache store', () => {
    expect(createBookTTSCacheStore).toHaveBeenCalledTimes(1);
    expect(h.edgeArgs[0]![2]).toBe(h.store);
    const provider = h.bufferedArgs[0]![0];
    expect(provider).toBeInstanceOf(CachingProvider);
    expect((provider as CachingProvider).id).toBe('minerva-tts');
  });

  test('without a cache store the provider is used directly', () => {
    vi.mocked(createBookTTSCacheStore).mockReturnValueOnce(null);
    h.bufferedArgs = [];
    new TTSController(appService, view, true);
    expect(h.bufferedArgs[0]![0]).not.toBeInstanceOf(CachingProvider);
  });
});

describe('init', () => {
  test('an engine that never answers does not hold up init or the other engines', async () => {
    vi.useFakeTimers();
    h.minervaHang = true;
    try {
      vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('minerva-tts');
      let done = false;
      void controller.init().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(14_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(done).toBe(true);
      // Minerva Voice is unavailable this session; Edge reads.
      expect(controller.ttsClient.name).toBe('edge-tts');
    } finally {
      h.minervaHang = false;
      vi.useRealTimers();
    }
  });

  test('Minerva Voice is available but Edge stays the default engine', async () => {
    await controller.init();
    expect(minerva().init).toHaveBeenCalled();
    expect(controller.ttsClient.name).toBe('edge-tts');
    expect(controller.ttsMinervaVoices).toEqual(MINERVA_VOICES);
  });

  test('a remembered Minerva preference selects it', async () => {
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('minerva-tts');
    await controller.init();
    expect(controller.ttsClient).toBe(minerva());
  });
});

describe('voices', () => {
  test('lists the Minerva group after native and before Edge, and warms the worker', async () => {
    h.customInit = false;
    await controller.init();
    vi.mocked(minerva().getVoices).mockResolvedValue([
      { id: 'minerva-tts', name: 'Minerva Voice', voices: MINERVA_VOICES },
    ]);
    vi.mocked(controller.ttsEdgeClient.getVoices).mockResolvedValue([
      { id: 'edge-tts', name: 'Edge TTS', voices: [] },
    ]);
    const groups = await controller.getVoices('en');
    expect(groups.map((g) => g.id)).toEqual(['minerva-tts', 'edge-tts']);
    expect(h.warmup).toHaveBeenCalledTimes(1);
  });

  test('shows the Minerva group greyed out to readers whose plan lacks it', async () => {
    h.minervaVoices = MINERVA_VOICES.map((voice) => ({ ...voice, disabled: true }));
    await controller.init();
    const locked = MINERVA_VOICES.map((voice) => ({ ...voice, disabled: true }));
    vi.mocked(minerva().getVoices).mockResolvedValue([
      { id: 'minerva-tts', name: 'Minerva Voice', voices: locked, disabled: true },
    ]);
    const groups = await controller.getVoices('en');
    expect(groups.find((g) => g.id === 'minerva-tts')?.voices).toEqual(locked);
    expect(h.warmup).not.toHaveBeenCalled();
  });
});

describe('book language', () => {
  test('a remembered Minerva choice yields to Edge for a language it has no voice for', async () => {
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('minerva-tts');
    await controller.init();
    expect(controller.ttsClient).toBe(minerva());
    await controller.setLang('de');
    expect(controller.ttsClient.name).toBe('edge-tts');
    // The choice itself is kept for books Minerva Voice can read.
    expect(TTSUtils.setPreferredClient).not.toHaveBeenCalled();
  });

  test('a remembered Minerva choice yields to Edge when the plan lacks every voice', async () => {
    h.minervaVoices = MINERVA_VOICES.map((voice) => ({ ...voice, disabled: true }));
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('minerva-tts');
    await controller.init();
    await controller.setLang('en-US');
    expect(controller.ttsClient.name).toBe('edge-tts');
  });

  test('keeps Minerva Voice for a language it can voice', async () => {
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('minerva-tts');
    await controller.init();
    await controller.setLang('en-GB');
    expect(controller.ttsClient).toBe(minerva());
  });

  test('the picker hides an empty Minerva group', async () => {
    await controller.init();
    vi.mocked(minerva().getVoices).mockResolvedValue([
      { id: 'minerva-tts', name: 'Minerva Voice', voices: [], disabled: true },
    ]);
    const groups = await controller.getVoices('de');
    expect(groups.map((g) => g.id)).not.toContain('minerva-tts');
    expect(h.warmup).not.toHaveBeenCalled();
  });
});

describe('setVoice', () => {
  test("the engine-default voice ('') never selects Minerva Voice", async () => {
    await controller.init();
    await controller.setVoice('', 'en');
    expect(controller.ttsClient.name).toBe('edge-tts');
  });

  test('a Minerva voice selects the Minerva client', async () => {
    await controller.init();
    await controller.setVoice('kokoro:af_heart', 'en');
    expect(controller.ttsClient).toBe(minerva());
    expect(TTSUtils.setPreferredClient).toHaveBeenCalledWith('minerva-tts');
    expect(minerva().setVoice).toHaveBeenCalledWith('kokoro:af_heart');
  });

  test('a voice the plan lacks never selects Minerva Voice', async () => {
    h.minervaVoices = [
      ...MINERVA_VOICES,
      { id: 'omnivoice:clara', name: 'Clara', lang: 'en-US', disabled: true },
    ];
    await controller.init();
    await controller.setVoice('omnivoice:clara', 'en');
    expect(controller.ttsClient).not.toBe(minerva());
  });
});

describe('settings fan out to the Minerva client', () => {
  test('primary language, gaps and shutdown', async () => {
    await controller.init();
    await controller.setPrimaryLang('en');
    controller.setSentenceGap(0.2);
    controller.setParagraphGap(0.5);
    await controller.shutdown();
    expect(minerva().setPrimaryLang).toHaveBeenCalledWith('en');
    expect(minerva().setSentenceGap).toHaveBeenCalledWith(0.2);
    expect(minerva().setParagraphGap).toHaveBeenCalledWith(0.5);
    expect(minerva().shutdown).toHaveBeenCalled();
  });
});

describe('downloads follow the active synthetic engine', () => {
  test('Edge by default, Minerva Voice when it is the active client', async () => {
    await controller.init();
    await controller.clearDownloads();
    expect(edge().clearDownloads).toHaveBeenCalledTimes(1);
    await controller.setVoice('kokoro:af_heart', 'en');
    await controller.clearDownloads();
    await controller.beginDownloadSections([1]);
    expect(minerva().clearDownloads).toHaveBeenCalledTimes(1);
    expect(minerva().beginDownloadSections).toHaveBeenCalledWith([1]);
    expect(controller.canDownload()).toBe(true);
    expect(minerva().canDownload).toHaveBeenCalled();
  });
});

describe('custom TTS services', () => {
  test('share the per-book cache store and are never the default engine', async () => {
    expect(controller.ttsCustomClient).toBe(custom());
    expect(h.customArgs[0]).toBeInstanceOf(CachingProvider);
    expect((h.customArgs[0] as CachingProvider).id).toBe('custom-tts');
    await controller.init();
    expect(custom().init).toHaveBeenCalled();
    expect(controller.ttsClient.name).toBe('edge-tts');
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('custom-tts');
    await controller.init();
    expect(controller.ttsClient).toBe(custom());
  });

  test('list their groups right after narration, for any language', async () => {
    await controller.init();
    vi.mocked(minerva().getVoices).mockResolvedValue([
      { id: 'minerva-tts', name: 'Minerva Voice', voices: MINERVA_VOICES },
    ]);
    vi.mocked(controller.ttsEdgeClient.getVoices).mockResolvedValue([
      { id: 'edge-tts', name: 'Edge TTS', voices: [] },
    ]);
    const groups = await controller.getVoices('de');
    expect(groups.map((g) => g.id)).toEqual(['custom-tts:svc', 'minerva-tts', 'edge-tts']);
  });

  test('are hidden when unavailable (free plan, no services)', async () => {
    h.customInit = false;
    await controller.init();
    const groups = await controller.getVoices('en');
    expect(groups.map((g) => g.id)).not.toContain('custom-tts:svc');
  });

  test('a custom voice selects the custom client, which keeps it for any language', async () => {
    await controller.init();
    await controller.setVoice('svc:nova', 'en');
    expect(controller.ttsClient).toBe(custom());
    expect(TTSUtils.setPreferredClient).toHaveBeenCalledWith('custom-tts');
    expect(custom().setVoice).toHaveBeenCalledWith('svc:nova');
    await controller.setLang('ja');
    expect(controller.ttsClient).toBe(custom());
  });

  test('a service without a voice for the book language yields to the default engine', async () => {
    h.customVoices = [CUSTOM_VOICES[1]!];
    await controller.init();
    await controller.setVoice('kok:af_heart', 'en-US');
    await controller.setLang('en-GB');
    expect(controller.ttsClient).toBe(custom());
    await controller.setLang('ja');
    expect(controller.ttsClient.name).toBe('edge-tts');
  });

  test('settings, downloads and shutdown fan out to the custom client', async () => {
    await controller.init();
    await controller.setVoice('svc:nova', 'en');
    await controller.setPrimaryLang('en');
    controller.setSentenceGap(0.2);
    controller.setParagraphGap(0.5);
    await controller.clearDownloads();
    await controller.shutdown();
    expect(custom().setPrimaryLang).toHaveBeenCalledWith('en');
    expect(custom().setSentenceGap).toHaveBeenCalledWith(0.2);
    expect(custom().setParagraphGap).toHaveBeenCalledWith(0.5);
    expect(custom().clearDownloads).toHaveBeenCalledTimes(1);
    expect(custom().shutdown).toHaveBeenCalled();
  });
});
