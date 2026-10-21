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
import { FormsPage } from '../features/forms/forms-page.js';
import { VehiclesPage } from '../features/vehicles/vehicles-page.js';
import { VehicleCreatePage } from '../features/vehicles/vehicle-create-page.js';
import { VehicleEditPage } from '../features/vehicles/vehicle-edit-page.js';
import { DashboardPage } from '../features/dashboard/dashboard-page.js';
import { DriversPage } from '../features/drivers/drivers-page.js';
import { RemindersPage } from '../features/reminders/reminders-page.js';
import { RecordsListPage } from '../features/records/records-list-page.js';
import { DriverCreatePage } from '../features/drivers/driver-create-page.js';
import { DriverDetailPage } from '../features/drivers/driver-detail-page.js';
import { VehicleDetailPage } from '../features/vehicles/vehicle-detail-page.js';
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
        // Nadzorna tabla — brojevi se uzimaju kao `total` sa servera, rokovi iz
        // zapisa unutar 30 dana (docs/06 §9.1, ekran „Nadzorna ploča").
        path: 'nadzorna-tabla',
        element: <DashboardPage />,
      },
      {
        // W05 — registar vozila (Faza 3). Filteri idu na server; „rokovi"
        // widget računa se iz iste liste (docs/06 §7.6).
        path: 'vozila',
        element: (
          <RequirePermission permission="vehicle:view">
            <VehiclesPage />
          </RequirePermission>
        ),
      },
      {
        // W07 — novo vozilo: strukturirane kolone + dinamička `VEHICLE` forma.
        path: 'vozila/novo',
        element: (
          <RequirePermission permission="vehicle:create">
            <VehicleCreatePage />
          </RequirePermission>
        ),
      },
      {
        // W06 — izmjena vozila: ista polja kao unos, ali forma ostaje verzija
        // kojom je zapis nastao (P10) i `version` čuva od paralelnog upisa.
        path: 'vozila/:vehicleId/izmjena',
        element: (
          <RequirePermission permission="vehicle:update">
            <VehicleEditPage />
          </RequirePermission>
        ),
      },
      {
        // W06 — detalji vozila s tabovima; tabovi Faze 4/5 su označeni, ne prazni.
        path: 'vozila/:vehicleId',
        element: (
          <RequirePermission permission="vehicle:view">
            <VehicleDetailPage />
          </RequirePermission>
        ),
      },
      {
        // W09 — registracije: svi zapisi s rokovima (do sada samo po vozilu).
        path: 'registracije',
        element: (
          <RequirePermission permission="registration:view">
            <RecordsListPage kind="REGISTRATION" />
          </RequirePermission>
        ),
      },
      {
        // W10 — osiguranja: isti obrazac, druga vrsta zapisa.
        path: 'osiguranja',
        element: (
          <RequirePermission permission="insurance:view">
            <RecordsListPage kind="INSURANCE" />
          </RequirePermission>
        ),
      },
      {
        // W14 — rokovi: skener upisuje podsjetnike, ekran samo potvrđuje/odgađa.
        path: 'rokovi',
        element: (
          <RequirePermission permission="reminder:view">
            <RemindersPage />
          </RequirePermission>
        ),
      },
      {
        // W10 — registar vozača. PII se ne prikazuje u listi; rok dozvole jest
        // javni dio zapisa (docs/05 §8.2).
        path: 'vozaci',
        element: (
          <RequirePermission permission="driver:view">
            <DriversPage />
          </RequirePermission>
        ),
      },
      {
        // W12 — novi vozač: strukturirane kolone + dinamička `DRIVER` forma.
        path: 'vozaci/novi',
        element: (
          <RequirePermission permission="driver:create">
            <DriverCreatePage />
          </RequirePermission>
        ),
      },
      {
        // W11 — profil vozača; PII sekcija zavisi od `driver:view_pii`.
        path: 'vozaci/:driverId',
        element: (
          <RequirePermission permission="driver:view">
            <DriverDetailPage />
          </RequirePermission>
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
        // W17 — Builder formi (docs/06 §5.5): samo `form:view`; akcije unutar
        // ekrana traže `form:update`/`form:publish_version`/… (server provjerava).
        path: 'forme',
        element: (
          <RequirePermission permission="form:view">
            <FormsPage />
          </RequirePermission>
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
