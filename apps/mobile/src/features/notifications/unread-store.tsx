import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { mobileApi } from '@/lib/api';

interface UnreadValue {
  count: number;
  refresh(): Promise<void>;
  setCount(count: number): void;
}

const UnreadContext = createContext<UnreadValue | null>(null);

export function UnreadProvider({ children }: PropsWithChildren) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const result = await mobileApi.unreadNotificationCount();
      setCount(result.count);
    } catch {
      // Badge ostaje zadnja poznata vrijednost; lista prikazuje grešku.
    }
  }, []);
  const value = useMemo(() => ({ count, refresh, setCount }), [count, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnreadCount(): UnreadValue {
  const value = useContext(UnreadContext);
  if (!value) throw new Error('useUnreadCount mora biti unutar UnreadProvider.');
  return value;
}
