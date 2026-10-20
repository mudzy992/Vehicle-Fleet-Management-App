/**
 * Ruter (react-router v8).
 *
 * Struktura ekrana je iz `docs/06-UX_UI_DIZAJN.md` §5.5 (W01…W28). U Fazi 0
 * postoji **kostur navigacije** s placeholder stranicama + `/dizajn-sistem`
 * (pregled dizajn tokena i komponenti) i `/zdravlje` (API status).
 *
 * Od Faze 1: `loader`/`action` po ruti + guard za permisije (server je
 * autoritet — UI samo sakriva akcije radi iskustva).
 */
import { createBrowserRouter, Navigate } from 'react-router';
import { AnonymousOnly, RequireAuth, RequirePermission } from './guards.js';
import { AppShell } from './shell.js';
import { PlaceholderPage } from '../features/placeholder-page.js';
import { DesignSystemPage } from '../features/design-system/design-system-page.js';
import { HealthPage } from '../features/system/health-page.js';
import { LoginPage } from '../features/auth/login-page.js';
import { UsersPage } from '../features/users/users-page.js';
import { MatrixPage } from '../features/roles/matrix-page.js';
import { AuditLogPage } from '../features/audit/audit-log-page.js';
import { ProfilePage } from '../features/profile/profile-page.js';
import { NAV_ITEMS } from './nav.js';

export const router = createBrowserRouter([
  {
    path: '/prijava',
    element: (
      <AnonymousOnly>
        <LoginPage />
      </AnonymousOnly>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/nadzorna-tabla" replace /> },
      {
        path: 'nadzorna-tabla',
        element: (
          <PlaceholderPage
            title="Nadzorna tabla"
            code="W02"
            phase="Faza 3"
            description="Ključni brojevi, rokovi koji ističu i zadaci koji čekaju preuzimanje."
          />
        ),
      },
      {
        path: 'vozila',
        element: (
          <PlaceholderPage
            title="Vozila"
            code="W05"
            phase="Faza 3"
            description="Registar vozila s filterima, kilometražom i statusima."
          />
        ),
      },
      {
        path: 'vozila/:vehicleId',
        element: (
          <PlaceholderPage
            title="Detalji vozila"
            code="W06"
            phase="Faza 3"
            description="Historija registracija, osiguranja, servisa i guma za jedno vozilo."
          />
        ),
      },
      {
        path: 'zadaci',
        element: (
          <PlaceholderPage
            title="Zadaci"
            code="W09"
            phase="Faza 5"
            description="Kanban i lista zadataka s preuzimanjem (atomski claim)."
          />
        ),
      },
      {
        path: 'gume',
        element: (
          <PlaceholderPage
            title="Gume"
            code="W14"
            phase="Faza 4"
            description="Kompleti guma, ciklusi montaže i kilometraža po setu."
          />
        ),
      },
      {
        path: 'forme',
        element: (
          <PlaceholderPage
            title="Forme"
            code="W17"
            phase="Faza 2"
            description="Builder dinamičkih formi s verzijama (nacrt/objavljeno/povučeno)."
          />
        ),
      },
      {
        path: 'izvjestaji',
        element: (
          <PlaceholderPage
            title="Izvještaji"
            code="W22"
            phase="Faza 7"
            description="Izvještaji nad SQL view-ovima s izvozom u PDF i Excel."
          />
        ),
      },
      {
        path: 'obavijesti',
        element: (
          <PlaceholderPage
            title="Obavijesti"
            code="W25"
            phase="Faza 5"
            description="In-app obavijesti, prijenos uživo (SSE) i postavke kanala."
          />
        ),
      },
      {
        path: 'administracija/korisnici',
        element: (
          <RequirePermission permission="user:view">
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'administracija/prava',
        element: (
          <RequirePermission permission="role:view">
            <MatrixPage />
          </RequirePermission>
        ),
      },
      {
        path: 'audit-log',
        element: (
          <RequirePermission permission="audit:view">
            <AuditLogPage />
          </RequirePermission>
        ),
      },
      {
        path: 'profil',
        element: <ProfilePage />,
      },
      { path: 'dizajn-sistem', element: <DesignSystemPage /> },
      { path: 'zdravlje', element: <HealthPage /> },
      { path: '*', element: <PlaceholderPage title="Nepostojeća stranica" code="404" phase="—" /> },
    ],
  },
]);

/** Ruta → naslov (za breadcrumb i naslov dokumenta). */
export const ROUTE_TITLES: Readonly<Record<string, string>> = NAV_ITEMS.reduce(
  (accumulator, item) => ({ ...accumulator, [item.to]: item.label }),
  { '/dizajn-sistem': 'Dizajn sistem', '/zdravlje': 'Zdravlje sistema' },
);
