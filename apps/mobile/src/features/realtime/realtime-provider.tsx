import { useEffect, type PropsWithChildren } from 'react';
import { useUnreadCount } from '@/features/notifications/unread-store';

export function RealtimeProvider({ children }: PropsWithChildren) {
  const unread = useUnreadCount();
  useEffect(() => {
    let socket: { disconnect: () => void } | null = null;
    void import('socket.io-client')
      .then(({ io }) => {
        const origin = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/u, '') ?? '';
        if (!origin) return;
        socket = io(`${origin}/realtime`, { transports: ['websocket'] });
        socket.on('refresh', (payload: { topic?: string }) => {
          if (payload.topic === 'notifications' || !payload.topic) void unread.refresh();
        });
      })
      .catch(() => undefined);
    return () => {
      socket?.disconnect();
    };
  }, [unread]);
  return children;
}
