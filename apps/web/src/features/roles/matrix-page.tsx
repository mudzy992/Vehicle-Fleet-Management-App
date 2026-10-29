/**
 * Matrica prava (W27, docs/06 §5.5; P2).
 *
 * Kako radi:
 * - `GET /roles/matrix` vraća katalog, role i trenutne grantove u jednom
 *   odgovoru — editor ne pravi N+1 upita po roli.
 * - Ćelija je opseg: `—` (nema prava), `ALL` (sve), `OWN` (samo svoje).
 *   `VEHICLE_IDS`/`DRIVER_IDS` traže izbor vozila/vozača (Faza 3) — do tada su
 *   onemogućeni da se ne pošalje neispravan grant.
 * - `SUPER_ADMIN` nije kolona za uređivanje: ima sve implicitno (R-07) i server
 *   odbija izmjenu njegovih prava.
 * - Čuva se samo ono što je stvarno promijenjeno; `PUT /roles/matrix` je puna
 *   zamjena grantova za poslane role, u jednoj transakciji.
 * - Poslije uspjeha keš prava je invalidiran na serveru → korisnici bez ponovne
 *   prijave dobijaju nova prava (P3). UI osvježava matricu i profil.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PermissionMatrixResponse,
  RoleMatrixUpdateInput,
  RoleMatrixUpdateResult,
} from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  inputClassName,
} from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { type MatrixScope, buildMatrixPayload, grantsToState } from './matrix.js';

export function MatrixPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useSession();
  const canEdit = hasPermission('role:manage_permissions');
  const [next, setNext] = useState<Map<string, Map<string, MatrixScope>> | null>(null);
  const [saved, setSaved] = useState<RoleMatrixUpdateResult | null>(null);

  const query = useQuery({
    queryKey: ['roles', 'matrix'],
    queryFn: () => api.get<PermissionMatrixResponse>('/roles/matrix'),
  });

  const current = useMemo(
    () => (query.data ? grantsToState(query.data.roles, query.data.grants) : new Map<string, Map<string, MatrixScope>>()),
    [query.data],
  );

  useEffect(() => {
    setNext(null);
  }, [query.data]);

  const editableRoles = useMemo(
    () => (query.data?.roles ?? []).filter((role) => role.code !== 'SUPER_ADMIN'),
    [query.data],
  );

  const dirty = useMemo(() => {
    if (!next) return false;
    return buildMatrixPayload(editableRoles, current, next).roles.length > 0;
  }, [next, current, editableRoles]);

  const save = useMutation({
    mutationFn: (payload: RoleMatrixUpdateInput) => api.put<RoleMatrixUpdateResult>('/roles/matrix', payload),
    onSuccess: (result) => {
      setSaved(result);
      // Poslije uspjeha server je već invalidirao keš; osvježi matricu i profil.
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });

  if (query.isPending)
    return (
      <p className="text-sm text-[var(--fg-muted)]" role="status">
        Učitavanje matrice…
      </p>
    );
  if (query.error) {
    const error = query.error instanceof ApiError ? query.error : null;
    return (
      <p className="text-sm text-[var(--danger)]" role="alert">
        Greška ({error?.code ?? 'INTERNAL_ERROR'}): {error?.message ?? 'matrica nije dostupna'}
      </p>
    );
  }
  if (!query.data) return <EmptyState title="Nema podataka" />;

  const matrix = next ?? current;

  const setCell = (roleId: string, permission: string, scope: MatrixScope): void => {
    setNext(() => {
      const copy = new Map<string, Map<string, MatrixScope>>();
      for (const [key, value] of matrix) copy.set(key, new Map(value));
      const roleState = copy.get(roleId) ?? new Map<string, MatrixScope>();
      if (scope) roleState.set(permission, scope);
      else roleState.delete(permission);
      copy.set(roleId, roleState);
      return copy;
    });
  };

  return (
    <div className="vfm-module-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Matrica prava ({query.data.modules.reduce((total, group) => total + group.permissions.length, 0)} permisija)</p>
          <p className="text-[11px] text-[var(--fg-muted)]">
            Promjena važi za postojeće sesije u ≤ 5 s bez ponovne prijave. Super Admin ima sva prava implicitno (R-07).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? <Badge level="warning">Nesačuvane izmjene</Badge> : null}
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty}
            onClick={() => {
              setNext(null);
              setSaved(null);
            }}
          >
            Poništi
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canEdit || !dirty || save.isPending}
            loading={save.isPending}
            onClick={() => save.mutate(buildMatrixPayload(editableRoles, current, matrix))}
            title={canEdit ? undefined : 'Traži pravo role:manage_permissions'}
          >
            Sačuvaj matricu
          </Button>
        </div>
      </div>

      {saved ? (
        <Card>
          <p className="text-sm font-medium" role="status">
            Sačuvano: {saved.affectedRoles} rola · +{saved.added} / −{saved.removed} / ~{saved.scopeChanged}
          </p>
          <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
            Nova verzija prava: {Object.values(saved.permissionsVersion).join(', ')}. Promjena je u Audit logu
            (<code>PERMISSION_CHANGE</code>).
          </p>
        </Card>
      ) : null}

      {save.error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {save.error instanceof ApiError ? `${save.error.message} (${save.error.code})` : 'Čuvanje nije uspjelo.'}
        </p>
      ) : null}

      <Card flush>
        <Table scrollLabel="Matrica prava — za pregled svih rola pomjerite tabelu horizontalno">
          <THead>
            <TR>
              <TH>Permisija</TH>
              {editableRoles.map((role) => (
                <TH key={role.id}>{role.name}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {query.data.modules.map((group) => (
              <Fragment key={group.module}>
                <TR className="bg-[var(--surface-muted)]">
                  <TD className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
                    {group.module}
                  </TD>
                  {editableRoles.map((role) => (
                    <TD key={`${group.module}-${role.id}`}> </TD>
                  ))}
                </TR>
                {group.permissions.map((permission) => (
                  <TR key={permission.code}>
                    <TD>
                      <span className="font-mono text-xs">{permission.code}</span>
                      {permission.isSensitive ? (
                        <span className="ml-2 text-[10px] uppercase text-[var(--fg-muted)]">osjetljivo</span>
                      ) : null}
                      {!permission.inDatabase ? (
                        <span className="ml-2 text-[10px] uppercase text-[var(--danger)]">nema u bazi</span>
                      ) : null}
                    </TD>
                    {editableRoles.map((role) => {
                      const scope = matrix.get(role.id)?.get(permission.code) ?? null;
                      return (
                        <TD key={`${permission.code}-${role.id}`}>
                          <select
                            aria-label={`${role.name} → ${permission.code}`}
                            className={`${inputClassName} h-7 w-24 text-xs`}
                            value={scope ?? ''}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const value = event.target.value;
                              setCell(role.id, permission.code, value === '' ? null : (value as 'ALL' | 'OWN'));
                            }}
                          >
                            <option value="">—</option>
                            <option value="ALL">ALL</option>
                            <option value="OWN">OWN</option>
                          </select>
                        </TD>
                      );
                    })}
                  </TR>
                ))}
              </Fragment>
            ))}
          </TBody>
        </Table>
      </Card>

      {!canEdit ? (
        <p className="text-xs text-[var(--fg-muted)]">
          Matricu možete pregledati, ali ne mijenjati — traži pravo <code>role:manage_permissions</code>.
        </p>
      ) : null}
    </div>
  );
}
