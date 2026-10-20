/**
 * Vozila — lista (W05, docs/06 §5.5; docs/07 §2.5).
 *
 * - Filteri idu **na server** (`q`, `status`, `includeArchived`), pa su `total` i
 *   paginacija tačni i za veliki registar.
 * - „Rokovi" widget je izračunat iz **iste** liste (bez dodatnog zahtjeva) i
 *   boji redove po pragovima iz `vehicles-model.ts` (zeleno/žuto/narandžasto/crveno).
 * - Arhiviranje je serverska operacija po vozilu; selekcija šalje N zahtjeva i
 *   prijavljuje koliko je prošlo — djelimičan uspjeh je vidljiv, ne skriven.
 * - Dugmad se prikazuju po permisijama, ali server ostaje autoritet (P14).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { statusLabel } from '@vfm/shared';
import type { VehicleListResponse, VehicleSummary } from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Field,
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
import {
  DEFAULT_VEHICLE_FILTERS,
  buildVehicleQuery,
  collectDeadlines,
  deadlineLabel,
  deadlineTone,
  isFilteredEmpty,
  toQueryString,
  type DeadlineTone,
  type VehicleFilters,
} from './vehicles-model.js';

const PAGE_SIZE = 25;

const TONE_LEVEL: Readonly<Record<DeadlineTone, 'success' | 'warning' | 'danger' | 'neutral'>> = {
  ok: 'success',
  warn: 'warning',
  soon: 'warning',
  overdue: 'danger',
  none: 'neutral',
};

const STATUS_OPTIONS = ['ACTIVE', 'IN_SERVICE', 'INACTIVE', 'DAMAGED', 'ARCHIVED'] as const;

export function VehiclesPage() {
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<VehicleFilters>(DEFAULT_VEHICLE_FILTERS);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const listQuery = useMemo(
    () => ({
      ...buildVehicleQuery(filters, page, PAGE_SIZE),
      ...(includeArchived ? { includeArchived: true } : {}),
    }),
    [filters, includeArchived, page],
  );

  const { data, isPending, error } = useQuery({
    queryKey: ['vehicles', listQuery],
    queryFn: () => api.get<VehicleListResponse>(`/vehicles?${toQueryString(listQuery)}`),
  });

  const archive = useMutation({
    mutationFn: (ids: readonly string[]) =>
      Promise.allSettled(
        ids.map((id) => api.post<null>(`/vehicles/${id}/archive`, { reason: 'Arhivirano iz liste' })),
      ),
    onSuccess: async (results) => {
      const ok = results.filter((result) => result.status === 'fulfilled').length;
      setMessage(`Arhivirano ${ok}/${results.length} vozila.`);
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const vehicles = data?.items ?? [];
  const deadlines = collectDeadlines(vehicles);
  const total = data?.total ?? 0;
  const canArchive = hasPermission('vehicle:archive');

  const update = (patch: Partial<VehicleFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Vozila</h1>
          <p className="text-sm text-[var(--fg-muted)]">
            {isPending ? 'Učitavanje…' : `${total} vozila u registru`}
          </p>
        </div>
        {canArchive && selected.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            loading={archive.isPending}
            onClick={() => archive.mutate(selected)}
          >
            Arhiviraj odabrano ({selected.length})
          </Button>
        )}
      </div>

      {message && (
        <Card>
          <CardContent>
            <p className="text-sm">{message}</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--danger)]">
              {error instanceof ApiError ? error.message : 'Greška pri učitavanju vozila.'}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Filteri" description="Server filtrira — lista ostaje tačna i paginirana." />
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Pretraga" htmlFor="vozila-q">
                <input
                  id="vozila-q"
                  className={inputClassName}
                  placeholder="Interni broj, marka, model, tablice"
                  value={filters.q}
                  onChange={(event) => update({ q: event.target.value })}
                />
              </Field>
              <Field label="Status" htmlFor="vozila-status">
                <select
                  id="vozila-status"
                  className={inputClassName}
                  value={filters.status}
                  onChange={(event) => update({ status: event.target.value })}
                >
                  <option value="">Svi</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status, 'vehicle')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sortiranje" htmlFor="vozila-sort">
                <select
                  id="vozila-sort"
                  className={inputClassName}
                  value={filters.sortBy}
                  onChange={(event) => update({ sortBy: event.target.value })}
                >
                  <option value="internalNo">Interni broj</option>
                  <option value="odometerKm">Kilometraža</option>
                  <option value="registrationExpiresAt">Registracija ističe</option>
                  <option value="insuranceExpiresAt">Osiguranje ističe</option>
                  <option value="updatedAt">Zadnja izmjena</option>
                </select>
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.sortOrder === 'desc'}
                  onChange={(event) => update({ sortOrder: event.target.checked ? 'desc' : 'asc' })}
                />
                Obrnut redoslijed
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(event) => {
                    setIncludeArchived(event.target.checked);
                    setPage(1);
                  }}
                />
                Prikaži arhivirana
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Rokovi" description="Registracije i osiguranja koja ističu u 30 dana." />
          <CardContent>
            {deadlines.length === 0 ? (
              <p className="text-sm text-[var(--fg-muted)]">Nema rokova u narednih 30 dana.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {deadlines.map((entry) => (
                  <li
                    key={`${entry.vehicleId}-${entry.label}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <Link className="hover:underline" to={`/vozila/${entry.vehicleId}`}>
                      {entry.internalNo} · {entry.label}
                    </Link>
                    <Badge level={TONE_LEVEL[entry.tone]} title={entry.date}>
                      {deadlineLabel(entry.date)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          {isPending ? (
            <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>
          ) : vehicles.length === 0 ? (
            <EmptyState
              title={isFilteredEmpty(total, filters) ? 'Nema rezultata za filtere' : 'Registar je prazan'}
              description={
                isFilteredEmpty(total, filters)
                  ? 'Promijenite pretragu ili status — arhivirana vozila su sakrivena dok se ne uključe.'
                  : 'Vozila se dodaju kroz formu „Vozilo" (Konfiguracija → Forme).'
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  {canArchive && <TH> </TH>}
                  <TH>Interni broj</TH>
                  <TH>Vozilo</TH>
                  <TH>Tablice</TH>
                  <TH>Status</TH>
                  <TH align="right">Km</TH>
                  <TH>Registracija</TH>
                  <TH>Osiguranje</TH>
                </TR>
              </THead>
              <TBody>
                {vehicles.map((vehicle) => (
                  <TR key={vehicle.id}>
                    {canArchive && (
                      <TD>
                        <input
                          type="checkbox"
                          aria-label={`Odaberi ${vehicle.internalNo}`}
                          checked={selected.includes(vehicle.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, vehicle.id]
                                : current.filter((id) => id !== vehicle.id),
                            )
                          }
                        />
                      </TD>
                    )}
                    <TD>
                      <Link className="font-medium hover:underline" to={`/vozila/${vehicle.id}`}>
                        {vehicle.internalNo}
                      </Link>
                    </TD>
                    <TD>
                      {vehicle.make} {vehicle.model}
                      {vehicle.year ? ` (${vehicle.year})` : ''}
                    </TD>
                    <TD>{vehicle.plateNumber ?? '—'}</TD>
                    <TD>
                      <Badge level="neutral">{statusLabel(vehicle.status, 'vehicle')}</Badge>
                    </TD>
                    <TD align="right">{vehicle.odometerKm.toLocaleString('bs-BA')}</TD>
                    <TD>
                      <DeadlineCell
                        date={vehicle.registrationExpiresAt}
                        tone={deadlineTone(vehicle.registrationExpiresAt)}
                      />
                    </TD>
                    <TD>
                      <DeadlineCell
                        date={vehicle.insuranceExpiresAt}
                        tone={deadlineTone(vehicle.insuranceExpiresAt)}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--fg-muted)]">
            Strana {data?.page ?? 1} / {data?.totalPages ?? 1}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Prethodna
            </Button>
            <Button
              size="sm"
              disabled={page >= (data?.totalPages ?? 1)}
              onClick={() => setPage((current) => current + 1)}
            >
              Sljedeća
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeadlineCell({ date, tone }: { date: string | null; tone: DeadlineTone }) {
  if (!date) return <span className="text-[var(--fg-muted)]">—</span>;
  return (
    <Badge level={TONE_LEVEL[tone]} title={date}>
      {deadlineLabel(date)}
    </Badge>
  );
}

export type { VehicleSummary };
