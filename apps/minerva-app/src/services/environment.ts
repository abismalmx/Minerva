import { AppService } from '@/types/system';
import { MINERVA_NODE_BASE_URL, MINERVA_WEB_BASE_URL } from './constants';
import { getRuntimeConfig } from './runtimeConfig';
import { getOSPlatform } from '@/utils/misc';

declare global {
  interface Window {
    __MINERVA_CLI_ACCESS?: boolean;
  }
}

export const isTauriAppPlatform = () =>
  process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri' &&
  typeof window !== 'undefined' &&
  Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
export const isWebAppPlatform = () => !isTauriAppPlatform();
export const hasCli = () => window.__MINERVA_CLI_ACCESS === true;
export const isPWA = () => window.matchMedia('(display-mode: standalone)').matches;

export const CUSTOM_BACKEND_STORAGE_KEY = 'minerva_custom_backend_url';

/**
 * Validate and sanitize a custom backend URL.
 * Enforces HTTPS for all remote hosts to prevent plaintext credential and token transmission (CWE-319).
 * Plain HTTP is restricted strictly to loopback addresses (localhost, 127.0.0.1, [::1]) for local development.
 * Strips embedded user credentials, search queries, and fragments to prevent injection attacks.
 */
export const sanitizeBackendUrl = (input: unknown): string | null => {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();

    const isLoopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname.endsWith('.localhost');

    if (protocol === 'https:') {
      // Valid secure protocol
    } else if (protocol === 'http:' && isLoopback) {
      // Loopback allowed for local testing
    } else {
      // Insecure plain HTTP on remote host, or unsupported scheme (e.g. javascript:, file:, data:)
      return null;
    }

    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';

    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${path}`;
  } catch {
    return null;
  }
};

export const getCustomBackendUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_BACKEND_STORAGE_KEY);
    return sanitizeBackendUrl(raw);
  } catch {
    return null;
  }
};

export const setCustomBackendUrl = (url: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    const sanitized = sanitizeBackendUrl(url);
    if (sanitized) {
      window.localStorage.setItem(CUSTOM_BACKEND_STORAGE_KEY, sanitized);
    } else {
      window.localStorage.removeItem(CUSTOM_BACKEND_STORAGE_KEY);
    }
  } catch {
    // ignore storage quota/security errors
  }
};

export const getBaseUrl = () =>
  getCustomBackendUrl() ??
  getRuntimeConfig()?.apiBaseUrl ??
  process.env['API_BASE_URL'] ??
  process.env['NEXT_PUBLIC_API_BASE_URL'] ??
  MINERVA_WEB_BASE_URL;
export const getNodeBaseUrl = () =>
  process.env['NEXT_PUBLIC_NODE_BASE_URL'] ?? MINERVA_NODE_BASE_URL;

/**
 * Whether window move/resize has to be driven from JS with pointer events.
 * Linux runs on CEF, where the mouse press is owned by Chromium's X
 * connection: the runtime's `startDragging` (`_NET_WM_MOVERESIZE` from winit's
 * connection) is refused by the window manager, and the undecorated window has
 * no native resize borders either. Every other platform keeps the runtime's
 * own drag.
 */
export const needsPointerWindowControls = () =>
  isTauriAppPlatform() && typeof navigator !== 'undefined' && getOSPlatform() === 'linux';

export const isMacPlatform = () =>
  typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const getCommandPaletteShortcut = () => (isMacPlatform() ? '⌘⇧P' : 'Ctrl+Shift+P');

const isWebDevMode = () => {
  if (getCustomBackendUrl()) return false;
  const config = getRuntimeConfig();
  if (config?.selfHostedBackend || config?.apiBaseUrl) return false;
  if (
    process.env['SELF_HOSTED_BACKEND'] === 'true' ||
    process.env['NEXT_PUBLIC_SELF_HOSTED_BACKEND'] === 'true' ||
    process.env['API_BASE_URL'] ||
    process.env['NEXT_PUBLIC_API_BASE_URL']
  ) {
    return false;
  }
  return process.env['NODE_ENV'] === 'development' && isWebAppPlatform();
};

// Dev API only in development mode and web platform
// with command `pnpm dev-web`
// for production build or tauri app use the production Web API
export const getAPIBaseUrl = () => {
  if (isWebDevMode()) return '/api';
  const base = getBaseUrl().replace(/\/+$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
};

// Minerva Voice synthesizes on the production GPU service, which a local dev
// server cannot reach: its routes use the production Web API even under
// `pnpm dev-web` (a self-hosted apiBaseUrl still applies).
export const getMinervaVoiceAPIBaseUrl = () => `${getBaseUrl()}/api`;

// For Node.js API that currently not supported in some edge runtimes
export const getNodeAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getNodeBaseUrl()}/api`);

export interface EnvConfigType {
  getAppService: () => Promise<AppService>;
}

let nativeAppService: AppService | null = null;
const getNativeAppService = async () => {
  if (!nativeAppService) {
    const { NativeAppService } = await import('@/services/nativeAppService');
    // Publish the singleton only after `init` resolves. Assigning first meant a
    // failed init left a half-built service cached forever: every later caller
    // got it back without re-running init, and `getInitializedAppService`
    // handed synchronous callers an object whose paths were never resolved.
    const service = new NativeAppService();
    await service.init();
    nativeAppService = service;
  }
  return nativeAppService;
};

let webAppService: AppService | null = null;
const getWebAppService = async () => {
  if (!webAppService) {
    const { WebAppService } = await import('@/services/webAppService');
    const service = new WebAppService();
    await service.init();
    webAppService = service;
  }
  return webAppService;
};

const environmentConfig: EnvConfigType = {
  getAppService: async () => {
    if (isTauriAppPlatform()) {
      return getNativeAppService();
    } else {
      return getWebAppService();
    }
  },
};

/**
 * Synchronously returns the app service if it has already been created by
 * {@link environmentConfig.getAppService}; null before first init. The async
 * getter is preferred everywhere — use this only from synchronous code paths
 * that run well after startup (e.g. capability checks during reader render),
 * where the singleton is guaranteed to exist.
 */
export const getInitializedAppService = (): AppService | null => nativeAppService ?? webAppService;

export default environmentConfig;
