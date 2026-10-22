/**
 * Sesija korisnika u web aplikaciji (docs/06 §5.4, docs/05 §5).
 *
 * Zašto context, a ne globalni store: sesija ima malo stanja (korisnik, status)
 * i mijenja se samo na prijavi/odjavi/refreshu — React context je dovoljan i
 * nema dodatne dependencije.
 *
 * Tok pri učitavanju stranice:
 * 1. `POST /auth/refresh` (httpOnly cookie) → access token u memoriji,
 * 2. `GET /auth/me` → korisnik + efektivna prava,
 * 3. ako refresh padne → `anonymous` (UI prikazuje `/prijava`).
 *
 * `hasPermission()` je **samo UX**: server je autoritet (docs/05 §0) i svaki
 * zahtjev nosi svoj token; sakrivena dugmad ne znače da je akcija dozvoljena.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthTokenResponse, AuthUser } from '@vfm/shared/schemas';
import { ApiError, api, refreshAccessToken, setAccessToken, setSessionExpiredHandler } from '../../lib/api.js';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

export interface SessionValue {
  readonly user: AuthUser | null;
  readonly status: SessionStatus;
  readonly login: (credentials: LoginCredentials) => Promise<AuthUser>;
  readonly logout: (options?: { serverAlreadyRevoked?: boolean }) => Promise<void>;
  readonly reload: () => Promise<void>;
  /** UX provjera prava; server i dalje odlučuje (P14). */
  readonly hasPermission: (permission: string) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadMe = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const me = await api.get<AuthUser>('/auth/me');
      if (mounted.current) {
        setUser(me);
        setStatus('authenticated');
      }
      return me;
    } catch {
      if (mounted.current) {
        setUser(null);
        setStatus('anonymous');
      }
      return null;
    }
  }, []);

  /** Prvo učitavanje: refresh iz cookie-ja pa profil. */
  useEffect(() => {
    void (async () => {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        if (mounted.current) setStatus('anonymous');
        return;
      }
      await loadMe();
    })();
  }, [loadMe]);

  /** Kad refresh u klijentu padne (istekla sesija), stanje se čisti. */
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const login = useCallback(async (credentials: LoginCredentials): Promise<AuthUser> => {
    const result = await api.post<AuthTokenResponse>('/auth/login', {
      ...credentials,
      clientType: 'WEB',
    });

    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus('authenticated');
    return result.user;
  }, []);

  const logout = useCallback(async (options: { serverAlreadyRevoked?: boolean } = {}): Promise<void> => {
    try {
      if (!options.serverAlreadyRevoked) await api.post<void>('/auth/logout');
    } catch (error) {
      // Odjava mora uspjeti lokalno i kad server nije dostupan.
      if (!(error instanceof ApiError)) throw error;
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    await loadMe();
  }, [loadMe]);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!user) return false;
      if (user.isSuperAdmin) return true;
      return user.permissions.includes(permission);
    },
    [user],
  );

  const value = useMemo<SessionValue>(
    () => ({ user, status, login, logout, reload, hasPermission }),
    [user, status, login, logout, reload, hasPermission],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Pristup sesiji; baca ako se koristi izvan `SessionProvider` (greška u kodu). */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession mora biti unutar <SessionProvider>.');
  return value;
}

/** Skraćenica za `useSession().hasPermission` (najčešći slučaj u UI-u). */
export function usePermission(permission: string): boolean {
  return useSession().hasPermission(permission);
}
