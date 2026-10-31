import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api.js';
import { LoginApkCta } from './login-apk-cta.js';

function renderCta() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LoginApkCta />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginApkCta', () => {
  it('prikazuje Preuzmi APK kad postoji latest', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      versionCode: 4,
      versionName: '1.0.4',
      releaseNotes: 'Ispravke',
      sha256: 'abc',
      sizeBytes: 2_000_000,
      downloadUrl: '/api/v1/app-releases/latest/file',
    });
    renderCta();
    const download = await screen.findByRole('link', { name: 'Preuzmi APK' });
    expect(download.getAttribute('href')).toBe('/api/v1/app-releases/latest/file');
  });

  it('sakriva CTA kad nema objavljenog APK-a', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError('NOT_FOUND', 'nema', 404));
    renderCta();
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Preuzmi APK' })).toBeNull();
    });
  });
});
