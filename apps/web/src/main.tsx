/**
 * Ulazna tačka web aplikacije.
 *
 * Provideri (redoslijed je bitan):
 *   QueryClientProvider → RouterProvider
 *
 * Greske pri bootu se prikazuju korisniku na bosanskom umjesto bijelog ekrana.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { router } from './app/router.js';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root nije pronađen u index.html');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
