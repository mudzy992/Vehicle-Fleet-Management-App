import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    /**
     * Coverage se mjeri nad **logikom**, ne nad prezentacijom.
     *
     * Zašto: ekrani (forme, tabele, modali) nemaju smisla u unit coverage-u —
     * provjeravaju se E2E testovima (Faza 6, Maestro/Playwright). Ako bi ušli u
     * izvještaj, prag bi se rušio na svakom novom ekranu i tjerao na lažne
     * testove koji klikću po DOM-u bez provjere ponašanja.
     *
     * Uključeno: API klijent, sesija, guard-ovi, navigacija, diff matrice prava,
     * UI primitivi s logikom (badge).
     */
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/api.ts',
        'src/app/nav.ts',
        'src/app/guards.tsx',
        'src/features/auth/session.tsx',
        'src/features/roles/matrix.ts',
        'src/features/forms/forms-model.ts',
        'src/features/forms/forms-preview-values.ts',
        'src/components/ui/badge.tsx',
      ],
      exclude: ['src/test/**', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 },
    },
  },
});
