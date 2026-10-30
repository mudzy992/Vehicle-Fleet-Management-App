import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { mobileApi, onAuthExpired, toUserMessage, type MobileUser } from '@/lib/api';
import { registerPushToken, unregisterPushToken } from '@/features/notifications/push-registration';

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
      const profile = await mobileApi.restore();
      setUser(profile);
      if (profile) await registerPushToken(profile.permissions);
    } catch (cause) {
      setError(toUserMessage(cause, 'Sesija se nije mogla obnoviti.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void retryRestore();
  }, [retryRestore]);

  useEffect(() => onAuthExpired(() => {
    setUser(null);
    setError('Sesija je istekla. Prijavite se ponovo da nastavite.');
  }), []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const profile = await mobileApi.login(email.trim(), password);
      setUser(profile);
      await registerPushToken(profile.permissions);
      return profile;
    } catch (cause) {
      const message = toUserMessage(cause, 'Prijava nije uspjela.');
      setError(message);
      throw cause;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await unregisterPushToken();
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
