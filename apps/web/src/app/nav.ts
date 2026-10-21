/**
 * Navigacija (sidebar) — struktura iz `docs/06-UX_UI_DIZAJN.md` §5.5.
 *
 * `permission` je permisija potrebna da se stavka **prikaže**. Backend ostaje
 * jedini autoritet (docs/05 §0): sakrivanje u UI je samo korisničko iskustvo.
 * `superAdminOnly` označava web-only sekcije (N-05).
 */
export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly group: NavGroup;
  readonly permission?: string;
  readonly superAdminOnly?: boolean;
  readonly phase: string;
}

export type NavGroup = 'Operativa' | 'Vozni park' | 'Konfiguracija' | 'Sistem';

export const NAV_GROUPS: readonly NavGroup[] = ['Operativa', 'Vozni park', 'Konfiguracija', 'Sistem'];

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/nadzorna-tabla', label: 'Nadzorna tabla', group: 'Operativa', phase: 'Faza 3' },
  { to: '/rokovi', label: 'Rokovi', group: 'Operativa', permission: 'reminder:view', phase: 'Faza 3' },
  { to: '/zadaci', label: 'Zadaci', group: 'Operativa', permission: 'task:view', phase: 'Faza 5' },
  {
    to: '/obavijesti',
    label: 'Obavijesti',
    group: 'Operativa',
    permission: 'notification:view',
    phase: 'Faza 5',
  },

  { to: '/vozila', label: 'Vozila', group: 'Vozni park', permission: 'vehicle:view', phase: 'Faza 3' },
  { to: '/vozaci', label: 'Vozači', group: 'Vozni park', permission: 'driver:view', phase: 'Faza 3' },
  {
    to: '/registracije',
    label: 'Registracije',
    group: 'Vozni park',
    permission: 'registration:view',
    phase: 'Faza 3',
  },
  {
    to: '/osiguranja',
    label: 'Osiguranja',
    group: 'Vozni park',
    permission: 'insurance:view',
    phase: 'Faza 3',
  },
  { to: '/gume', label: 'Gume', group: 'Vozni park', permission: 'tire:view', phase: 'Faza 4' },
  { to: '/izvjestaji', label: 'Izvještaji', group: 'Vozni park', permission: 'report:view', phase: 'Faza 7' },

  {
    to: '/forme',
    label: 'Forme',
    group: 'Konfiguracija',
    permission: 'form:view',
    phase: 'Faza 2',
    superAdminOnly: true,
  },
  {
    to: '/administracija/korisnici',
    label: 'Korisnici',
    group: 'Konfiguracija',
    permission: 'user:view',
    phase: 'Faza 1',
    superAdminOnly: true,
  },
  {
    to: '/administracija/prava',
    label: 'Matrica prava',
    group: 'Konfiguracija',
    // Pregled matrice traži `role:view`; dugme „Sačuvaj" traži
    // `role:manage_permissions` (server i dalje odlučuje — P14).
    permission: 'role:view',
    phase: 'Faza 1',
    superAdminOnly: true,
  },
  {
    to: '/audit-log',
    label: 'Audit log',
    group: 'Sistem',
    permission: 'audit:view',
    phase: 'Faza 1',
  },
  { to: '/profil', label: 'Profil', group: 'Sistem', permission: 'auth:login', phase: 'Faza 1' },
  {
    to: '/zdravlje',
    label: 'Zdravlje sistema',
    group: 'Sistem',
    permission: 'system:view_health',
    phase: 'Faza 0',
  },
  { to: '/dizajn-sistem', label: 'Dizajn sistem', group: 'Sistem', phase: 'Faza 0' },
];

/** Grupisane stavke (za prikaz u sidebaru). */
export function navByGroup(): ReadonlyArray<{ group: NavGroup; items: readonly NavItem[] }> {
  return NAV_GROUPS.map((group) => ({
    group,
    items: NAV_ITEMS.filter((item) => item.group === group),
  }));
}

/**
 * Filtrira stavke prema pravima korisnika.
 * `permissions` = flat lista iz `/auth/me` (Faza 1); `isSuperAdmin` iz istog
 * odgovora. Prazan spisak prava (Faza 0, bez prijave) prikazuje sve kako bi se
 * kostur mogao pregledati.
 */
export function visibleNavItems(
  permissions: readonly string[] | undefined,
  isSuperAdmin: boolean,
): readonly NavItem[] {
  // R-07: Super Admin vidi sve (uključujući web-only sekcije).
  if (isSuperAdmin) return NAV_ITEMS;
  if (!permissions || permissions.length === 0) return NAV_ITEMS;
  return NAV_ITEMS.filter((item) => {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (!item.permission) return true;
    return permissions.includes(item.permission);
  });
}
