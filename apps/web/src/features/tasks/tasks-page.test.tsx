import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthUser, TaskListResponse, TaskView } from '@vfm/shared/schemas';
import { setAccessToken, setSessionExpiredHandler } from '../../lib/api.js';
import { SessionProvider } from '../auth/session.js';
import { TasksPage } from './tasks-page.js';

const USER: AuthUser = {
  id: '018f0000-0000-7000-8000-000000000002',
  email: 'ana.anic@vfm.test',
  firstName: 'Ana',
  lastName: 'Anić',
  displayName: null,
  status: 'ACTIVE',
  roles: [{ id: '018f0000-0000-7000-8000-0000000000b1', code: 'ADMINISTRATOR', name: 'Administrator' }],
  permissions: ['task:view', 'task:claim'],
  permissionsVersion: 3,
  tokenVersion: 4,
  mustChangePassword: false,
  isSuperAdmin: false,
  allowedClientTypes: ['WEB'],
  timezone: 'Europe/Sarajevo',
  locale: 'bs',
  lastLoginAt: null,
};

const TASK = {
  id: '018f0000-0000-7000-8000-000000000101',
  code: 'Z-2026-000001',
  title: 'Pranje vozila',
  description: 'Vanjsko i unutrašnje pranje.',
  vehicleId: null,
  vehicleInternalNo: 'V-003',
  vehicleMake: 'Škoda',
  vehicleModel: 'Octavia',
  vehiclePlateNumber: null,
  taskTypeId: '018f0000-0000-7000-8000-000000000201',
  taskTypeCode: 'WASH',
  taskTypeName: 'Pranje vozila',
  taskTypeIconName: null,
  taskTypeColorHex: null,
  priority: 'HIGH',
  status: 'OPEN',
  assignMode: 'OPEN_CLAIM',
  createdById: '018f0000-0000-7000-8000-000000000002',
  createdByName: 'Ana Anić',
  assigneeUserId: null,
  assigneeName: null,
  claimedAt: null,
  completedAt: null,
  completedById: null,
  dueAt: '2026-10-23T16:00:00.000Z',
  dueDate: '2026-10-23',
  isOverdue: false,
  cancelledAt: null,
  cancelReason: null,
  reopenedAt: null,
  releasedAt: null,
  durationMinutes: null,
  odometerKm: null,
  totalCost: null,
  fuelLiters: null,
  fuelAmount: null,
  fuelConsumptionL100: null,
  formSchemaId: '018f0000-0000-7000-8000-000000000301',
  formSchemaKey: 'wash',
  formSchemaName: 'Pranje',
  formSchemaVersionId: '018f0000-0000-7000-8000-000000000302',
  formSchemaVersion: 1,
  orderFormSchemaId: '018f0000-0000-7000-8000-000000000301',
  realizationFormSchemaId: null,
  realizationFormSchemaVersionId: null,
  linkedRecordType: null,
  linkedRecordId: null,
  version: 0,
  createdAt: '2026-10-22T08:00:00.000Z',
  updatedAt: '2026-10-22T08:00:00.000Z',
} as unknown as TaskView;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken(null);
  setSessionExpiredHandler(null);
});

describe('TasksPage', () => {
  it('učitava slobodne zadatke i izvršava atomski claim', async () => {
    let claimed = false;
    const initial: TaskListResponse = { items: [TASK], page: 1, pageSize: 25, total: 1, totalPages: 1 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/auth/refresh')) return jsonResponse({ accessToken: 'token-1' });
        if (url.endsWith('/auth/me')) return jsonResponse(USER);
        if (url.includes('/tasks/available')) {
          return jsonResponse(claimed ? { ...initial, items: [], total: 0, totalPages: 0 } : initial);
        }
        if (url.endsWith(`/tasks/${TASK.id}/claim`)) {
          claimed = true;
          return jsonResponse({ ...TASK, status: 'IN_PROGRESS', assigneeName: 'Ana Anić', version: 1 });
        }
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Nije pronađeno.' } }, 404);
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <SessionProvider>
            <TasksPage />
          </SessionProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Pranje vozila')).toBeTruthy();
    expect(screen.getByText('Slobodni')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preuzmi' }));
    expect((await screen.findByRole('status')).textContent).toContain('Preuzeli ste zadatak Z-2026-000001.');
    await waitFor(() => expect(claimed).toBe(true));
  });
});
