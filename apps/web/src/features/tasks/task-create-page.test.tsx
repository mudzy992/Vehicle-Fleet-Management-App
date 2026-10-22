import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TaskCreatePage } from './task-create-page.js';

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => ['user:view', 'attachment:upload'].includes(permission) }),
}));

const TYPE_ID = '018f0000-0000-7000-8000-000000000201';
const FORM_ID = '018f0000-0000-7000-8000-000000000301';
const VERSION_ID = '018f0000-0000-7000-8000-000000000302';
const FILE_ID = '018f0000-0000-7000-8000-000000000401';
const TASK_ID = '018f0000-0000-7000-8000-000000000501';
const DEFINITION = {
  $schema: 'vfm-form/1',
  meta: { title: 'Fotografije zadatka', subject: 'TASK' },
  sections: [{
    key: 'dokaz',
    title: 'Dokaz',
    order: 1,
    fields: [{
      key: 'photosAfter',
      type: 'PHOTO',
      label: 'Fotografije nakon rada',
      required: true,
      order: 1,
      validation: { minFiles: 1, maxFiles: 2, maxSizeMb: 2, mimeTypes: ['image/jpeg'] },
    }],
  }],
};
const TYPE = {
  id: TYPE_ID,
  code: 'WASH',
  name: 'Pranje vozila',
  description: null,
  iconName: null,
  colorHex: null,
  requiresVehicle: false,
  requiresOdometer: false,
  requiresPhotos: true,
  defaultPriority: 'NORMAL',
  defaultAssignMode: 'OPEN_CLAIM',
  allowMultipleClaimants: false,
  dueOffsetHours: null,
  formSchemaId: FORM_ID,
  formSchemaKey: 'wash',
  formSchemaName: 'Fotografije zadatka',
  formSchemaVersion: 1,
  active: true,
  sortOrder: 1,
  completionRequirementCount: 1,
  createdAt: '2026-10-22T08:00:00.000Z',
  updatedAt: '2026-10-22T08:00:00.000Z',
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TaskCreatePage', () => {
  it('uploaduje PHOTO polje prije kreiranja i šalje ID uz formu', async () => {
    let createPayload: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/task-types?')) return response({ items: [TYPE], page: 1, pageSize: 100, total: 1, totalPages: 1 });
      if (url.includes('/vehicles?')) return response({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 });
      if (url.includes('/users?')) return response({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 });
      if (url.endsWith('/form-schemas?subject=TASK&status=PUBLISHED')) {
        return response([{ id: FORM_ID, key: 'wash', name: 'Fotografije zadatka', subject: 'TASK', taskTypeId: null, description: null, ownerModule: null, status: 'PUBLISHED', currentPublishedVersionId: VERSION_ID, currentPublishedVersion: 1, versionCount: 1, updatedAt: '2026-10-22T08:00:00.000Z', createdAt: '2026-10-22T08:00:00.000Z' }]);
      }
      if (url.endsWith(`/form-schemas/${FORM_ID}/versions/${VERSION_ID}`)) {
        return response({ id: VERSION_ID, formSchemaId: FORM_ID, version: 1, status: 'PUBLISHED', definition: DEFINITION });
      }
      if (url.endsWith('/attachments') && init?.method === 'POST') {
        expect(init.body).toBeInstanceOf(FormData);
        expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
        return response({ id: FILE_ID, fileName: 'dokaz.jpg', mimeType: 'image/jpeg', ext: 'jpg', sizeBytes: 100, sha256: 'a'.repeat(64) }, 201);
      }
      if (url.endsWith('/tasks') && init?.method === 'POST') {
        createPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response({ id: TASK_ID, status: 'OPEN' }, 201);
      }
      return response({ error: { code: 'NOT_FOUND', message: 'Nije pronađeno.' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/zadaci/novi']}>
          <Routes>
            <Route path="/zadaci/novi" element={<TaskCreatePage />} />
            <Route path="/zadaci/:taskId" element={<p data-testid="task-created">Detalj zadatka</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Vrsta zadatka *'), { target: { value: TYPE_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Nastavi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nastavi' }));
    const upload = await screen.findByLabelText('Fotografije nakon rada *');
    fireEvent.change(upload, { target: { files: [new File(['jpeg'], 'dokaz.jpg', { type: 'image/jpeg' })] } });
    await screen.findByText('Dodano fajlova: 1');
    fireEvent.click(screen.getByRole('button', { name: 'Kreiraj zadatak' }));

    expect(await screen.findByTestId('task-created')).toBeTruthy();
    await waitFor(() => expect(createPayload?.['formData']).toEqual({ photosAfter: [FILE_ID] }));
  });
});
