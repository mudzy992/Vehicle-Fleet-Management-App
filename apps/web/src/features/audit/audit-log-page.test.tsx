import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { AuditLogDetail, AuditLogListResponse, AuditLogSummary } from '@vfm/shared/schemas';
import { api } from '../../lib/api.js';
import { AuditLogPage } from './audit-log-page.js';

const ROW: AuditLogSummary = {
  id: '42',
  action: 'ROLE_CHANGE',
  severity: 'WARN',
  actorId: '018f0000-0000-7000-8000-000000000002',
  actorEmail: 'admin@example.test',
  actorRoles: ['Administrator'],
  entityType: 'User',
  entityId: '018f0000-0000-7000-8000-000000000003',
  changedFields: ['roles'],
  reason: null,
  requestId: 'req-audit-1',
  ipAddress: null,
  userAgent: null,
  clientType: 'WEB',
  createdAt: '2026-10-28T10:00:00.000Z',
};

const LIST: AuditLogListResponse = {
  items: [ROW],
  page: 1,
  pageSize: 50,
  total: 1,
  totalPages: 1,
  securityHidden: false,
};

const DETAIL: AuditLogDetail = {
  ...ROW,
  before: { name: 'Ana Anić' },
  after: { name: 'Ana Aničić' },
  metadata: null,
};

function renderAuditPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuditLogPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('AuditLogPage', () => {
  it('shows security-hidden and empty states explicitly', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 50,
      total: 0,
      totalPages: 0,
      securityHidden: true,
    } as never);

    renderAuditPage();

    expect(await screen.findByText('Nema zapisa')).toBeTruthy();
    expect(screen.getByText(/audit:view_security/)).toBeTruthy();
  });

  it('applies server filters and loads before/after detail only on demand', async () => {
    const requested: string[] = [];
    vi.spyOn(api, 'get').mockImplementation(async <T,>(path: string) => {
      requested.push(path);
      if (path === '/audit-logs/42') return DETAIL as T;
      return LIST as T;
    });

    renderAuditPage();

    expect(await screen.findByText('ROLE_CHANGE')).toBeTruthy();
    expect(requested.some((path) => path === '/audit-logs/42')).toBe(false);
    fireEvent.change(screen.getByLabelText('Ozbiljnost'), { target: { value: 'WARN' } });
    await waitFor(() => expect(requested.some((path) => path.includes('severity=WARN'))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Detalj' }));
    expect(await screen.findByText(/Ana Anić/)).toBeTruthy();
    expect(screen.getByText(/Ana Aničić/)).toBeTruthy();
    expect(requested).toContain('/audit-logs/42');
  });

  it('does not misrepresent a network failure as an empty audit log', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new TypeError('network unavailable'));

    renderAuditPage();

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Greška pri učitavanju audit loga.')).toBeTruthy();
    expect(screen.queryByText('Nema zapisa')).toBeNull();
  });
});
