import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReminderListResponse } from '@vfm/shared/schemas';
import { ApiError, api } from '../../lib/api.js';
import { RemindersPage } from './reminders-page.js';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => session.permissions.includes(permission) }),
}));

const REMINDER_ID = '018f0000-0000-7000-8000-000000000333';
const REMINDER_LIST: ReminderListResponse = {
  items: [
    {
      id: REMINDER_ID,
      kind: 'SERVICE_KM',
      entityType: 'Vehicle',
      entityId: '018f0000-0000-7000-8000-000000000111',
      dueDate: null,
      dueKm: 120000,
      thresholdDays: null,
      thresholdKm: 10000,
      fireAt: '2026-10-29T08:30:00.000Z',
      status: 'SCHEDULED',
      sentAt: null,
      acknowledgedAt: null,
      due: true,
      createdAt: '2026-10-28T08:30:00.000Z',
    },
  ],
  page: 1,
  pageSize: 50,
  total: 1,
  totalPages: 1,
};

function renderReminders() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RemindersPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  session.permissions = [];
  vi.restoreAllMocks();
});

describe('RemindersPage', () => {
  it('restricts acknowledge, snooze and maintenance actions by permission', async () => {
    session.permissions = [];
    const post = vi.spyOn(api, 'post');
    vi.spyOn(api, 'get').mockResolvedValue(REMINDER_LIST);

    renderReminders();

    expect(await screen.findByText('Vehicle')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Potvrdi' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+7 d' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pokreni skener' })).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('renders kilometre-based due time and runs permitted reminder actions', async () => {
    session.permissions = ['reminder:acknowledge', 'reminder:snooze', 'system:run_maintenance'];
    const post = vi.spyOn(api, 'post').mockImplementation(async <T,>(path: string) => {
      if (path === '/reminders/scan') return { candidates: 2, created: 1 } as T;
      return undefined as T;
    });
    vi.spyOn(api, 'get').mockResolvedValue(REMINDER_LIST);

    renderReminders();

    expect(await screen.findByText(/120.*km/)).toBeTruthy();
    expect(
      screen.getByText(
        new Date(REMINDER_LIST.items[0]!.fireAt).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' }),
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Potvrdi' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Potvrdi' }));
    expect(await screen.findByText('Podsjetnik je potvrđen.')).toBeTruthy();
    await waitFor(() =>
      expect(post.mock.calls.some(([path]) => path === `/reminders/${REMINDER_ID}/acknowledge`)).toBe(true),
    );

    fireEvent.click(screen.getByRole('button', { name: '+7 d' }));
    expect(await screen.findByText('Podsjetnik je odgođen.')).toBeTruthy();
    await waitFor(() =>
      expect(post.mock.calls.some(([path]) => path === `/reminders/${REMINDER_ID}/snooze`)).toBe(true),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pokreni skener' }));
    expect(await screen.findByText('Sken završen: 2 kandidata, 1 novih podsjetnika.')).toBeTruthy();
    await waitFor(() => expect(post.mock.calls.some(([path]) => path === '/reminders/scan')).toBe(true));
  });

  it('shows a query error instead of an empty reminder state', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderReminders();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Podsjetnici nisu dostupni.')).toBeTruthy();
    expect(screen.queryByText('Nema podsjetnika')).toBeNull();
  });

  it('sends selected filters and pagination to the server', async () => {
    const requested: string[] = [];
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      requested.push(path);
      return { ...REMINDER_LIST, total: 51, totalPages: 2 } as T;
    });

    renderReminders();
    expect(await screen.findByText('Vehicle')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Vrsta'), { target: { value: 'SERVICE_KM' } });
    await waitFor(() => expect(requested.some((path) => path.includes('kind=SERVICE_KM'))).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Sljedeća' }));
    await waitFor(() => expect(requested.some((path) => path.includes('page=2'))).toBe(true));
  });

  it('announces mutation conflicts instead of success', async () => {
    session.permissions = ['reminder:acknowledge'];
    vi.spyOn(api, 'get').mockResolvedValue(REMINDER_LIST);
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError('CONFLICT', 'Podsjetnik je već obrađen.', 409));

    renderReminders();
    fireEvent.click(await screen.findByRole('button', { name: 'Potvrdi' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Podsjetnik je već obrađen.')).toBeTruthy();
    expect(screen.queryByText('Podsjetnik je potvrđen.')).toBeNull();
  });
});
