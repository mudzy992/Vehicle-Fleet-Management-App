import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { DriverDetail, DriverLicenseCategoryList } from '@vfm/shared/schemas';
import { ApiError, api } from '../../lib/api.js';
import { DriverDetailPage } from './driver-detail-page.js';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => session.permissions.includes(permission) }),
}));

const DRIVER_ID = '018f0000-0000-7000-8000-000000000555';
const CATEGORY_ID = '018f0000-0000-7000-8000-000000000556';
const DRIVER: DriverDetail = {
  id: DRIVER_ID,
  firstName: 'Ana',
  lastName: 'Anić',
  employeeNumber: 'D-012',
  employmentStatus: 'ACTIVE',
  status: 'ACTIVE',
  licenseExpiresAt: '2027-12-31',
  categories: ['B'],
  licenseDaysLeft: 428,
  version: 1,
  updatedAt: '2026-10-28T12:00:00.000Z',
  phone: null,
  email: null,
  dateOfBirth: null,
  address: null,
  licenseNumber: null,
  licenseIssuedAt: null,
  licenseIssuingAuthority: null,
  restrictions: null,
  notes: null,
  photoAttachmentId: null,
  formSchemaId: '018f0000-0000-7000-8000-000000000557',
  formSchemaVersionId: '018f0000-0000-7000-8000-000000000558',
  formData: {},
  piiRedacted: true,
  createdAt: '2026-01-01T08:00:00.000Z',
};
const EMPTY_CATEGORIES: DriverLicenseCategoryList = { items: [] };
const CATEGORIES: DriverLicenseCategoryList = {
  items: [
    {
      id: CATEGORY_ID,
      category: 'B',
      issuedAt: '2020-01-01',
      expiresAt: '2027-12-31',
      restrictions: null,
      notes: null,
    },
  ],
};

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/vozaci/${DRIVER_ID}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/vozaci/:driverId" element={<DriverDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  session.permissions = [];
  vi.restoreAllMocks();
});

describe('DriverDetailPage', () => {
  it('states that PII is redacted and does not misrepresent category API failure as empty', async () => {
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      if (path === `/drivers/${DRIVER_ID}`) return DRIVER as T;
      throw new TypeError('network unavailable');
    });

    renderDetail();

    expect(await screen.findByText(/Lični podaci su maskirani — potrebna je permisija/)).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Greška pri učitavanju kategorija dozvole.')).toBeTruthy();
    expect(screen.queryByText('Nema kategorija')).toBeNull();
  });

  it('announces archive API failures', async () => {
    session.permissions = ['driver:archive'];
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) =>
      (path === `/drivers/${DRIVER_ID}` ? DRIVER : EMPTY_CATEGORIES) as T,
    );
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError('CONFLICT', 'Vozač ima aktivne zadatke.', 409));

    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Arhiviraj' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Vozač ima aktivne zadatke.')).toBeTruthy();
  });

  it('announces category delete failures next to the affected action', async () => {
    session.permissions = ['driver:update'];
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) =>
      (path === `/drivers/${DRIVER_ID}` ? DRIVER : CATEGORIES) as T,
    );
    vi.spyOn(api, 'delete').mockRejectedValue(new ApiError('CONFLICT', 'Kategorija je u upotrebi.', 409));

    renderDetail();

    expect(await screen.findByText('B', { selector: 'td' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Obriši' }));
    expect(await screen.findByText('Kategorija je u upotrebi.')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
