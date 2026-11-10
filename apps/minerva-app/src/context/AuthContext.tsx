'use client';

import {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  ReactNode,
  useEffect,
} from 'react';
import { User } from '@supabase/supabase-js';
import { authClient } from '@/services/authClient';
import { isPostHogEnabled } from '@/context/PHContext';
import posthog from 'posthog-js';
import {
  loadPersistedSession,
  savePersistedSession,
  clearPersistedSession,
} from '@/services/sessionPersistence';

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  });
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      const userJson = localStorage.getItem('user');
      return userJson ? JSON.parse(userJson) : null;
    }
    return null;
  });

  useEffect(() => {
    const syncSession = (
      session: { access_token: string; refresh_token: string; user: User } | null,
    ) => {
      if (session) {
        console.log('Syncing session');
        const { access_token, refresh_token, user } = session;
        localStorage.setItem('token', access_token);
        localStorage.setItem('refresh_token', refresh_token);
        localStorage.setItem('user', JSON.stringify(user));
        savePersistedSession({
          token: access_token,
          refresh_token: refresh_token || access_token,
          user: user as unknown as { id: string; email: string },
        }).catch((e) => console.warn('Failed to persist session in syncSession:', e));
        // The SDK throws when it was never initialized, which is the case for
        // every deployment without a PostHog key.
        if (isPostHogEnabled()) posthog.identify(user.id);
        setToken(access_token);
        setUser(user);
      } else {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
      }
    };
    const auth = authClient();
    const initAndRefreshSession = async () => {
      let activeToken = token;
      let activeUser = user;
      if (!activeToken || !activeUser) {
        const persisted = await loadPersistedSession();
        if (persisted && persisted.token && persisted.user) {
          activeToken = persisted.token;
          activeUser = persisted.user as unknown as User;
          syncSession({
            access_token: persisted.token,
            refresh_token: persisted.refresh_token || persisted.token,
            user: activeUser,
          });
        }
      }
      try {
        await auth.refreshSession();
      } catch {
        // Do not immediately wipe if we have a valid persisted session (e.g. offline start)
        if (!activeToken) {
          syncSession(null);
        }
      }
    };

    const { data: subscription } = auth.onAuthStateChange((_, session) => {
      syncSession(session);
    });

    initAndRefreshSession();
    return () => {
      subscription?.subscription.unsubscribe();
    };
  }, []);

  // setToken / setUser from useState are stable across renders, so the empty
  // deps array is correct. Wrapping in useCallback (and only including stable
  // refs in the deps) is what makes the useMemo below actually memoize the
  // context value — without this, login/logout/refresh would be recreated on
  // every render and the memo would always invalidate.
  const login = useCallback((newToken: string, newUser: User) => {
    console.log('Logging in');
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    savePersistedSession({
      token: newToken,
      refresh_token: newToken,
      user: newUser as unknown as { id: string; email: string },
    }).catch((e) => console.warn('Failed to persist session on login:', e));
  }, []);

  const logout = useCallback(async () => {
    console.log('Logging out');
    const auth = authClient();
    try {
      await auth.refreshSession();
    } catch {
    } finally {
      await auth.signOut({ scope: 'local' });
      await clearPersistedSession().catch((e) =>
        console.warn('Failed to clear persisted session:', e),
      );
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      await authClient().refreshSession();
    } catch {}
  }, []);

  const value = useMemo(
    () => ({ token, user, login, logout, refresh }),
    [token, user, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
