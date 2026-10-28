/**
 * AppShell — glavni raspored web aplikacije (docs/06 §5.2).
 *
 * Raspored: lijevi sidebar (grupisana navigacija) + gornja traka (naslov
 * ekrana, globalna pretraga, obavijesti, profil) + sadržaj.
 *
 * Stavke sidebar-a se filtriraju prema `/auth/me` →
 * `visibleNavItems(permissions, isSuperAdmin)`; server ostaje autoritet, pa
 * sakrivena stavka nije sigurnosna mjera (docs/05 §0).
 */
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { APP_NAME } from '@vfm/shared';
import { Button } from '../components/ui/index.js';
import { useSession } from '../features/auth/session.js';
import { navByGroup, visibleNavItems } from './nav.js';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const items = visibleNavItems(user?.permissions, user?.isSuperAdmin ?? false);

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* Sidebar */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        data-testid="sidebar"
      >
        <div className="flex h-14 items-center gap-2 border-b border-[var(--border)] px-4">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-xs font-bold text-[var(--primary-fg)]"
          >
            VP
          </span>
          <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Glavna navigacija">
          {navByGroup()
            .map((group) => ({
              ...group,
              items: group.items.filter((item) => items.includes(item)),
            }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.group} className="mb-4">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                  {group.group}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                          [
                            'flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                            isActive
                              ? 'bg-[var(--primary-soft)] font-medium text-[var(--primary)]'
                              : 'text-[var(--fg)] hover:bg-[var(--hover)]',
                          ].join(' ')
                        }
                      >
                        <span>{item.label}</span>
                        <span className="text-[10px] text-[var(--fg-muted)]">{item.phase}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </nav>

        <div className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-[var(--fg-muted)]">
          {user ? (
            <>
              <p className="truncate font-medium text-[var(--fg)]">
                {user.displayName ?? `${user.firstName} ${user.lastName}`}
              </p>
              <p className="truncate">{user.email}</p>
              <p className="mt-0.5 truncate">{user.roles.map((role) => role.name).join(', ')}</p>
            </>
          ) : (
            <p>Niste prijavljeni</p>
          )}
          <p className="mt-1">Vremenska zona: Europe/Sarajevo</p>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Zatvori navigaciju"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {/* Sadržaj */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4">
          <button
            type="button"
            aria-label="Otvori navigaciju"
            onClick={() => setSidebarOpen(true)}
            className="rounded-md border border-[var(--border)] p-1.5 text-[var(--fg-muted)] lg:hidden"
          >
            <span aria-hidden="true">☰</span>
          </button>

          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{pageTitle(location.pathname)}</h1>

          <span className="hidden rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)] sm:inline">
            bs · BAM · Europe/Sarajevo
          </span>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void (async () => {
                await logout();
                navigate('/prijava', { replace: true });
              })();
            }}
          >
            Odjava
          </Button>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Naslov ekrana iz putanje (dok se ne uvedu route loaderi). */
function pageTitle(pathname: string): string {
  const item = navByGroup()
    .flatMap((group) => group.items)
    .find((candidate) => pathname.startsWith(candidate.to));
  if (item) return item.label;
  if (pathname.startsWith('/dizajn-sistem')) return 'Dizajn sistem';
  if (pathname.startsWith('/audit-log')) return 'Audit log';
  if (pathname.startsWith('/zdravlje')) return 'Zdravlje sistema';
  if (pathname.startsWith('/vozila/')) return 'Detalji vozila';
  return APP_NAME;
}
