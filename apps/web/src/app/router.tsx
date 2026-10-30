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
import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import type { RouteObject } from 'react-router';
import { AnonymousOnly, RequireAuth, RequirePermission } from './guards.js';
import { AppShell } from './shell.js';
import { PlaceholderPage } from '../features/placeholder-page.js';
import { NAV_ITEMS } from './nav.js';

function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(load);
  return function LazyPage() {
    return (
      <Suspense
        fallback={
          <div className="p-6 text-sm text-fg-muted" role="status">
            Učitavanje stranice…
          </div>
        }
      >
        <Page />
      </Suspense>
    );
  };
}

const DesignSystemPage = lazyPage(() =>
  import('../features/design-system/design-system-page.js').then((module) => ({
    default: module.DesignSystemPage,
  })),
);

const HealthPage = lazyPage(() =>
  import('../features/system/health-page.js').then((module) => ({ default: module.HealthPage })),
);

const LoginPage = lazyPage(() =>
  import('../features/auth/login-page.js').then((module) => ({ default: module.LoginPage })),
);

const UsersPage = lazyPage(() =>
  import('../features/users/users-page.js').then((module) => ({ default: module.UsersPage })),
);

const MatrixPage = lazyPage(() =>
  import('../features/roles/matrix-page.js').then((module) => ({ default: module.MatrixPage })),
);

const AuditLogPage = lazyPage(() =>
  import('../features/audit/audit-log-page.js').then((module) => ({ default: module.AuditLogPage })),
);

const ProfilePage = lazyPage(() =>
  import('../features/profile/profile-page.js').then((module) => ({ default: module.ProfilePage })),
);

const FormsPage = lazyPage(() =>
  import('../features/forms/forms-page.js').then((module) => ({ default: module.FormsPage })),
);

const NotificationsPage = lazyPage(() =>
  import('../features/notifications/notifications-page.js').then((module) => ({
    default: module.NotificationsPage,
  })),
);

const VehiclesPage = lazyPage(() =>
  import('../features/vehicles/vehicles-page.js').then((module) => ({ default: module.VehiclesPage })),
);

const VehicleCreatePage = lazyPage(() =>
  import('../features/vehicles/vehicle-create-page.js').then((module) => ({
    default: module.VehicleCreatePage,
  })),
);

const VehicleEditPage = lazyPage(() =>
  import('../features/vehicles/vehicle-edit-page.js').then((module) => ({ default: module.VehicleEditPage })),
);

const DashboardPage = lazyPage(() =>
  import('../features/dashboard/dashboard-page.js').then((module) => ({ default: module.DashboardPage })),
);

const DriversPage = lazyPage(() =>
  import('../features/drivers/drivers-page.js').then((module) => ({ default: module.DriversPage })),
);

const RemindersPage = lazyPage(() =>
  import('../features/reminders/reminders-page.js').then((module) => ({ default: module.RemindersPage })),
);

const DriverCreatePage = lazyPage(() =>
  import('../features/drivers/driver-create-page.js').then((module) => ({
    default: module.DriverCreatePage,
  })),
);

const DriverDetailPage = lazyPage(() =>
  import('../features/drivers/driver-detail-page.js').then((module) => ({
    default: module.DriverDetailPage,
  })),
);

const VehicleDetailPage = lazyPage(() =>
  import('../features/vehicles/vehicle-detail-page.js').then((module) => ({
    default: module.VehicleDetailPage,
  })),
);

const TireSetsPage = lazyPage(() =>
  import('../features/tires/tire-sets-page.js').then((module) => ({ default: module.TireSetsPage })),
);

const TaskTypesPage = lazyPage(() =>
  import('../features/task-types/task-types-page.js').then((module) => ({ default: module.TaskTypesPage })),
);

const TasksPage = lazyPage(() =>
  import('../features/tasks/tasks-page.js').then((module) => ({ default: module.TasksPage })),
);

const ReportsPage = lazyPage(() =>
  import('../features/reports/reports-page.js').then((module) => ({ default: module.ReportsPage })),
);

const TaskDetailPage = lazyPage(() =>
  import('../features/tasks/task-detail-page.js').then((module) => ({ default: module.TaskDetailPage })),
);

const TaskCreatePage = lazyPage(() =>
  import('../features/tasks/task-create-page.js').then((module) => ({ default: module.TaskCreatePage })),
);

const RegistrationRecordsPage = lazyPage(() =>
  import('../features/records/records-list-page.js').then(({ RecordsListPage }) => ({
    default: () => <RecordsListPage kind="REGISTRATION" />,
  })),
);
const InsuranceRecordsPage = lazyPage(() =>
  import('../features/records/records-list-page.js').then(({ RecordsListPage }) => ({
    default: () => <RecordsListPage kind="INSURANCE" />,
  })),
);

export const appRoutes = [
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
            <RegistrationRecordsPage />
          </RequirePermission>
        ),
      },
      {
        // W10 — osiguranja: isti obrazac, druga vrsta zapisa.
        path: 'osiguranja',
        element: (
          <RequirePermission permission="insurance:view">
            <InsuranceRecordsPage />
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
        // W09 — lista i slobodni zadaci; claim ostaje atomska serverska odluka.
        path: 'zadaci',
        element: (
          <RequirePermission permission="task:view">
            <TasksPage />
          </RequirePermission>
        ),
      },
      {
        // W17 — čarobnjak za kreiranje zadatka preko postojećeg POST /tasks.
        path: 'zadaci/novi',
        element: (
          <RequirePermission permission="task:create">
            <TaskCreatePage />
          </RequirePermission>
        ),
      },
      {
        // W09 — detalj zadatka, historija i komentari.
        path: 'zadaci/:taskId',
        element: (
          <RequirePermission permission="task:view">
            <TaskDetailPage />
          </RequirePermission>
        ),
      },
      {
        // W18 — vrste zadataka: zadane postavke, objavljena TASK forma i
        // zahtjevi završetka; sami zadaci i claim dolaze u sljedećoj cjelini.
        path: 'vrste-zadataka',
        element: (
          <RequirePermission permission="task_type:view">
            <TaskTypesPage />
          </RequirePermission>
        ),
      },
      {
        // W12 — evidencija kompleta; montaža i zamjena dolaze kao transakcijske akcije.
        path: 'gume',
        element: (
          <RequirePermission permission="tire:view">
            <TireSetsPage />
          </RequirePermission>
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
          <RequirePermission permission="report:view">
            <ReportsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'obavijesti',
        element: (
          <RequirePermission permission="notification:view">
            <NotificationsPage />
          </RequirePermission>
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
        element: (
          <RequirePermission permission="auth:login">
            <ProfilePage />
          </RequirePermission>
        ),
      },
      { path: 'dizajn-sistem', element: <DesignSystemPage /> },
      {
        path: 'zdravlje',
        element: (
          <RequirePermission permission="system:view_health">
            <HealthPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <PlaceholderPage title="Nepostojeća stranica" code="404" phase="—" /> },
    ],
  },
] satisfies RouteObject[];

export const router = createBrowserRouter(appRoutes);

/** Ruta → naslov (za breadcrumb i naslov dokumenta). */
export const ROUTE_TITLES: Readonly<Record<string, string>> = NAV_ITEMS.reduce(
  (accumulator, item) => ({ ...accumulator, [item.to]: item.label }),
  { '/dizajn-sistem': 'Dizajn sistem', '/zdravlje': 'Zdravlje sistema' },
);
