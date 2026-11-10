import { FileSystem } from '@/types/system';
import { safeLoadJSON, safeSaveJSON } from '@/services/persistence';
import { isTauriAppPlatform, CUSTOM_BACKEND_STORAGE_KEY } from '@/services/environment';

export const SESSION_FILENAME = 'session.json';

export interface PersistedSession {
  token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
  };
  customBackendUrl?: string | null;
}

const getFs = async (): Promise<FileSystem | null> => {
  if (typeof window === 'undefined') return null;
  if (!isTauriAppPlatform()) return null;
  try {
    const { nativeFileSystem } = await import('@/services/nativeAppService');
    return nativeFileSystem;
  } catch {
    return null;
  }
};

/**
 * Save auth session to localStorage AND persistent storage (session.json in Settings base directory).
 * This protects against origin/port changes across CEF / desktop app launches.
 */
export const savePersistedSession = async (
  session: PersistedSession,
  customFs?: FileSystem,
): Promise<void> => {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('token', session.token);
      window.localStorage.setItem('refresh_token', session.refresh_token || session.token);
      window.localStorage.setItem('user', JSON.stringify(session.user));
      if (session.customBackendUrl) {
        window.localStorage.setItem(CUSTOM_BACKEND_STORAGE_KEY, session.customBackendUrl);
      }
    } catch (e) {
      console.warn('Failed to save session to localStorage:', e);
    }
  }

  try {
    const fs = customFs || (await getFs());
    if (fs) {
      await safeSaveJSON(fs, SESSION_FILENAME, 'Settings', session);
    }
  } catch (error) {
    console.error('Failed to persist session to file:', error);
  }
};

/**
 * Load auth session. Checks localStorage first; if missing (e.g. CEF port changed on restart),
 * falls back to reading session.json from persistent Settings storage and mirrors it back to localStorage.
 */
export const loadPersistedSession = async (
  customFs?: FileSystem,
): Promise<PersistedSession | null> => {
  // 1. Try reading from localStorage first
  if (typeof window !== 'undefined') {
    try {
      const token = window.localStorage.getItem('token');
      const userJson = window.localStorage.getItem('user');
      const refreshToken = window.localStorage.getItem('refresh_token');
      const customBackendUrl = window.localStorage.getItem(CUSTOM_BACKEND_STORAGE_KEY);
      if (token && userJson) {
        const user = JSON.parse(userJson);
        return {
          token,
          refresh_token: refreshToken || token,
          user,
          customBackendUrl,
        };
      }
    } catch {
      // JSON parse error or localStorage unavailable, fall through to filesystem
    }
  }

  // 2. Fall back to reading from filesystem
  try {
    const fs = customFs || (await getFs());
    if (fs) {
      const session = await safeLoadJSON<PersistedSession | null>(
        fs,
        SESSION_FILENAME,
        'Settings',
        null,
      );
      if (session && session.token && session.user) {
        // Mirror back to localStorage for the current port/origin
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem('token', session.token);
            window.localStorage.setItem('refresh_token', session.refresh_token || session.token);
            window.localStorage.setItem('user', JSON.stringify(session.user));
            if (session.customBackendUrl) {
              window.localStorage.setItem(CUSTOM_BACKEND_STORAGE_KEY, session.customBackendUrl);
            }
          } catch (e) {
            console.warn('Failed to mirror restored session to localStorage:', e);
          }
        }
        return session;
      }
    }
  } catch (error) {
    console.warn('Failed to load persisted session from file:', error);
  }

  return null;
};

/**
 * Clear session from both localStorage and persistent storage.
 */
export const clearPersistedSession = async (customFs?: FileSystem): Promise<void> => {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('refresh_token');
      window.localStorage.removeItem('user');
    } catch (e) {
      console.warn('Failed to clear session from localStorage:', e);
    }
  }

  try {
    const fs = customFs || (await getFs());
    if (fs) {
      await fs.removeFile(SESSION_FILENAME, 'Settings').catch(() => {});
      await fs.removeFile(`${SESSION_FILENAME}.bak`, 'Settings').catch(() => {});
    }
  } catch (error) {
    console.warn('Failed to remove persisted session file:', error);
  }
};
