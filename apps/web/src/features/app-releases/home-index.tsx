import { Navigate } from 'react-router';
import { useSession } from '../auth/session.js';
import { PublicLandingPage } from './public-landing-page.js';

export function HomeIndex() {
  const { status } = useSession();
  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-fg" role="status">
        <p className="text-sm text-fg-muted">Učitavanje…</p>
      </main>
    );
  }
  if (status === 'authenticated') return <Navigate to="/nadzorna-tabla" replace />;
  return <PublicLandingPage />;
}
