/** Historija guma vozila; montaža se uvodi zasebno. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { statusLabel } from '@vfm/shared';
import type { TireInstallationListResponse } from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
function date(value: string | null) {
  return value ? new Date(`${value}T00:00:00Z`).toLocaleDateString('bs-BA', { timeZone: 'UTC' }) : '—';
}
function km(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('bs-BA')} km`;
}
export function VehicleTiresTab({ vehicleId }: { vehicleId: string }) {
  const [page, setPage] = useState(1);
  const [activeOnly, setActiveOnly] = useState(false);
  const query = useQuery({
    queryKey: ['tire-installations', vehicleId, page, activeOnly],
    queryFn: () =>
      api.get<TireInstallationListResponse>(
        `/tire-installations?vehicleId=${encodeURIComponent(vehicleId)}&page=${page}&pageSize=25&activeOnly=${activeOnly}`,
      ),
  });
  return (
    <div className="space-y-4">
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
      {query.isPending ? (
        <p>Učitavanje guma…</p>
      ) : query.error ? (
        <p role="alert">
          {query.error instanceof ApiError ? query.error.message : 'Učitavanje guma nije uspjelo.'}
        </p>
      ) : !query.data?.items.length ? (
        <EmptyState
          title={activeOnly ? 'Nema montiranih kompleta' : 'Nema evidencija guma'}
          description="Pregled je dostupan. Unos montaže i zamjene kompleta slijedi u narednoj cjelini."
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
                        {row.reason && <p className="text-xs text-[var(--fg-muted)]">{row.reason}</p>}
                      </TD>
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
