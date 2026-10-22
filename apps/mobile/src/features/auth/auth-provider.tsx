import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { mobileApi, type MobileUser } from '@/lib/api';

interface AuthContextValue {
  user: MobileUser | null;
  loading: boolean;
  error: string | null;
  signIn(email: string, password: string): Promise<MobileUser>;
  signOut(): Promise<void>;
  retryRestore(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const retryRestore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUser(await mobileApi.restore());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sesija se nije mogla obnoviti.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void retryRestore();
  }, [retryRestore]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const profile = await mobileApi.login(email.trim(), password);
      setUser(profile);
      return profile;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Prijava nije uspjela.';
      setError(message);
      throw cause;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await mobileApi.logout();
    } catch {
      // Lokalni token se uklanja i kad mreža nije dostupna.
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, error, signIn, signOut, retryRestore }), [user, loading, error, signIn, signOut, retryRestore]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth mora biti korišten unutar AuthProvider komponente.');
  return value;
}
