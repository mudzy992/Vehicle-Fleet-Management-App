import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';

/** Osvježava listu zadataka i obavijesti kad API emituje Socket.IO `refresh`. */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const origin = window.location.origin.replace(/:\d+$/u, ':3000');
    let socket: Socket | null = null;
    void import('socket.io-client')
      .then(({ io }) => {
        socket = io(`${origin}/realtime`, { transports: ['websocket'], withCredentials: true });
        socket.on('refresh', (payload: { topic?: string }) => {
          if (payload.topic === 'notifications' || !payload.topic) {
            void queryClient.invalidateQueries({ queryKey: ['notifications'] });
            void queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
          }
          if (payload.topic === 'tasks' || !payload.topic) {
            void queryClient.invalidateQueries({ queryKey: ['tasks'] });
            void queryClient.invalidateQueries({ queryKey: ['task'] });
          }
        });
      })
      .catch(() => undefined);
    return () => {
      socket?.disconnect();
    };
  }, [queryClient]);

  return children;
}
