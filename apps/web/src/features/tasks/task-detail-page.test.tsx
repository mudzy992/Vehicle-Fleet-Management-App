import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthUser, TaskCommentListResponse, TaskDetail } from '@vfm/shared/schemas';
import { setAccessToken, setSessionExpiredHandler } from '../../lib/api.js';
import { SessionProvider } from '../auth/session.js';
import { TaskDetailPage } from './task-detail-page.js';

const TASK_ID = '018f0000-0000-7000-8000-000000000101';
const USER: AuthUser = {
  id: '018f0000-0000-7000-8000-000000000002',
  email: 'ana.anic@vfm.test',
  firstName: 'Ana',
  lastName: 'Anić',
  displayName: null,
  status: 'ACTIVE',
  roles: [{ id: '018f0000-0000-7000-8000-0000000000b1', code: 'ADMINISTRATOR', name: 'Administrator' }],
  permissions: ['task:view', 'task:comment'],
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
  id: TASK_ID,
  code: 'Z-2026-000001',
  title: 'Pranje vozila',
  description: 'Vanjsko pranje.',
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
  priority: 'NORMAL',
  status: 'OPEN',
  assignMode: 'OPEN_CLAIM',
  createdById: USER.id,
  createdByName: 'Ana Anić',
  assigneeUserId: null,
  assigneeName: null,
  claimedAt: null,
  completedAt: null,
  completedById: null,
  dueAt: null,
  dueDate: null,
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
  formData: { washType: 'FULL' },
  orderFormData: { washType: 'FULL' },
  realizationFormData: {},
  assignments: [],
  events: [
    {
      id: '018f0000-0000-7000-8000-000000000401',
      action: 'CREATED',
      actorId: USER.id,
      actorName: 'Ana Anić',
      actorRole: 'ADMINISTRATOR',
      at: '2026-10-22T08:00:00.000Z',
      clientType: 'WEB',
      requestId: 'req-1',
      data: null,
      formSchemaVersionId: '018f0000-0000-7000-8000-000000000302',
    },
  ],
  attachmentIds: [],
  commentCount: 0,
} as unknown as TaskDetail;
const COMMENT = {
  id: '018f0000-0000-7000-8000-000000000501',
  taskId: TASK_ID,
  authorId: USER.id,
  authorName: 'Ana Anić',
  body: 'Provjera vozila završena.',
  mentionsUserIds: [],
  createdAt: '2026-10-22T09:00:00.000Z',
  updatedAt: '2026-10-22T09:00:00.000Z',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken(null);
  setSessionExpiredHandler(null);
});

describe('TaskDetailPage', () => {
  it('prikazuje detalje, historiju i dodaje komentar', async () => {
    let hasComment = false;
    const comments: TaskCommentListResponse = {
      items: hasComment ? [COMMENT] : [],
      page: 1,
      pageSize: 20,
      total: hasComment ? 1 : 0,
      totalPages: hasComment ? 1 : 0,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/auth/refresh')) return jsonResponse({ accessToken: 'token-1' });
        if (url.endsWith('/auth/me')) return jsonResponse(USER);
        if (url.endsWith(`/tasks/${TASK_ID}/comments?page=1&pageSize=20`)) {
          return jsonResponse({
            ...comments,
            items: hasComment ? [COMMENT] : [],
            total: hasComment ? 1 : 0,
            totalPages: hasComment ? 1 : 0,
          });
        }
        if (url.endsWith(`/tasks/${TASK_ID}/comments`) && init?.method === 'POST') {
          hasComment = true;
          return jsonResponse(COMMENT, 201);
        }
        if (url.endsWith(`/tasks/${TASK_ID}`)) return jsonResponse(TASK);
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Nije pronađeno.' } }, 404);
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <MemoryRouter initialEntries={[`/zadaci/${TASK_ID}`]}>
        <Routes>
          <Route
            path="/zadaci/:taskId"
            element={
              <QueryClientProvider client={client}>
                <SessionProvider>
                  <TaskDetailPage />
                </SessionProvider>
              </QueryClientProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Vanjsko pranje.')).toBeTruthy();
    expect(screen.getByText('Kreiran')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preuzmi zadatak' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Novi komentar' }), {
      target: { value: 'Provjera vozila završena.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj komentar' }));
    expect(await screen.findByText('Provjera vozila završena.')).toBeTruthy();
    await waitFor(() => expect(hasComment).toBe(true));
  });
});
