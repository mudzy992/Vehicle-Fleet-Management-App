import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_MATRIX,
  DEFAULT_ROLE_PERMISSIONS,
  defaultGrantsForRole,
  evaluateEffectivePermissions,
  hasPermission,
  isKnownPermission,
  isSensitivePermission,
  missingPermissions,
  PERMISSION_CATALOG,
  PERMISSION_COUNT,
  permissionAction,
  permissionModule,
  ROLE_ALLOWED_CLIENT_TYPES,
  SENSITIVE_PERMISSIONS,
} from '../dist/index.js';
import type { Permission, PermissionGrant } from '../dist/index.js';

describe('katalog permisija (docs/05 §3)', () => {
  it('ima 100+ permisija bez duplikata', () => {
    expect(PERMISSION_COUNT).toBeGreaterThan(100);
    expect(PERMISSION_COUNT).toBe(ALL_PERMISSIONS.length);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('svaka permisija ima oblik modul:akcija', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission, permission).toMatch(/^[a-z_]+:[a-z_]+$/u);
      expect(permissionModule(permission)).toBeTruthy();
      expect(permissionAction(permission)).toBeTruthy();
      expect(isKnownPermission(permission)).toBe(true);
    }
  });

  it('sadrži ključne permisije iz zahtjeva zadatka', () => {
    for (const required of [
      'task:claim',
      'task:complete',
      'task:complete_override',
      'task:release',
      'task:reopen',
      'form:publish_version',
      'form:retire_version',
      'form:migrate_records',
      'driver:view_pii',
      'user:view_pii',
      'role:manage_permissions',
      'tire:swap',
      'odometer:correct',
      'report:export',
      'audit:view_security',
      'system:view_health',
    ]) {
      expect(ALL_PERMISSIONS, `nedostaje ${required}`).toContain(required);
    }
  });

  it('osjetljive permisije su označene (PII, brisanje, override)', () => {
    expect(isSensitivePermission('driver:view_pii')).toBe(true);
    expect(isSensitivePermission('task:complete_override')).toBe(true);
    expect(isSensitivePermission('vehicle:delete')).toBe(true);
    expect(isSensitivePermission('task:view')).toBe(false);
    for (const permission of SENSITIVE_PERMISSIONS) {
      expect(ALL_PERMISSIONS, `${permission} mora biti u katalogu`).toContain(permission);
    }
  });

  it('katalog pokriva sve module', () => {
    for (const [module, permissions] of Object.entries(PERMISSION_CATALOG)) {
      expect(permissions.length, `${module} nema permisija`).toBeGreaterThan(0);
      for (const permission of permissions) {
        expect(ALL_PERMISSIONS).toContain(permission);
      }
    }
  });
});

describe('default matrica (docs/05 §4)', () => {
  it('sve vrijednosti u matrici su poznate permisije', () => {
    for (const role of ['ADMINISTRATOR', 'OBICNI_KORISNIK'] as const) {
      for (const permission of Object.keys(DEFAULT_ROLE_MATRIX[role])) {
        expect(isKnownPermission(permission), `${role}: ${permission}`).toBe(true);
      }
    }
  });

  it('Administrator nema pristup upravljanju pravima, korisnicima i postavkama', () => {
    const admin = DEFAULT_ROLE_MATRIX.ADMINISTRATOR;
    for (const permission of [
      'role:manage_permissions',
      'user:create',
      'user:delete',
      'settings:update',
      'form:publish_version',
      'system:run_maintenance',
      'audit:view',
    ]) {
      expect(admin[permission], `${permission} treba biti null`).toBeNull();
    }
  });

  it('R-07: nijedna uloga osim Super Admina nema view_pii', () => {
    expect(DEFAULT_ROLE_MATRIX.ADMINISTRATOR['driver:view_pii']).toBeNull();
    expect(DEFAULT_ROLE_MATRIX.ADMINISTRATOR['user:view_pii']).toBeNull();
    expect(DEFAULT_ROLE_MATRIX.OBICNI_KORISNIK['driver:view_pii']).toBeNull();
    expect(DEFAULT_ROLE_MATRIX.OBICNI_KORISNIK['user:view_pii']).toBeNull();
  });

  it('Podsjetnici korisnika su OWN; administrator zadržava ALL scope', () => {
    const user = DEFAULT_ROLE_MATRIX.OBICNI_KORISNIK;
    const admin = DEFAULT_ROLE_MATRIX.ADMINISTRATOR;
    expect(user['reminder:view']).toBe('OWN');
    expect(user['reminder:acknowledge']).toBe('OWN');
    expect(user['reminder:snooze']).toBe('OWN');
    expect(admin['reminder:view']).toBe('ALL');
    expect(admin['reminder:acknowledge']).toBe('ALL');
    expect(admin['reminder:snooze']).toBe('ALL');
  });

  it('Obični korisnik može preuzeti i završiti svoj zadatak', () => {
    const user = DEFAULT_ROLE_MATRIX.OBICNI_KORISNIK;
    expect(user['task:claim']).toBe('ALL');
    expect(user['task:complete']).toBe('OWN');
    expect(user['task:view']).toBe('OWN');
    expect(user['task:create']).toBeNull();
    expect(user['task:complete_override']).toBeNull();
  });

  it('Administrator može sve sa zadacima osim override-a', () => {
    const admin = DEFAULT_ROLE_MATRIX.ADMINISTRATOR;
    expect(admin['task:view_all']).toBe('ALL');
    expect(admin['task:assign']).toBe('ALL');
    expect(admin['task:cancel']).toBe('ALL');
    expect(admin['task:reopen']).toBe('ALL');
    expect(admin['task:complete']).toBe('OWN');
    expect(admin['task:complete_override']).toBeNull();
  });

  it('task:complete_override je rezervisan za Super Admina', () => {
    expect(DEFAULT_ROLE_MATRIX.ADMINISTRATOR['task:complete_override']).toBeNull();
    expect(DEFAULT_ROLE_MATRIX.OBICNI_KORISNIK['task:complete_override']).toBeNull();
    const superAdmin = evaluateEffectivePermissions({ roles: ['SUPER_ADMIN'], grants: [] });
    expect(hasPermission(superAdmin, 'task:complete_override')).toBe(true);
  });

  it('legacy alias DEFAULT_ROLE_PERMISSIONS je usklađen s matricom', () => {
    for (const role of ['ADMINISTRATOR', 'OBICNI_KORISNIK'] as const) {
      const fromMatrix = Object.entries(DEFAULT_ROLE_MATRIX[role])
        .filter(([, access]) => access !== null)
        .map(([permission]) => permission)
        .sort();
      expect(DEFAULT_ROLE_PERMISSIONS[role].slice().sort()).toEqual(fromMatrix);
    }
  });

  it('defaultGrantsForRole generiše grantove s ispravnim opsegom', () => {
    const adminGrants = defaultGrantsForRole('ADMINISTRATOR');
    expect(adminGrants.length).toBeGreaterThan(50);
    for (const grant of adminGrants) {
      expect(['ALL', 'OWN', 'VEHICLE_IDS', 'DRIVER_IDS']).toContain(grant.scope);
    }
    const complete = adminGrants.find((grant) => grant.permission === 'task:complete');
    expect(complete?.scope).toBe('OWN');
    const viewAll = adminGrants.find((grant) => grant.permission === 'task:view_all');
    expect(viewAll?.scope).toBe('ALL');
  });

  it('CUSTOM uloga nema default grantova (Super Admin ih definiše)', () => {
    expect(defaultGrantsForRole('CUSTOM')).toEqual([]);
  });
});

describe('evaluateEffectivePermissions — SUPER_ADMIN vidi sve (R-07)', () => {
  it('dobija sve permisije s opsegom ALL bez ijednog granta u bazi', () => {
    const result = evaluateEffectivePermissions({ roles: ['SUPER_ADMIN'], grants: [] });
    expect(result.isSuperAdmin).toBe(true);
    expect(result.list).toHaveLength(ALL_PERMISSIONS.length);
    for (const permission of ALL_PERMISSIONS) {
      expect(result.permissions.get(permission)).toBe('ALL');
    }
  });

  it('ima pun PII pristup', () => {
    const result = evaluateEffectivePermissions({ roles: ['SUPER_ADMIN'], grants: [] });
    expect(hasPermission(result, 'driver:view_pii', 'ALL')).toBe(true);
    expect(hasPermission(result, 'user:view_pii', 'ALL')).toBe(true);
  });

  it('ima sve sistemske i audit permisije', () => {
    const result = evaluateEffectivePermissions({ roles: ['SUPER_ADMIN'], grants: [] });
    for (const permission of [
      'system:run_maintenance',
      'audit:view_security',
      'role:manage_permissions',
      'form:publish_version',
      'vehicle:delete',
    ]) {
      expect(hasPermission(result, permission), permission).toBe(true);
    }
  });
});

describe('evaluateEffectivePermissions — Super Admin je web-only (N-05)', () => {
  it.each(['MOBILE_ANDROID', 'MOBILE_IOS'] as const)(
    'na %s klijentu nema nijedno pravo',
    (clientType) => {
      const result = evaluateEffectivePermissions({
        roles: ['SUPER_ADMIN'],
        grants: [],
        clientType,
      });
      expect(result.isSuperAdmin).toBe(false);
      expect(result.list).toHaveLength(0);
    },
  );

  it('na WEB klijentu zadržava puna prava', () => {
    const result = evaluateEffectivePermissions({
      roles: ['SUPER_ADMIN'],
      grants: [],
      clientType: 'WEB',
    });
    expect(result.isSuperAdmin).toBe(true);
    expect(result.list.length).toBe(ALL_PERMISSIONS.length);
  });

  it('Administrator na mobilnom klijentu zadržava prava', () => {
    const grants: PermissionGrant[] = [{ permission: 'task:view' as Permission, scope: 'ALL' }];
    const result = evaluateEffectivePermissions({
      roles: ['ADMINISTRATOR'],
      grants,
      clientType: 'MOBILE_ANDROID',
    });
    expect(result.list).toEqual(['task:view']);
  });

  it('dozvoljeni klijenti po ulogama su usklađeni s matricom', () => {
    expect(ROLE_ALLOWED_CLIENT_TYPES.SUPER_ADMIN).toEqual(['WEB']);
    expect(ROLE_ALLOWED_CLIENT_TYPES.ADMINISTRATOR).toContain('MOBILE_ANDROID');
  });
});

describe('evaluateEffectivePermissions — status naloga', () => {
  it.each(['SUSPENDED', 'DEACTIVATED', 'PENDING_PASSWORD_CHANGE'] as const)(
    'status %s → bez ijednog prava',
    (status) => {
      const result = evaluateEffectivePermissions({
        roles: ['SUPER_ADMIN'],
        grants: [{ permission: 'vehicle:view' as Permission, scope: 'ALL' }],
        status,
      });
      expect(result.list).toHaveLength(0);
      expect(result.isSuperAdmin).toBe(false);
    },
  );

  it('ACTIVE → prava se računaju normalno', () => {
    const result = evaluateEffectivePermissions({
      roles: ['ADMINISTRATOR'],
      grants: [{ permission: 'vehicle:view' as Permission, scope: 'ALL' }],
      status: 'ACTIVE',
    });
    expect(result.permissions.get('vehicle:view' as Permission)).toBe('ALL');
  });
});

describe('evaluateEffectivePermissions — unija grantova i opsezi', () => {
  it('spaja grantove iz više uloga', () => {
    const result = evaluateEffectivePermissions({
      roles: ['ADMINISTRATOR', 'OBICNI_KORISNIK'],
      grants: [
        { permission: 'vehicle:view', scope: 'OWN' },
        { permission: 'task:claim', scope: 'ALL' },
        { permission: 'task:complete', scope: 'OWN' },
      ],
    });
    expect(result.isSuperAdmin).toBe(false);
    expect(result.list).toEqual(['task:claim', 'task:complete', 'vehicle:view']);
  });

  it('najširi opseg pobjeđuje (ALL > OWN)', () => {
    const result = evaluateEffectivePermissions({
      roles: ['ADMINISTRATOR'],
      grants: [
        { permission: 'vehicle:view', scope: 'ALL' },
        { permission: 'vehicle:view', scope: 'OWN' },
      ],
    });
    expect(result.permissions.get('vehicle:view')).toBe('ALL');
  });

  it('VEHICLE_IDS/DRIVER_IDS su uži od ALL', () => {
    const result = evaluateEffectivePermissions({
      roles: ['OBICNI_KORISNIK'],
      grants: [
        { permission: 'vehicle:view', scope: 'ALL' },
        { permission: 'vehicle:view', scope: 'VEHICLE_IDS', scopeVehicleIds: ['v1'] },
      ],
    });
    expect(result.permissions.get('vehicle:view')).toBe('ALL');
  });

  it('redoslijed grantova ne utiče na rezultat', () => {
    const grants: PermissionGrant[] = [
      { permission: 'vehicle:view', scope: 'OWN' },
      { permission: 'vehicle:view', scope: 'ALL' },
    ];
    const forward = evaluateEffectivePermissions({ roles: ['ADMINISTRATOR'], grants });
    const backward = evaluateEffectivePermissions({
      roles: ['ADMINISTRATOR'],
      grants: [...grants].reverse(),
    });
    expect(forward.permissions.get('vehicle:view')).toBe('ALL');
    expect(backward.permissions.get('vehicle:view')).toBe('ALL');
  });

  it('zahtijevani opseg se poštuje (OWN grant ne dozvoljava ALL)', () => {
    const result = evaluateEffectivePermissions({
      roles: ['OBICNI_KORISNIK'],
      grants: [{ permission: 'task:view', scope: 'OWN' }],
    });
    expect(hasPermission(result, 'task:view', 'OWN')).toBe(true);
    expect(hasPermission(result, 'task:view', 'ALL')).toBe(false);
    expect(hasPermission(result, 'task:create', 'OWN')).toBe(false);
  });

  it('grantovi se prosljeđuju u rezultat (za scope evaluator)', () => {
    const grants: PermissionGrant[] = [
      { permission: 'vehicle:view', scope: 'VEHICLE_IDS', scopeVehicleIds: ['v1', 'v2'] },
    ];
    const result = evaluateEffectivePermissions({ roles: ['OBICNI_KORISNIK'], grants });
    expect(result.grants).toHaveLength(1);
    expect(result.grants[0]?.scopeVehicleIds).toEqual(['v1', 'v2']);
  });

  it('missingPermissions vraća samo ono što nedostaje (za detalje 403)', () => {
    const result = evaluateEffectivePermissions({
      roles: ['OBICNI_KORISNIK'],
      grants: [{ permission: 'task:view', scope: 'OWN' }],
    });
    expect(missingPermissions(result, ['task:view', 'task:create', 'vehicle:delete'])).toEqual([
      'task:create',
      'vehicle:delete',
    ]);
    expect(missingPermissions(result, ['task:view'])).toEqual([]);
  });
});
