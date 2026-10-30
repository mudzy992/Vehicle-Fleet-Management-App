/**
 * Vozači — lista (W07, docs/06 §9.1; docs/07 §2.4).
 *
 * - Filteri idu na server (`q`, `status`, `licenseCategory`, `includeArchived`).
 * - PII se **ne** prikazuje u listi; rok dozvole jest javni dio zapisa
 *   (`licenseExpiresAt`, docs/05 §8.2) i boji se kao svaki rok.
 * - Bez `driver:view_pii` server maskira PII i to nigdje ne „izgleda kao greška"
 *   — detalj to eksplicitno kaže.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { statusLabel } from '@vfm/shared';
import type { DriverListResponse, DriverSummary } from '@vfm/shared/schemas';
import { toLocalDateString } from '@vfm/shared';
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
  buttonClassName,
  inputClassName,
} from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { deadlineLabel, deadlineLevel, deadlineTone } from '../../lib/deadlines.js';
import { useSession } from '../auth/session.js';
import {
  DEFAULT_DRIVER_FILTERS,
  buildDriverQuery,
  collectLicenseDeadlines,
  isDriverFilteredEmpty,
  type DriverFilters,
} from './drivers-model.js';
import { toQueryString } from '../vehicles/vehicles-model.js';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

export function DriversPage() {
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<DriverFilters>(DEFAULT_DRIVER_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const listQuery = useMemo(() => buildDriverQuery(filters, page, PAGE_SIZE), [filters, page]);

  const { data, isPending, error } = useQuery({
    queryKey: ['drivers', listQuery],
    queryFn: () => api.get<DriverListResponse>(`/drivers?${toQueryString(listQuery)}`),
  });

  const archive = useMutation({
    mutationFn: (ids: readonly string[]) =>
      Promise.allSettled(
        ids.map((id) => api.post<null>(`/drivers/${id}/archive`, { reason: 'Arhivirano iz liste' })),
      ),
    onSuccess: async (results) => {
      const ok = results.filter((result) => result.status === 'fulfilled').length;
      setMessage(`Arhivirano ${ok}/${results.length} vozača.`);
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: ['drivers'] });
    },
  });

  const drivers = data?.items ?? [];
  const today = toLocalDateString(new Date());
  const deadlines = collectLicenseDeadlines(drivers, { todayIso: today });
  const total = data?.total ?? 0;
  const canArchive = hasPermission('driver:archive');

  const update = (patch: Partial<DriverFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="vfm-module-page">
      <div className="vfm-module-heading">
        <div>
          <h1 className="vfm-module-title">Vozači</h1>
          <p className="text-sm text-fg-muted">{isPending ? 'Učitavanje…' : `${total} vozača u registru`}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission('driver:create') && (
            <Link className={buttonClassName('primary', 'lg')} to="/vozaci/novi">
              Novi vozač
            </Link>
          )}
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
      </div>

      {message && (
        <Card>
          <CardContent>
            <p className="text-sm" role="status">
              {message}
            </p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent>
            <p className="text-sm text-danger" role="alert">
              {error instanceof ApiError ? error.message : 'Greška pri učitavanju vozača.'}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 vfm-grid-2-1">
        <Card>
          <CardHeader title="Filteri" description="Pretraga po imenu, broju zaposlenog i dozvoli." />
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Pretraga" htmlFor="vozaci-q">
                <input
                  id="vozaci-q"
                  className={inputClassName}
                  placeholder="Ime, prezime, broj zaposlenog"
                  value={filters.q}
                  onChange={(event) => update({ q: event.target.value })}
                />
              </Field>
              <Field label="Status" htmlFor="vozaci-status">
                <select
                  id="vozaci-status"
                  className={inputClassName}
                  value={filters.status}
                  onChange={(event) => update({ status: event.target.value })}
                >
                  <option value="">Svi</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status, 'driver')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kategorija" htmlFor="vozaci-kategorija" hint="npr. B, C, CE">
                <input
                  id="vozaci-kategorija"
                  className={inputClassName}
                  value={filters.licenseCategory}
                  onChange={(event) => update({ licenseCategory: event.target.value })}
                />
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
                  checked={filters.includeArchived}
                  onChange={(event) => update({ includeArchived: event.target.checked })}
                />
                Prikaži arhivirane
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Dozvole ističu" description="U narednih 30 dana." />
          <CardContent>
            {isPending ? (
              <p className="text-sm text-fg-muted" role="status">
                Učitavanje rokova…
              </p>
            ) : error ? (
              <p className="text-sm text-danger">Rokovi dozvola nisu dostupni.</p>
            ) : deadlines.length === 0 ? (
              <p className="text-sm text-fg-muted">Nema dozvola koje ističu u 30 dana.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {deadlines.map((entry) => (
                  <li key={entry.driverId} className="flex items-center justify-between gap-2">
                    <Link className="hover:underline" to={`/vozaci/${entry.driverId}`}>
                      {entry.name}
                    </Link>
                    <Badge level={deadlineLevel(entry.tone)} title={entry.date}>
                      {deadlineLabel(entry.date, today)}
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
            <p className="text-sm text-fg-muted" role="status">
              Učitavanje…
            </p>
          ) : error ? (
            <p className="text-sm text-danger">Registar vozača nije dostupan.</p>
          ) : drivers.length === 0 ? (
            <EmptyState
              title={
                isDriverFilteredEmpty(total, filters) ? 'Nema rezultata za filtere' : 'Registar je prazan'
              }
              description={
                isDriverFilteredEmpty(total, filters)
                  ? 'Promijenite pretragu, status ili kategoriju — arhivirani su sakriveni dok se ne uključe.'
                  : 'Vozači se dodaju kroz formu „Vozač" (Konfiguracija → Forme).'
              }
            />
          ) : (
            <Table scrollLabel="Lista vozača — pomjerite tabelu horizontalno za pregled svih kolona">
              <THead>
                <TR>
                  {canArchive && <TH> </TH>}
                  <TH>Vozač</TH>
                  <TH>Broj zaposlenog</TH>
                  <TH>Status</TH>
                  <TH>Kategorije</TH>
                  <TH>Dozvola ističe</TH>
                </TR>
              </THead>
              <TBody>
                {drivers.map((driver) => (
                  <TR key={driver.id}>
                    {canArchive && (
                      <TD>
                        <input
                          type="checkbox"
                          aria-label={`Odaberi ${driver.firstName} ${driver.lastName}`}
                          checked={selected.includes(driver.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, driver.id]
                                : current.filter((id) => id !== driver.id),
                            )
                          }
                        />
                      </TD>
                    )}
                    <TD>
                      <Link className="font-medium hover:underline" to={`/vozaci/${driver.id}`}>
                        {driver.lastName} {driver.firstName}
                      </Link>
                    </TD>
                    <TD>{driver.employeeNumber ?? '—'}</TD>
                    <TD>
                      <Badge level="neutral">{statusLabel(driver.status, 'driver')}</Badge>
                    </TD>
                    <TD>{driver.categories.length > 0 ? driver.categories.join(', ') : '—'}</TD>
                    <TD>
                      <LicenseCell driver={driver} today={today} />
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
          <span className="text-fg-muted">
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

function LicenseCell({ driver, today }: { driver: DriverSummary; today: string }) {
  if (!driver.licenseExpiresAt) return <span className="text-fg-muted">—</span>;
  return (
    <Badge
      level={deadlineLevel(deadlineTone(driver.licenseExpiresAt, today))}
      title={driver.licenseExpiresAt}
    >
      {deadlineLabel(driver.licenseExpiresAt, today)}
    </Badge>
  );
}
