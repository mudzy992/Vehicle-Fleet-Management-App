/**
 * Route guard-ovi (docs/06 §5.4).
 *
 * 🔴 Backend je autoritet (docs/05 §0): guard samo **ne prikazuje** ekran koji
 * korisnik ionako ne može podatkovno koristiti. Ako se prava promijene, server
 * vraća `401 PERMISSIONS_STALE` / `403 PERMISSION_DENIED` i klijent osvježi
 * profil (`SessionProvider.reload`).
 *
 * `RequirePermission` ima smisla i za P14: korisnik koji ručno otkuca URL
 * (npr. `/audit-log`) vidi ekran „nemate pravo" **i** nijedan podatak se ne
 * povlači — upit se ne pokreće.
 */
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Button, Card, EmptyState } from '../components/ui/index.js';
import { useSession } from '../features/auth/session.js';

function FullPageMessage({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 text-[var(--fg)]">
      <Card className="w-full max-w-md">
        <EmptyState title={title} description={description} />
      </Card>
    </main>
  );
}

/**
 * Čeka prvo učitavanje sesije, pa pušta dalje ili šalje na prijavu.
 *
 * Prihvata ili `children` (layout-omotač) ili radi kao ruta-omotač s
 * `<Outlet/>` — oba oblika se koriste u ruteru.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageMessage title="Učitavanje…" description="Provjeravam sesiju." />;
  }

  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/prijava?next=${encodeURIComponent(next)}`} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}

/** Ekran bez prava (ne otkriva postoji li podatak — P14). */
export function NoAccessPage({ permission }: { permission?: string }) {
  return (
    <Card>
      <EmptyState
        title="Nemate pristup"
        description={
          permission
            ? `Za ovaj ekran je potrebno pravo "${permission}". Obratite se administratoru ako smatrate da je greška.`
            : 'Ova akcija nije dozvoljena za vašu rolu.'
        }
      />
    </Card>
  );
}

/** Prikazuje djecu samo ako korisnik ima pravo; inače ekran bez prava. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { status, hasPermission } = useSession();

  if (status === 'loading') {
    return <FullPageMessage title="Učitavanje…" description="Provjeravam prava." />;
  }
  if (!hasPermission(permission)) return <NoAccessPage permission={permission} />;

  return <>{children}</>;
}

/** Za javne ekrane (`/prijava`): prijavljeni korisnik ne ostaje na formi. */
export function AnonymousOnly({ children }: { children: ReactNode }) {
  const { status } = useSession();

  if (status === 'loading') {
    return <FullPageMessage title="Učitavanje…" description="Provjeravam sesiju." />;
  }

  // LoginPage owns the post-login `next` redirect. Redirecting here as soon as
  // the login mutation sets session state would race it and lose that path.
  return <>{children}</>;
}

/** Mali `403` blok za akcije unutar ekrana (npr. dugme „Sačuvaj matricu"). */
export function ForbiddenAction({ permission }: { permission: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--fg-muted)]">
      Akcija traži pravo <code className="font-mono">{permission}</code>.
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="ml-2"
        onClick={() => window.location.reload()}
      >
        Osvježi
      </Button>
    </div>
  );
}
