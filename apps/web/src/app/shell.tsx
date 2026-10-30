/** Main responsive application frame: navigation, context bar and route content. */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { APP_NAME } from '@vfm/shared';
import { Button, buttonClassName } from '../components/ui/index.js';
import type { NotificationUnreadCount } from '@vfm/shared/schemas';
import { api } from '../lib/api.js';
import { useSession } from '../features/auth/session.js';
import { navByGroup, visibleNavItems } from './nav.js';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasPermission, status } = useSession();
  const canViewNotifications = hasPermission('notification:view');
  const unreadNotificationsQuery = useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: () => api.get<NotificationUnreadCount>('/notifications/unread-count'),
    enabled: status === 'authenticated' && canViewNotifications,
    refetchInterval: 30_000,
  });
  const unreadNotifications = unreadNotificationsQuery.data?.count ?? 0;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const wasSidebarOpen = useRef(false);
  const items = visibleNavItems(user?.permissions, user?.isSuperAdmin ?? false);
  const displayName = user?.displayName ?? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();

  async function handleLogout() {
    await logout();
    navigate('/prijava', { replace: true });
  }

  useEffect(() => {
    if (!sidebarOpen) {
      if (wasSidebarOpen.current) menuButtonRef.current?.focus();
      wasSidebarOpen.current = false;
      return;
    }

    wasSidebarOpen.current = true;
    const sidebar = sidebarRef.current;
    const focusable = () =>
      Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? []);
    focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="vfm-shell">
      <aside
        ref={sidebarRef}
        id="vfm-sidebar"
        className={`vfm-sidebar${sidebarOpen ? ' is-open' : ''}`}
        role={sidebarOpen ? 'dialog' : undefined}
        aria-label="Navigacija aplikacije"
        aria-modal={sidebarOpen || undefined}
        data-testid="sidebar"
      >
        <div className="vfm-brand">
          <span className="vfm-brand-mark" aria-hidden="true">
            V
          </span>
          <span className="vfm-brand-name">{APP_NAME}</span>
          <span className="vfm-brand-caption">FLEET OPERATIONS</span>
        </div>
        <nav className="vfm-nav" aria-label="Glavna navigacija">
          {navByGroup()
            .map((group) => ({ ...group, items: group.items.filter((item) => items.includes(item)) }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section className="vfm-nav-group" key={group.group}>
                <p className="vfm-nav-label">{group.group}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) => `vfm-nav-link${isActive ? ' is-active' : ''}`}
                      >
                        <span className="vfm-nav-indicator" aria-hidden="true" />
                        <span>{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </nav>
        <div className="vfm-sidebar-user">
          <span className="vfm-avatar" aria-hidden="true">
            {displayName.slice(0, 1).toUpperCase() || 'U'}
          </span>
          <div className="vfm-user-copy">
            <p className="vfm-user-name">{displayName || 'Korisnik'}</p>
            <p className="vfm-user-role">{user?.roles.map((role) => role.name).join(', ') || user?.email}</p>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Zatvori navigaciju"
          className="vfm-scrim"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="vfm-main">
        <header className="vfm-topbar">
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="Otvori navigaciju"
            aria-controls="vfm-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
            className="vfm-menu-button"
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div className="vfm-breadcrumb">
            <span className="vfm-breadcrumb-root">Vozni park</span>
            <span aria-hidden="true">/</span>
            <span className="vfm-breadcrumb-title">{pageTitle(location.pathname)}</span>
          </div>
          <div className="vfm-topbar-meta">
            <span className="vfm-status-dot" /> Sistem spreman
          </div>
          {canViewNotifications ? (
            <Link
              to="/obavijesti"
              className={buttonClassName('secondary', 'sm')}
              aria-label={`Obavijesti, ${unreadNotifications} nepročitanih`}
            >
              Obavijesti{unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}
            </Link>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => void handleLogout()}>
            Odjava
          </Button>
        </header>
        <main className="vfm-content">
          <Outlet />
        </main>
        <footer className="vfm-footer">
          <span>{APP_NAME}</span>
          <span>bs-BA · BAM · Europe/Sarajevo</span>
        </footer>
      </div>
    </div>
  );
}

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
