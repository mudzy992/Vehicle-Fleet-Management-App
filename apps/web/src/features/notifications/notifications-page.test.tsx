import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type {
  NotificationListResponse,
  NotificationUnreadCount,
  NotificationView,
} from '@vfm/shared/schemas';
import { api } from '../../lib/api.js';
import { NotificationsPage } from './notifications-page.js';

vi.mock('../auth/session.js', () => ({
  useSession: () => ({
    status: 'authenticated',
    hasPermission: (permission: string) =>
      ['notification:view', 'notification:mark_read', 'notification:manage_preferences'].includes(permission),
  }),
}));

const notification: NotificationView = {
  id: '33333333-3333-4333-8333-333333333333',
  type: 'TASK_CREATED',
  title: 'Novi zadatak',
  body: 'Pranje vozila · V-001',
  data: null,
  linkToType: 'TASK',
  linkToId: '44444444-4444-4444-8444-444444444444',
  priority: 'HIGH',
  status: 'PENDING',
  isRead: false,
  readAt: null,
  createdAt: '2026-10-30T10:00:00.000Z',
};
const list: NotificationListResponse = {
  items: [notification],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotificationsPage', () => {
  it('renders personal notifications and marks an item read', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path.startsWith('/notifications?')) return list as never;
      if (path === '/notifications/unread-count') return { count: 1 } as NotificationUnreadCount as never;
      return { items: [] } as never;
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ...notification,
      isRead: true,
      status: 'READ',
      readAt: '2026-10-30T10:01:00.000Z',
    } as never);
    vi.spyOn(api, 'openEventStream').mockImplementation(
      (_path, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
    );

    const { unmount } = renderPage();
    expect(await screen.findByRole('heading', { name: 'Novi zadatak' })).toBeTruthy();
    expect(screen.getByText('Veza uživo: uspostavlja se')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Označi pročitano' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/notifications/${notification.id}/read`));
    expect(get).toHaveBeenCalledWith('/notifications/unread-count');
    unmount();
  });

  it('shows preferences with inactive email clearly identified', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/notifications/unread-count') return { count: 0 } as never;
      if (path === '/notifications/preferences') return { items: [] } as never;
      return { ...list, items: [] } as never;
    });
    vi.spyOn(api, 'openEventStream').mockImplementation(
      (_path, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Postavke' }));
    expect(await screen.findByRole('dialog', { name: 'Postavke obavijesti' })).toBeTruthy();
    expect(screen.getAllByText(/E-mail · neaktivan/u).length).toBeGreaterThan(0);
  });
});
