import { describe, expect, it } from 'vitest';
import type { RoleSummary } from '@vfm/shared/schemas';
import { buildMatrixPayload, grantsToState } from './matrix.js';
import type { RoleMatrixUpdateInput } from '@vfm/shared/schemas';

/**
 * Logika editora matrice (P2) izdvojena iz komponente.
 *
 * Zašto testirati baš ovo: greška ovdje ne ruši ekran, nego **tiho** pošalje
 * pogrešan `PUT /roles/matrix` — npr. pošalje sve role (ogroman audit diff),
 * izgubi opseg ili pokuša urediti Super Admina (server to odbija).
 */

const ROLE_ADMIN: RoleSummary = {
  id: '018f0000-0000-7000-8000-0000000000b1',
  code: 'ADMINISTRATOR',
  name: 'Administrator',
  description: null,
  isSystem: true,
  allowedClientTypes: ['WEB'],
  permissionsVersion: 3,
  priority: 20,
  activeUserCount: 1,
  grantedCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ROLE_DRIVER: RoleSummary = {
  ...ROLE_ADMIN,
  id: '018f0000-0000-7000-8000-0000000000b2',
  code: 'OBICNI_KORISNIK',
  name: 'Obični korisnik',
  priority: 30,
  permissionsVersion: 1,
  grantedCount: 1,
};

const ROLE_SUPER: RoleSummary = {
  ...ROLE_ADMIN,
  id: '018f0000-0000-7000-8000-0000000000b0',
  code: 'SUPER_ADMIN',
  name: 'Super Administrator',
  priority: 10,
  allowedClientTypes: ['WEB'],
};

const GRANTS = [
  { roleId: ROLE_ADMIN.id, permission: 'vehicle:view', scope: 'ALL' as const },
  { roleId: ROLE_ADMIN.id, permission: 'task:view', scope: 'OWN' as const },
  { roleId: ROLE_DRIVER.id, permission: 'vehicle:view', scope: 'VEHICLE_IDS' as const },
];

describe('grantsToState', () => {
  it('građi mapu rola → permisija → opseg, ID opsege prikazuje kao ALL', () => {
    const state = grantsToState([ROLE_ADMIN, ROLE_DRIVER, ROLE_SUPER], GRANTS);

    expect(state.get(ROLE_ADMIN.id)?.get('vehicle:view')).toBe('ALL');
    expect(state.get(ROLE_ADMIN.id)?.get('task:view')).toBe('OWN');
    expect(state.get(ROLE_DRIVER.id)?.get('vehicle:view')).toBe('ALL');
    expect(state.get(ROLE_SUPER.id)?.size).toBe(0);
  });
});

describe('buildMatrixPayload', () => {
  const roles = [ROLE_SUPER, ROLE_ADMIN, ROLE_DRIVER];
  const current = grantsToState(roles, GRANTS);

  it('bez izmjena vraća prazan payload (nema praznog audit zapisa)', () => {
    const payload = buildMatrixPayload(roles, current, grantsToState(roles, GRANTS));
    expect(payload.roles).toEqual([]);
  });

  it('šalje samo promijenjenu rolu i tačan opseg', () => {
    const next = grantsToState(roles, GRANTS);
    next.get(ROLE_ADMIN.id)?.set('vehicle:create', 'ALL');

    const payload = buildMatrixPayload(roles, current, next);

    expect(payload.roles).toHaveLength(1);
    expect(payload.roles[0]?.roleId).toBe(ROLE_ADMIN.id);
    expect(payload.roles[0]?.grants).toEqual([
      { permission: 'vehicle:view', scope: 'ALL' },
      { permission: 'task:view', scope: 'OWN' },
      { permission: 'vehicle:create', scope: 'ALL' },
    ]);
  });

  it('uklonjen opseg izostaje iz grantova (puna zamjena po roli)', () => {
    const next = grantsToState(roles, GRANTS);
    next.get(ROLE_DRIVER.id)?.delete('vehicle:view');
    next.get(ROLE_DRIVER.id)?.set('task:view', 'OWN');

    const payload: RoleMatrixUpdateInput = buildMatrixPayload(roles, current, next);

    expect(payload.roles).toHaveLength(1);
    expect(payload.roles[0]?.grants).toEqual([{ permission: 'task:view', scope: 'OWN' }]);
  });

  it('nikad ne šalje SUPER_ADMIN (R-07 — server bi odbio)', () => {
    const next = grantsToState(roles, GRANTS);
    next.get(ROLE_SUPER.id)?.set('vehicle:view', 'ALL');

    const payload = buildMatrixPayload(roles, current, next);

    expect(payload.roles.map((role) => role.roleId)).not.toContain(ROLE_SUPER.id);
    expect(payload.roles).toHaveLength(0);
  });

  it('promjena ALL → OWN je izmjena (scopeChanged)', () => {
    const next = grantsToState(roles, GRANTS);
    next.get(ROLE_ADMIN.id)?.set('vehicle:view', 'OWN');

    const payload = buildMatrixPayload(roles, current, next);

    expect(payload.roles[0]?.grants).toContainEqual({ permission: 'vehicle:view', scope: 'OWN' });
  });
});
