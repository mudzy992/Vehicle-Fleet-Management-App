/** Korištenje kompleta — sažetak i ciklusi montaže po vozilima. */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatDate, formatInteger, formatOdometer, statusLabel } from '@vfm/shared';
import type { TireSetUsage, TireSetView } from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Stat,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';

function daysLabel(days: number | null): string {
  if (days === null) return '—';
  const singular = days % 10 === 1 && days % 100 !== 11;
  return `${formatInteger(days)} ${singular ? 'dan' : 'dana'}`;
}

function dateLabel(value: string | null): string {
  return value ? formatDate(value) : '—';
}

export function TireSetUsagePanel({ tireSet, onClose }: { tireSet: TireSetView; onClose: () => void }) {
  const usageQuery = useQuery({
    queryKey: ['tire-set-usage', tireSet.id],
    queryFn: () => api.get<TireSetUsage>(`/tire-sets/${tireSet.id}/usage`),
    retry: false,
  });

  if (usageQuery.isPending) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--fg-muted)]">Učitavanje korištenja kompleta…</p>
        </CardContent>
      </Card>
    );
  }

  if (usageQuery.error || !usageQuery.data) {
    return (
      <Card>
        <CardHeader title={`Korištenje kompleta — ${tireSet.code}`} />
        <CardContent>
          <div className="space-y-3">
            <p role="alert" className="text-sm text-[var(--danger)]">
              {usageQuery.error instanceof ApiError
                ? usageQuery.error.message
                : 'Korištenje kompleta nije moguće učitati.'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void usageQuery.refetch()}>
                Pokušaj ponovo
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Zatvori
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const usage = usageQuery.data;
  const { summary } = usage;
  const setDescription = [
    [usage.set.brand, usage.set.model, usage.set.size].filter(Boolean).join(' '),
    statusLabel(usage.set.season, 'tireSeason'),
    statusLabel(usage.set.status, 'tireStatus'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card>
      <CardHeader
        title={`Korištenje kompleta — ${usage.set.code}`}
        description={setDescription}
        actions={
          <Button size="sm" variant="ghost" onClick={onClose}>
            Zatvori
          </Button>
        }
      />
      <CardContent>
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat
              label="Ciklusi montaže"
              value={formatInteger(summary.totalCycles)}
              hint={`Završeni: ${formatInteger(summary.completedCycles)} · aktivni: ${formatInteger(summary.activeCycles)}`}
            />
            <Stat
              label="Pređeno u završenim ciklusima"
              value={formatOdometer(summary.totalKmDriven)}
              hint="Snapshot vrijednosti zaključane demontažom"
            />
            <Stat
              label="Dana u upotrebi"
              value={daysLabel(summary.totalDaysInUse)}
              hint="Samo završeni ciklusi"
            />
            <Stat label="Različita vozila" value={formatInteger(summary.distinctVehicles)} />
            <Stat label="Prva montaža" value={dateLabel(summary.firstMountedAt)} />
            <Stat label="Posljednja montaža" value={dateLabel(summary.lastMountedAt)} />
          </div>

          {summary.activeCycles > 0 && (
            <p className="text-sm text-[var(--fg-muted)]">
              Aktivni ciklus još ne ulazi u ukupne kilometre i dane. Njegovi brojači se zaključavaju tek
              demontažom, prema stvarnom završnom datumu i kilometraži.
            </p>
          )}

          {usage.cycles.length === 0 ? (
            <EmptyState
              title="Komplet još nije korišten"
              description="Za ovaj komplet nema evidentiranih ciklusa montaže. Prvi ciklus nastaje montažom iz profila vozila."
            />
          ) : (
            <>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Po vozilima</h3>
                <Table>
                  <THead>
                    <TR>
                      <TH>Vozilo</TH>
                      <TH align="right">Ciklusi</TH>
                      <TH align="right">Pređeno</TH>
                      <TH align="right">U upotrebi</TH>
                      <TH>Montaže</TH>
                      <TH>Trenutno</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {usage.vehicles.map((vehicle) => (
                      <TR key={vehicle.vehicleId}>
                        <TD>
                          <Link className="font-medium hover:underline" to={`/vozila/${vehicle.vehicleId}`}>
                            {vehicle.vehicleInternalNo}
                          </Link>
                          <p className="text-xs text-[var(--fg-muted)]">
                            {vehicle.vehiclePlateNumber ?? 'Bez registarske oznake'}
                          </p>
                        </TD>
                        <TD align="right" className="tabular-nums">
                          <p>{formatInteger(vehicle.totalCycles)}</p>
                          <p className="text-xs text-[var(--fg-muted)]">
                            {formatInteger(vehicle.completedCycles)} završena ·{' '}
                            {formatInteger(vehicle.activeCycles)} aktivna
                          </p>
                        </TD>
                        <TD align="right" className="tabular-nums">
                          {formatOdometer(vehicle.totalKmDriven)}
                        </TD>
                        <TD align="right" className="tabular-nums">
                          {daysLabel(vehicle.totalDaysInUse)}
                        </TD>
                        <TD>
                          <p>{dateLabel(vehicle.firstMountedAt)}</p>
                          {vehicle.lastMountedAt !== vehicle.firstMountedAt && (
                            <p className="text-xs text-[var(--fg-muted)]">
                              do {dateLabel(vehicle.lastMountedAt)}
                            </p>
                          )}
                        </TD>
                        <TD>
                          {vehicle.activeSince ? (
                            <>
                              <Badge level="success">Montiran</Badge>
                              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                                od {dateLabel(vehicle.activeSince)}
                              </p>
                              <p className="text-xs">
                                {vehicle.activePositions
                                  .map((position) => statusLabel(position, 'tirePosition'))
                                  .join(', ') || 'Bez pozicija'}
                              </p>
                            </>
                          ) : (
                            '—'
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Ciklusi montaže</h3>
                <Table>
                  <THead>
                    <TR>
                      <TH>Vozilo / pozicije</TH>
                      <TH>Montaža</TH>
                      <TH>Demontaža</TH>
                      <TH align="right">Korištenje</TH>
                      <TH>Razlog / skladište</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {usage.cycles.map((cycle) => (
                      <TR key={cycle.id}>
                        <TD>
                          <Link className="font-medium hover:underline" to={`/vozila/${cycle.vehicleId}`}>
                            {cycle.vehicleInternalNo}
                          </Link>
                          <p className="text-xs text-[var(--fg-muted)]">
                            {cycle.vehiclePlateNumber ?? 'Bez registarske oznake'}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge level={cycle.isActive ? 'success' : 'neutral'}>
                              {cycle.isActive ? 'U toku' : 'Završen'}
                            </Badge>
                            <span className="text-xs">
                              {cycle.positions
                                .map((position) => statusLabel(position, 'tirePosition'))
                                .join(', ') || 'Bez pozicija'}
                            </span>
                          </div>
                        </TD>
                        <TD>
                          <p>{dateLabel(cycle.mountedAt)}</p>
                          <p className="text-xs text-[var(--fg-muted)]">
                            {formatOdometer(cycle.mountedOdometerKm)}
                          </p>
                        </TD>
                        <TD>
                          {cycle.isActive ? (
                            'U toku'
                          ) : (
                            <>
                              <p>{dateLabel(cycle.dismountedAt)}</p>
                              <p className="text-xs text-[var(--fg-muted)]">
                                {cycle.dismountedOdometerKm === null
                                  ? '—'
                                  : formatOdometer(cycle.dismountedOdometerKm)}
                              </p>
                            </>
                          )}
                        </TD>
                        <TD align="right" className="tabular-nums">
                          <p>{cycle.kmDriven === null ? '—' : formatOdometer(cycle.kmDriven)}</p>
                          <p className="text-xs text-[var(--fg-muted)]">{daysLabel(cycle.daysInUse)}</p>
                        </TD>
                        <TD>
                          <p>{cycle.reason ? statusLabel(cycle.reason, 'tireDismountReason') : '—'}</p>
                          <p className="text-xs text-[var(--fg-muted)]">
                            {cycle.storageLocationOnDismount ?? 'Bez skladišta'}
                          </p>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
