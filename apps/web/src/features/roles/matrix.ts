/**
 * Čista logika editora matrice prava (P2) — bez React-a, pa se lako testira.
 *
 * Zašto odvojeno: greška u diff-u payloada ne ruši ekran, nego **tiho** pošalje
 * pogrešan `PUT /roles/matrix` (npr. pošalje sve role → ogroman audit diff, ili
 * pokuša urediti Super Admina → server odbija cijelu transakciju).
 */
import type { RoleMatrixUpdateInput, RoleSummary } from '@vfm/shared/schemas';

type Scope = 'ALL' | 'OWN' | null;

/** Mapa `roleId → permission → scope` iz grantova servera. */
export function grantsToState(
  roles: readonly RoleSummary[],
  grants: readonly { roleId: string; permission: string; scope: 'ALL' | 'OWN' | 'VEHICLE_IDS' | 'DRIVER_IDS' }[],
): Map<string, Map<string, Scope>> {
  const state = new Map<string, Map<string, Scope>>();
  for (const role of roles) state.set(role.id, new Map());

  for (const grant of grants) {
    const roleState = state.get(grant.roleId);
    if (!roleState) continue;
    // Opsezi s ID listama se u Fazi 1 prikazuju kao `ALL` (nema editora liste).
    roleState.set(grant.permission, grant.scope === 'OWN' ? 'OWN' : 'ALL');
  }
  return state;
}

/** Samo promijenjene role idu u payload (manji audit diff, brža transakcija). */
export function buildMatrixPayload(
  roles: readonly RoleSummary[],
  current: Map<string, Map<string, Scope>>,
  next: Map<string, Map<string, Scope>>,
): RoleMatrixUpdateInput {
  const changed = roles
    .filter((role) => role.code !== 'SUPER_ADMIN')
    .filter((role) => {
      const before = current.get(role.id) ?? new Map<string, Scope>();
      const after = next.get(role.id) ?? new Map<string, Scope>();
      const keys = new Set([...before.keys(), ...after.keys()]);
      for (const key of keys) {
        if ((before.get(key) ?? null) !== (after.get(key) ?? null)) return true;
      }
      return false;
    })
    .map((role) => {
      const state = next.get(role.id) ?? new Map<string, Scope>();
      const grants: RoleMatrixUpdateInput['roles'][number]['grants'] = [];
      for (const [permission, scope] of state) {
        if (!scope) continue;
        grants.push({ permission, scope });
      }
      return { roleId: role.id, grants };
    });

  return { roles: changed };
}


/** Opseg koji editor poznaje u Fazi 1. */
export type MatrixScope = Scope;
