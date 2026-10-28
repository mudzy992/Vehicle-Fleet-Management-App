import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite konfiguracija za VFM web (docs/06-UX_UI_DIZAJN.md, docs/08-DOCKER_COOLIFY.md).
 *
 * - Tailwind 4 kroz `@tailwindcss/vite` (bez `tailwind.config.js` — teme su u CSS-u).
 * - Dev proxy: browser **nikad** ne zove drugi origin; `/api` i `/health` se
 *   proksiraju na API. U produkciji to radi nginx
 *   (`apps/web/nginx/nginx.conf.template`, `WEB_API_INTERNAL_URL`).
 * - Build je determinističan (manualChunks) radi boljeg keširanja u browseru.
 */
export default defineConfig(({ mode }) => {
  const apiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: Number(process.env.PORT ?? 5173),
      strictPort: false,
      allowedHosts: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: Number(process.env.PORT ?? 4173),
      allowedHosts: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      target: 'es2022',
      reportCompressedSize: false,
      rollupOptions: {
        output: {
          // Rollup 5 (Vite 8) traži funkciju umjesto objektnog oblika.
          manualChunks(id: string): string | undefined {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/node_modules/zod/')) return 'zod';
            if (id.includes('@vfm/shared')) return 'shared';
            if (id.includes('@tanstack/react-query')) return 'query';
            if (id.includes('react-router')) return 'router';
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
              return 'react';
            }
            return undefined;
          },
        },
      },
    },
  };
});
