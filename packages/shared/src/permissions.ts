/**
 * VFM — katalog permisija, default matrica prava i čista logika evaluacije.
 *
 * ⚠️ **Izvor istine: `docs/05-RBAC_PERMISIJE_SIGURNOST.md` §3 (katalog) i §4
 * (default matrica).** Ovaj fajl je jedinstven izvor za API, web i mobilnu
 * aplikaciju (seed tabele `Permission` i `RolePermission` se generiše odavde).
 *
 * Ključna pravila:
 * - **Prava su podatak u bazi, ne kod u aplikaciji** (§3.1 zadatka): ovdje
 *   definisani katalog i matrica su *seed*. Super Admin ih mijenja iz matrice
 *   prava u web UI-u (P-01, P-02).
 * - **R-07 (odluka vlasnika):** `SUPER_ADMIN` **vidi sve** — implicitno dobija
 *   svaku permisiju iz kataloga s opsegom `ALL`, bez obzira na zapise u bazi.
 *   To je jedina hardkodovana privilegija i namjerna je (P-03: zaštita od
 *   zaključavanja sistema).
 * - **N-05:** Super Admin je web-only → na mobilnom klijentu nema nijedno pravo,
 *   a API vraća `403 MOBILE_ACCESS_FORBIDDEN`. Provjera je server-side.
 */
import { PERMISSION_SCOPES, ROLE_CODES, USER_STATUSES } from './enums.js';
import type { ClientType, PermissionScope, RoleCode, UserStatus } from './enums.js';

/** Modul permisije (količnik `MODULE × ACTION × SCOPE`). */
export const PERMISSION_MODULES = [
  'auth',
  'users',
  'roles',
  'permissions',
  'drivers',
  'vehicles',
  'odometer',
  'registrations',
  'insurance',
  'services',
  'tires',
  'tasks',
  'task_types',
  'forms',
  'attachments',
  'notifications',
  'reminders',
  'reports',
  'audit',
  'settings',
  'system',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

/** Implicitna "sve" privilegija — samo za `SUPER_ADMIN`. */
export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN' satisfies RoleCode;

/** Nivo pristupa u default matrici (`—` = nema pravo → `null`). */
export const ACCESS_LEVELS = ['ALL', 'OWN'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export type Access = AccessLevel | null;

/** Permisija = `<module_prefix>:<action>` (npr. `vehicle:view`, `task:claim`). */
export type Permission = string;

/**
 * Katalog permisija po modulima (docs/05 §3).
 *
 * Napomena: naziv modula je množina (`vehicles`), a kod permisije koristi
 * jedninu (`vehicle:view`) — isto kao u `Permission.module` / `Permission.code`.
 */
export const PERMISSION_CATALOG: Readonly<Record<PermissionModule, readonly Permission[]>> = {
  auth: [
    'auth:login',
    'auth:logout',
    'auth:refresh',
    'auth:change_password',
    'auth:reset_password',
    'auth:manage_sessions',
  ],
  users: [
    'user:view',
    'user:create',
    'user:update',
    'user:archive',
    'user:delete',
    'user:assign_role',
    'user:reset_password',
    'user:view_pii',
    'user:force_logout',
  ],
  roles: ['role:view', 'role:create', 'role:update', 'role:archive', 'role:manage_permissions'],
  permissions: ['permission:view', 'permission:catalog_sync'],
  drivers: [
    'driver:view',
    'driver:create',
    'driver:update',
    'driver:archive',
    'driver:delete',
    'driver:view_pii',
    'driver:export',
  ],
  vehicles: [
    'vehicle:view',
    'vehicle:create',
    'vehicle:update',
    'vehicle:archive',
    'vehicle:delete',
    'vehicle:export',
    'vehicle:view_history',
  ],
  odometer: ['odometer:view', 'odometer:create', 'odometer:correct'],
  registrations: [
    'registration:view',
    'registration:create',
    'registration:update',
    'registration:archive',
    'registration:delete',
    'registration:export',
  ],
  insurance: [
    'insurance:view',
    'insurance:create',
    'insurance:update',
    'insurance:archive',
    'insurance:delete',
    'insurance:export',
  ],
  services: [
    'service:view',
    'service:create',
    'service:update',
    'service:archive',
    'service:delete',
    'service:export',
  ],
  tires: [
    'tire:view',
    'tire:create',
    'tire:update',
    'tire:archive',
    'tire:delete',
    'tire:mount',
    'tire:dismount',
    'tire:swap',
    'tire:export',
  ],
  tasks: [
    'task:view',
    'task:view_all',
    'task:create',
    'task:update',
    'task:assign',
    'task:claim',
    'task:complete',
    'task:complete_override',
    'task:cancel',
    'task:reopen',
    'task:release',
    'task:comment',
    'task:export',
  ],
  task_types: ['task_type:view', 'task_type:create', 'task_type:update', 'task_type:archive'],
  forms: [
    'form:view',
    'form:create',
    'form:update',
    'form:manage_schema',
    'form:publish_version',
    'form:retire_version',
    'form:migrate_records',
  ],
  attachments: [
    'attachment:view',
    'attachment:upload',
    'attachment:delete',
    'attachment:download_original',
  ],
  notifications: [
    'notification:view',
    'notification:mark_read',
    'notification:broadcast',
    'notification:manage_preferences',
  ],
  reminders: [
    'reminder:view',
    'reminder:manage_policies',
    'reminder:acknowledge',
    'reminder:snooze',
  ],
  reports: ['report:view', 'report:export', 'report:manage_definitions', 'report:view_costs'],
  audit: ['audit:view', 'audit:export', 'audit:view_security'],
  settings: ['settings:view', 'settings:update', 'settings:manage_lists'],
  system: ['system:view_health', 'system:view_metrics', 'system:run_maintenance', 'system:view_queue'],
} as const;

/** Flat lista svih permisija iz kataloga (sortirana, bez duplikata). */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSION_CATALOG)
  .flat()
  .slice()
  .sort();

/** Permisije koje se tretiraju kao osjetljive (`Permission.isSensitive = true`). */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  'user:view_pii',
  'driver:view_pii',
  'user:delete',
  'driver:delete',
  'vehicle:delete',
  'registration:delete',
  'insurance:delete',
  'service:delete',
  'tire:delete',
  'role:manage_permissions',
  'permission:catalog_sync',
  'user:assign_role',
  'user:reset_password',
  'user:force_logout',
  'task:complete_override',
  'attachment:download_original',
  'notification:broadcast',
  'audit:view_security',
  'settings:update',
  'system:run_maintenance',
] as const;

/** Modul iz koda permisije (`vehicle:view` → `vehicle`). */
export function permissionModule(permission: Permission): string {
  return permission.split(':')[0] ?? '';
}

/** Akcija iz koda permisije (`vehicle:view` → `view`). */
export function permissionAction(permission: Permission): string {
  return permission.split(':')[1] ?? '';
}

/** Da li je permisija u katalogu. */
export function isKnownPermission(permission: string): boolean {
  return ALL_PERMISSIONS.includes(permission);
}

/** Da li je permisija osjetljiva (PII, brisanje, override, audit). */
export function isSensitivePermission(permission: Permission): boolean {
  return SENSITIVE_PERMISSIONS.includes(permission);
}

/** Modul (`Permission.module`, množina) za kod permisije. */
export function catalogModuleOf(permission: Permission): PermissionModule | undefined {
  const action = permissionModule(permission);
  return PERMISSION_MODULES.find(
    (module) => module === action || module === `${action}s` || module.startsWith(action),
  );
}

// -----------------------------------------------------------------------------
//  Grantovi (zapis `RolePermission`)
// -----------------------------------------------------------------------------

export interface PermissionGrant {
  readonly permission: Permission;
  readonly scope: PermissionScope;
  /** Koristi se kad `scope = VEHICLE_IDS`. */
  readonly scopeVehicleIds?: readonly string[];
  /** Koristi se kad `scope = DRIVER_IDS`. */
  readonly scopeDriverIds?: readonly string[];
  /** Dodatna pravila (whitelist evaluator, docs/05 §1.1). */
  readonly conditions?: Readonly<Record<string, unknown>> | null;
}

export interface EffectivePermissionsInput {
  readonly roles: readonly RoleCode[];
  readonly grants: readonly PermissionGrant[];
  readonly status?: UserStatus;
  /** `WEB` | `MOBILE_ANDROID` | `MOBILE_IOS` | `SERVICE` (N-05). */
  readonly clientType?: ClientType;
}

export interface EffectivePermissionsResult {
  readonly isSuperAdmin: boolean;
  readonly permissions: ReadonlyMap<Permission, PermissionScope>;
  readonly list: readonly Permission[];
  /** Grantovi za scope evaluaciju (VEHICLE_IDS / DRIVER_IDS). */
  readonly grants: readonly PermissionGrant[];
}

/** Hijerarhija opsega: širi opseg pobjeđuje (docs/05 §1). */
const SCOPE_RANK: Readonly<Record<PermissionScope, number>> = {
  OWN: 1,
  DRIVER_IDS: 2,
  VEHICLE_IDS: 2,
  ALL: 3,
} as const;

/**
 * Izračunava efektivna prava korisnika.
 *
 * Pravila:
 * 1. Nalog koji nije `ACTIVE` nema nijedno pravo.
 * 2. Super Admin na mobilnom klijentu (`MOBILE_*`) nema nijedno pravo → API
 *    vraća `403 MOBILE_ACCESS_FORBIDDEN` (N-05).
 * 3. `SUPER_ADMIN` na webu dobija **sve** permisije s opsegom `ALL` (R-07).
 * 4. Ostale uloge: unija grantova, najširi opseg pobjeđuje.
 */
export function evaluateEffectivePermissions(
  input: EffectivePermissionsInput,
): EffectivePermissionsResult {
  const { roles, grants, status = 'ACTIVE', clientType = 'WEB' } = input;
  const permissions = new Map<Permission, PermissionScope>();
  const empty: EffectivePermissionsResult = {
    isSuperAdmin: false,
    permissions,
    list: [],
    grants: [],
  };

  if (status !== 'ACTIVE') return empty;

  const isSuperAdminRole = roles.includes(SUPER_ADMIN_ROLE);
  const isMobileClient = clientType === 'MOBILE_ANDROID' || clientType === 'MOBILE_IOS';

  if (isSuperAdminRole && isMobileClient) return empty;

  if (isSuperAdminRole) {
    for (const permission of ALL_PERMISSIONS) {
      permissions.set(permission, 'ALL');
    }
    return { isSuperAdmin: true, permissions, list: [...permissions.keys()], grants };
  }

  for (const grant of grants) {
    mergeGrant(permissions, grant.permission, grant.scope);
  }

  return { isSuperAdmin: false, permissions, list: [...permissions.keys()].sort(), grants };
}

function mergeGrant(
  target: Map<Permission, PermissionScope>,
  permission: Permission,
  scope: PermissionScope,
): void {
  const existing = target.get(permission);
  if (existing === undefined || SCOPE_RANK[scope] > SCOPE_RANK[existing]) {
    target.set(permission, scope);
  }
}

/** Provjera jedne permisije nad izračunatim pravima. */
export function hasPermission(
  result: EffectivePermissionsResult,
  permission: Permission,
  requiredScope: PermissionScope = 'OWN',
): boolean {
  if (result.isSuperAdmin) return true;
  const scope = result.permissions.get(permission);
  if (scope === undefined) return false;
  return SCOPE_RANK[scope] >= SCOPE_RANK[requiredScope];
}

/** Lista permisija koje nedostaju (za `PERMISSION_DENIED` s detaljima). */
export function missingPermissions(
  result: EffectivePermissionsResult,
  required: readonly Permission[],
): readonly Permission[] {
  return required.filter((permission) => !hasPermission(result, permission, 'OWN'));
}

// -----------------------------------------------------------------------------
//  Default matrica (docs/05 §4) — seed, Super Admin je može mijenjati
// -----------------------------------------------------------------------------

type MatrixEntry = readonly [Permission, Access, Access];

/**
 * Redovi matrice: `[permisija, ADMINISTRATOR, OBICNI_KORISNIK]`.
 *
 * `SUPER_ADMIN` nije u matrici jer implicitno ima sve s `ALL` (R-07).
 * `null` = nema pravo (`—` u dokumentu), `'ALL'` = ✓, `'OWN'` = ○.
 */
const MATRIX: readonly MatrixEntry[] = [
  // users / roles / permissions / settings / forms / audit / system → samo Super Admin
  ['user:view', null, null],
  ['user:create', null, null],
  ['user:update', null, null],
  ['user:archive', null, null],
  ['user:delete', null, null],
  ['user:assign_role', null, null],
  ['user:reset_password', null, null],
  ['user:view_pii', null, null],
  ['user:force_logout', null, null],
  ['role:view', null, null],
  ['role:create', null, null],
  ['role:update', null, null],
  ['role:archive', null, null],
  ['role:manage_permissions', null, null],
  ['permission:view', null, null],
  ['permission:catalog_sync', null, null],
  ['settings:view', null, null],
  ['settings:update', null, null],
  ['settings:manage_lists', null, null],
  ['form:create', null, null],
  ['form:update', null, null],
  ['form:manage_schema', null, null],
  ['form:publish_version', null, null],
  ['form:retire_version', null, null],
  ['form:migrate_records', null, null],
  ['audit:view', null, null],
  ['audit:export', null, null],
  ['audit:view_security', null, null],
  ['system:view_health', null, null],
  ['system:view_metrics', null, null],
  ['system:run_maintenance', null, null],
  ['system:view_queue', null, null],

  // auth — svaki prijavljeni korisnik
  ['auth:login', 'ALL', 'ALL'],
  ['auth:logout', 'ALL', 'ALL'],
  ['auth:refresh', 'ALL', 'ALL'],
  ['auth:change_password', 'ALL', 'ALL'],
  ['auth:reset_password', 'ALL', 'ALL'],
  ['auth:manage_sessions', 'ALL', 'ALL'],

  // vozila
  ['vehicle:view', 'ALL', 'ALL'],
  ['vehicle:create', 'ALL', null],
  ['vehicle:update', 'ALL', null],
  ['vehicle:archive', 'ALL', null],
  ['vehicle:delete', null, null],
  ['vehicle:export', 'ALL', null],
  ['vehicle:view_history', 'ALL', 'OWN'],

  // kilometraža
  ['odometer:view', 'ALL', 'ALL'],
  ['odometer:create', 'ALL', 'OWN'],
  ['odometer:correct', 'ALL', null],

  // vozači (PII samo Super Admin — R-07)
  ['driver:view', 'ALL', null],
  ['driver:create', 'ALL', null],
  ['driver:update', 'ALL', null],
  ['driver:archive', 'ALL', null],
  ['driver:delete', null, null],
  ['driver:view_pii', null, null],
  ['driver:export', 'ALL', null],

  // registracije i osiguranja
  ['registration:view', 'ALL', 'ALL'],
  ['registration:create', 'ALL', null],
  ['registration:update', 'ALL', null],
  ['registration:archive', 'ALL', null],
  ['registration:delete', null, null],
  ['registration:export', 'ALL', null],
  ['insurance:view', 'ALL', 'ALL'],
  ['insurance:create', 'ALL', null],
  ['insurance:update', 'ALL', null],
  ['insurance:archive', 'ALL', null],
  ['insurance:delete', null, null],
  ['insurance:export', 'ALL', null],

  // servisi
  ['service:view', 'ALL', 'ALL'],
  ['service:create', 'ALL', null],
  ['service:update', 'ALL', null],
  ['service:archive', 'ALL', null],
  ['service:delete', null, null],
  ['service:export', 'ALL', null],

  // gume
  ['tire:view', 'ALL', 'ALL'],
  ['tire:create', 'ALL', null],
  ['tire:update', 'ALL', null],
  ['tire:archive', 'ALL', null],
  ['tire:delete', null, null],
  ['tire:mount', 'ALL', null],
  ['tire:dismount', 'ALL', null],
  ['tire:swap', 'ALL', null],
  ['tire:export', 'ALL', null],

  // zadaci
  ['task:view', 'ALL', 'OWN'],
  ['task:view_all', 'ALL', null],
  ['task:create', 'ALL', null],
  ['task:update', 'ALL', 'OWN'],
  ['task:assign', 'ALL', null],
  ['task:claim', null, 'ALL'],
  ['task:complete', 'OWN', 'OWN'],
  ['task:complete_override', null, null],
  ['task:cancel', 'ALL', null],
  ['task:reopen', 'ALL', null],
  ['task:release', 'ALL', null],
  ['task:comment', 'ALL', 'ALL'],
  ['task:export', 'ALL', null],

  // vrste zadataka
  ['task_type:view', 'ALL', 'ALL'],
  ['task_type:create', 'ALL', null],
  ['task_type:update', 'ALL', null],
  ['task_type:archive', 'ALL', null],

  // forme (čitanje je svima; upravljanje samo Super Admin)
  ['form:view', 'ALL', 'ALL'],

  // prilozi
  ['attachment:view', 'ALL', 'OWN'],
  ['attachment:upload', 'ALL', 'ALL'],
  ['attachment:delete', 'ALL', 'OWN'],
  ['attachment:download_original', 'ALL', null],

  // obavijesti
  ['notification:view', 'ALL', 'ALL'],
  ['notification:mark_read', 'ALL', 'ALL'],
  ['notification:broadcast', null, null],
  ['notification:manage_preferences', 'ALL', 'ALL'],

  // podsjetnici
  ['reminder:view', 'ALL', 'OWN'],
  ['reminder:manage_policies', null, null],
  ['reminder:acknowledge', 'ALL', 'ALL'],
  ['reminder:snooze', 'ALL', 'ALL'],

  // izvještaji
  ['report:view', 'ALL', null],
  ['report:export', 'ALL', null],
  ['report:manage_definitions', null, null],
  ['report:view_costs', 'ALL', null],
] as const;

function buildMatrix(): Readonly<Record<Exclude<RoleCode, 'SUPER_ADMIN' | 'CUSTOM'>, Record<Permission, Access>>> {
  const administrator: Record<Permission, Access> = {};
  const obicni: Record<Permission, Access> = {};
  for (const [permission, adminAccess, userAccess] of MATRIX) {
    administrator[permission] = adminAccess;
    obicni[permission] = userAccess;
  }
  return { ADMINISTRATOR: administrator, OBICNI_KORISNIK: obicni };
}

/**
 * Default matrica prava (seed). Ključevi: `ADMINISTRATOR`, `OBICNI_KORISNIK`.
 * `SUPER_ADMIN` je izuzet (implicitno sve — R-07).
 */
export const DEFAULT_ROLE_MATRIX = buildMatrix();

/**
 * Seed grantovi za ulogu (samo permisije s pristupom).
 * Koristi se u `prisma/seed.ts` za punjenje tabele `RolePermission`.
 */
export function defaultGrantsForRole(
  role: RoleCode,
): readonly PermissionGrant[] {
  if (role === 'SUPER_ADMIN') {
    // Super Admin nema zapise u bazi za prava — implicitno sve (R-07).
    // Seed ipak upisuje eksplicitne grantove radi čitljivosti matrice u UI-u.
    return ALL_PERMISSIONS.map((permission) => ({ permission, scope: 'ALL' as PermissionScope }));
  }
  if (role === 'CUSTOM') return [];

  const matrix = DEFAULT_ROLE_MATRIX[role];
  if (!matrix) return [];

  return Object.entries(matrix)
    .filter(([, access]) => access !== null)
    .map(([permission, access]) => ({
      permission,
      scope: (access === 'ALL' ? 'ALL' : 'OWN') as PermissionScope,
    }));
}

/**
 * Legacy alias: spisak permisija za ulogu (bez opsega).
 * Koristi se u testovima i za brzi prikaz u UI-u.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<Exclude<RoleCode, 'SUPER_ADMIN' | 'CUSTOM'>, readonly Permission[]>
> = {
  ADMINISTRATOR: defaultGrantsForRole('ADMINISTRATOR').map((grant) => grant.permission),
  OBICNI_KORISNIK: defaultGrantsForRole('OBICNI_KORISNIK').map((grant) => grant.permission),
} as const;

/** Sve uloge koje se seeduju (3 uloge, P-01). */
export const SEEDED_ROLES = ROLE_CODES;

/** Dozvoljeni klijenti po ulogama (docs/05 §4, N-05). */
export const ROLE_ALLOWED_CLIENT_TYPES: Readonly<Record<RoleCode, readonly ClientType[]>> = {
  SUPER_ADMIN: ['WEB'],
  ADMINISTRATOR: ['WEB', 'MOBILE_ANDROID'],
  OBICNI_KORISNIK: ['WEB', 'MOBILE_ANDROID'],
  CUSTOM: ['WEB', 'MOBILE_ANDROID'],
} as const;

/** Statusi korisnika (re-export radi pogodnosti). */
export const USER_STATUS_VALUES = USER_STATUSES;

/** Opsezi (re-export radi pogodnosti). */
export const PERMISSION_SCOPE_VALUES = PERMISSION_SCOPES;

/** Ukupan broj permisija u katalogu (docs/05 §3 navodi "120+"). */
export const PERMISSION_COUNT = ALL_PERMISSIONS.length;
