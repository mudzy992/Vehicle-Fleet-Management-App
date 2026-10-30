import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HealthPage } from './health-page.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockHealthFetch(handler: (path: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    return handler(path);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HealthPage', () => {
  it('renders successful live, ready and startup probes', async () => {
    mockHealthFetch((path) => {
      if (path === '/health/live') return jsonResponse({ status: 'ok' });
      if (path === '/health/ready')
        return jsonResponse({ status: 'ok', info: { database: { status: 'up' } } });
      return jsonResponse({ status: 'ok', uptimeSeconds: 240 });
    });

    render(<HealthPage />);

    await waitFor(() => expect(screen.getAllByText('ok')).toHaveLength(3));
    expect(screen.getByText(/uptime 240 s/)).toBeTruthy();
    expect(screen.queryByText('API nije dostupan')).toBeNull();
    const detailsCard = screen.getByText('Detalji').closest('section');
    expect(detailsCard?.className).toContain('p-4');
    expect(detailsCard?.querySelector('pre')?.className).toContain('rounded-md');
    expect(detailsCard?.querySelector('pre')?.className).toContain('p-3');
  });

  it('shows an actionable unavailable state when all probes fail', async () => {
    const fetchMock = mockHealthFetch(() => Promise.reject(new TypeError('network unavailable')));

    render(<HealthPage />);

    expect(screen.getByRole('status').textContent).toMatch(/Provjeravam API probe/);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('API nije dostupan')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pokušaj ponovo' })).toBeTruthy();
    expect(screen.getAllByText('nepoznato')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Pokušaj ponovo' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
  });

  it('keeps partial probe failures distinct from a total outage', async () => {
    mockHealthFetch((path) => {
      if (path === '/health/live') return jsonResponse({ status: 'error' }, 503);
      if (path === '/health/ready') return jsonResponse({ status: 'error' }, 503);
      return jsonResponse({ status: 'ok', uptimeSeconds: 10 });
    });

    render(<HealthPage />);

    await waitFor(() => expect(screen.getByText(/uptime 10 s/)).toBeTruthy());
    expect(screen.getAllByText('greška')).toHaveLength(2);
    expect(screen.getByText('ok')).toBeTruthy();
    expect(screen.queryByText('API nije dostupan')).toBeNull();
  });
});
