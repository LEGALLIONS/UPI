import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, createApi, type Api, type MeView } from './api';

const TOKEN_KEY = 'epay.session';

type Status = 'loading' | 'unreachable' | 'signed-out' | 'signed-in';

interface Session {
  status: Status;
  me: MeView | null;
  /** The server is in sandbox mode: no real money, and screens offer buttons to simulate each step. */
  sandbox: boolean;
  api: Api;
  error: string | null;
  signIn(token: string, me: MeView): Promise<void>;
  signOut(): Promise<void>;
  /** Reloads the signed-in user, e.g. to see whether their account is verified yet. */
  refresh(): Promise<MeView | null>;
  retry(): void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeView | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const api = useMemo(() => createApi(token), [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const config = await createApi(null).config();
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        const savedMe = saved ? await createApi(saved).me().catch(signedOutOn401) : null;
        if (cancelled) return;
        setSandbox(config.sandbox);
        if (saved && savedMe) {
          setToken(saved);
          setMe(savedMe);
          setStatus('signed-in');
        } else {
          if (saved) await SecureStore.deleteItemAsync(TOKEN_KEY);
          setStatus('signed-out');
        }
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus('unreachable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const signIn = useCallback(async (newToken: string, newMe: MeView) => {
    await SecureStore.setItemAsync(TOKEN_KEY, newToken);
    setToken(newToken);
    setMe(newMe);
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setMe(null);
    setStatus('signed-out');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const latest = await api.me();
      setMe(latest);
      return latest;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) await signOut();
      throw caught;
    }
  }, [api, signOut]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const value = useMemo(
    () => ({ status, me, sandbox, api, error, signIn, signOut, refresh, retry }),
    [status, me, sandbox, api, error, signIn, signOut, refresh, retry],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** An expired or unknown token means signed out; anything else is a real error. */
function signedOutOn401(error: unknown): null {
  if (error instanceof ApiError && error.status === 401) return null;
  throw error;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
