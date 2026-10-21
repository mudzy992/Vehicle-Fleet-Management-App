/** Historija i transakcijske akcije guma na profilu vozila. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { statusLabel } from '@vfm/shared';
import type { TireInstallationListResponse, TireInstallationView } from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { TireDismountForm } from './tire-dismount-form.js';
import { TireMountForm } from './tire-mount-form.js';

type Editor =
  | { kind: 'mount' }
  | { kind: 'dismount'; installation: TireInstallationView }
  | { kind: 'swap'; installation: TireInstallationView }
  | null;

function date(value: string | null) {
  return value ? new Date(`${value}T00:00:00Z`).toLocaleDateString('bs-BA', { timeZone: 'UTC' }) : '—';
}

function km(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('bs-BA')} km`;
}

export function VehicleTiresTab({
  vehicleId,
  vehicleOdometerKm,
  vehicleStatus,
  onChanged,
}: {
  vehicleId: string;
  vehicleOdometerKm: number;
  vehicleStatus: string;
  onChanged: () => Promise<void>;
}) {
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [activeOnly, setActiveOnly] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['tire-installations', vehicleId, page, activeOnly],
    queryFn: () =>
      api.get<TireInstallationListResponse>(
        `/tire-installations?vehicleId=${encodeURIComponent(vehicleId)}&page=${page}&pageSize=25&activeOnly=${activeOnly}`,
      ),
  });

  const archived = vehicleStatus === 'ARCHIVED';
  const canMount = hasPermission('tire:mount') && !archived;
  const canDismount = hasPermission('tire:dismount');
  const canSwap = hasPermission('tire:swap') && !archived;
  const showActions = canDismount || canSwap;

  const handleSaved = async () => {
    setEditor(null);
    setMessage('Sačuvano.');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tire-installations', vehicleId] }),
      queryClient.invalidateQueries({ queryKey: ['tire-sets'] }),
      onChanged(),
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(event) => {
              setActiveOnly(event.target.checked);
              setPage(1);
            }}
          />
          Samo trenutno montirani kompleti
        </label>
        {canMount && editor?.kind !== 'mount' && (
          <Button variant="primary" size="sm" onClick={() => setEditor({ kind: 'mount' })}>
            Montiraj komplet
          </Button>
        )}
      </div>

      {message && <p className="text-sm">{message}</p>}

      {editor && (
        <Card>
          <CardHeader
            title={
              editor.kind === 'mount'
                ? 'Montaža kompleta'
                : editor.kind === 'swap'
                  ? 'Zamjena kompleta'
                  : 'Demontaža kompleta'
            }
            description={
              editor.kind === 'swap'
                ? 'Demontaža, montaža, kilometraža i statusi mijenjaju se u jednoj transakciji.'
                : editor.kind === 'mount'
                  ? 'Server sprječava isti komplet ili istu poziciju na dva mjesta.'
                  : 'Završeni ciklus ostaje trajna historija vozila i kompleta.'
            }
          />
          <CardContent>
            {editor.kind === 'dismount' ? (
              <TireDismountForm
                key={`${editor.installation.id}:${editor.installation.version}`}
                installation={editor.installation}
                vehicleOdometerKm={vehicleOdometerKm}
                onSaved={handleSaved}
                onCancel={() => setEditor(null)}
              />
            ) : (
              <TireMountForm
                key={
                  editor.kind === 'swap'
                    ? `${editor.installation.id}:${editor.installation.version}`
                    : 'new-mount'
                }
                vehicleId={vehicleId}
                vehicleOdometerKm={vehicleOdometerKm}
                currentInstallation={editor.kind === 'swap' ? editor.installation : undefined}
                onSaved={handleSaved}
                onCancel={() => setEditor(null)}
              />
            )}
          </CardContent>
        </Card>
      )}

      {query.isPending ? (
        <p>Učitavanje guma…</p>
      ) : query.error ? (
        <p role="alert">
          {query.error instanceof ApiError ? query.error.message : 'Učitavanje guma nije uspjelo.'}
        </p>
      ) : !query.data?.items.length ? (
        <EmptyState
          title={activeOnly ? 'Nema montiranih kompleta' : 'Nema evidencija guma'}
          description={
            canMount
              ? 'Montirajte dostupni komplet dugmetom „Montiraj komplet“.'
              : 'Za ovo vozilo još nema evidentiranog ciklusa montaže.'
          }
        />
      ) : (
        <>
          <Card>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>Komplet</TH>
                    <TH>Status / pozicije</TH>
                    <TH>Montaža</TH>
                    <TH>Demontaža</TH>
                    <TH align="right">Korištenje</TH>
                    <TH>Skladište / razlog</TH>
                    {showActions && <TH>Akcije</TH>}
                  </TR>
                </THead>
                <TBody>
                  {query.data.items.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <p className="font-medium">{row.setCode}</p>
                        <p>{[row.brand, row.model, row.size].filter(Boolean).join(' ') || '—'}</p>
                        <p className="text-xs text-[var(--fg-muted)]">
                          {statusLabel(row.season, 'tireSeason')}
                        </p>
                      </TD>
                      <TD>
                        <Badge level={row.dismountedAt ? 'neutral' : 'success'}>
                          {row.dismountedAt ? 'Demontiran' : 'Montiran'}
                        </Badge>
                        <p className="mt-1 text-xs">
                          {row.positions
                            .map((position) => statusLabel(position, 'tirePosition'))
                            .join(', ') || '—'}
                        </p>
                      </TD>
                      <TD>
                        {date(row.mountedAt)}
                        <p className="text-xs text-[var(--fg-muted)]">{km(row.mountedOdometerKm)}</p>
                      </TD>
                      <TD>
                        {date(row.dismountedAt)}
                        <p className="text-xs text-[var(--fg-muted)]">{km(row.dismountedOdometerKm)}</p>
                      </TD>
                      <TD align="right" className="whitespace-nowrap tabular-nums">
                        {km(row.kmDriven)}
                        <p>{row.daysInUse === null ? '—' : `${row.daysInUse} dana`}</p>
                      </TD>
                      <TD>
                        <p>{row.storageLocationOnDismount ?? '—'}</p>
                        {row.reason && (
                          <p className="text-xs text-[var(--fg-muted)]">
                            {statusLabel(row.reason, 'tireDismountReason')}
                          </p>
                        )}
                      </TD>
                      {showActions && (
                        <TD>
                          {!row.dismountedAt && (
                            <div className="flex flex-wrap gap-2">
                              {canSwap && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setEditor({ kind: 'swap', installation: row })}
                                >
                                  Zamijeni
                                </Button>
                              )}
                              {canDismount && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditor({ kind: 'dismount', installation: row })}
                                >
                                  Demontiraj
                                </Button>
                              )}
                            </div>
                          )}
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Strana {page} / {query.data.totalPages} · {query.data.total} zapisa
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prethodna
              </Button>
              <Button size="sm" disabled={page >= query.data.totalPages} onClick={() => setPage(page + 1)}>
                Sljedeća
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
