import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { setAccessToken, setSessionExpiredHandler, api, ApiError } from '../../lib/api.js';
import { DashboardPage } from './dashboard-page.js';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => session.permissions.includes(permission) }),
}));

const ALL_PERMISSIONS = [
  'vehicle:view',
  'driver:view',
  'registration:view',
  'insurance:view',
  'reminder:view',
];
const EMPTY_PAGE = { items: [], page: 1, pageSize: 1, total: 0, totalPages: 0 };

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <DashboardPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  session.permissions = [];
  setAccessToken(null);
  setSessionExpiredHandler(null);
  vi.restoreAllMocks();
});

describe('DashboardPage', () => {
  it('shows a loading state instead of reporting empty vehicle deadlines prematurely', async () => {
    session.permissions = ALL_PERMISSIONS;
    let release!: (value: typeof EMPTY_PAGE) => void;
    const pending = new Promise<typeof EMPTY_PAGE>((resolve) => {
      release = resolve;
    });
    const get = vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      if (path.startsWith('/vehicles?') && path.includes('expiringInDays=30')) return pending as T;
      return EMPTY_PAGE as T;
    });

    renderDashboard();

    expect((await screen.findByRole('status')).textContent).toContain('Učitavanje rokova…');
    expect(screen.queryByText('Ništa ne ističe u narednih 30 dana.')).toBeNull();
    release(EMPTY_PAGE);
    await screen.findByText('Ništa ne ističe u narednih 30 dana.');
    expect(get).toHaveBeenCalled();
  });

  it('surfaces API errors from every permission-enabled widget', async () => {
    session.permissions = ALL_PERMISSIONS;
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      if (path.startsWith('/insurances?')) throw new ApiError('UNAVAILABLE', 'Greška osiguranja', 503);
      return EMPTY_PAGE as T;
    });

    renderDashboard();

    expect(await screen.findByText('Greška osiguranja')).toBeTruthy();
  });

  it('does not render protected dashboard widgets or issue queries without their permissions', async () => {
    session.permissions = [];
    const get = vi.spyOn(api, 'get');

    renderDashboard();

    expect(screen.getByRole('heading', { name: 'Nadzorna tabla' })).toBeTruthy();
    expect(screen.queryByText('Vozila u pogonu')).toBeNull();
    expect(screen.queryByText('Dozvole vozača')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get).not.toHaveBeenCalled();
  });
});
