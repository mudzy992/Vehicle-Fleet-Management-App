import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { VehicleDetail } from '@vfm/shared/schemas';
import { ApiError, api } from '../../lib/api.js';
import { VehicleDetailPage } from './vehicle-detail-page.js';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));
const VEHICLE_ID = '018f0000-0000-7000-8000-000000000701';
const VEHICLE = {
  id: VEHICLE_ID,
  internalNo: 'V-001',
  make: 'Škoda',
  model: 'Octavia',
  year: 2022,
  plateNumber: 'A12-T-345',
  fuelType: 'DIESEL',
  status: 'ACTIVE',
  odometerKm: 45000,
  odometerUpdatedAt: null,
  registrationExpiresAt: null,
  insuranceExpiresAt: null,
  archivedAt: null,
  version: 1,
  updatedAt: '2026-10-28T12:00:00.000Z',
  vin: null,
  transmission: null,
  color: null,
  bodyType: null,
  engineCcm: null,
  enginePowerKw: null,
  seats: null,
  ownershipType: 'OWNED',
  acquisitionDate: null,
  acquisitionPrice: null,
  costCenter: null,
  nextServiceDueDate: null,
  nextServiceDueKm: null,
  notes: null,
  photoAttachmentId: null,
  formSchemaId: '018f0000-0000-7000-8000-000000000702',
  formSchemaVersionId: '018f0000-0000-7000-8000-000000000703',
  formData: {},
  createdAt: '2026-01-01T08:00:00.000Z',
} as VehicleDetail;

vi.mock('../auth/session.js', () => ({
  useSession: () => ({ hasPermission: (permission: string) => session.permissions.includes(permission) }),
}));

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/vozila/${VEHICLE_ID}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/vozila/:vehicleId" element={<VehicleDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  session.permissions = [];
  vi.restoreAllMocks();
});

describe('VehicleDetailPage', () => {
  it('announces archive API failures', async () => {
    session.permissions = ['vehicle:archive'];
    vi.spyOn(api, 'get').mockResolvedValue(VEHICLE);
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError('CONFLICT', 'Vozilo ima aktivne zadatke.', 409));

    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Arhiviraj' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Vozilo ima aktivne zadatke.')).toBeTruthy();
  });

  it('does not misrepresent a registration API failure as an empty state', async () => {
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      if (path === `/vehicles/${VEHICLE_ID}`) return VEHICLE as T;
      throw new TypeError('network unavailable');
    });

    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Registracije' }));
    expect(await screen.findByText('Greška pri učitavanju registracija.')).toBeTruthy();
    expect(screen.queryByText('Nema registracija')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
