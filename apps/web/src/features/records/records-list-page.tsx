/**
 * Registracije / osiguranje — lista svih zapisa (W09/W10, docs/06 §9.1).
 *
 * Zašto poseban ekran: do sada su se evidencije vidjele samo unutar profila
 * vozila, pa na pitanje „šta ističe ove sedmice" nije bilo odgovora bez
 * otvaranja svakog vozila.
 *
 * Napomene:
 * - `q` na serveru pretražuje **broj** (registracije) odnosno **broj police i
 *   kuću** (osiguranje) — vozilo se bira filterom, ne pretragom.
 * - API vraća `vehicleId`, pa se naziv vozila mapira iz liste vozila
 *   (`pageSize=100`, uključujući arhivirana). Bez mape red ostaje čitljiv
 *   (`vehicleId`), ali se ne prikazuje kao „nepoznato".
 * - `daysLeft` dolazi sa servera, ali boja se računa iz `validUntil`
 *   (`lib/deadlines.ts`) — isti pragovi kao na svim ostalim ekranima.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { RECORD_STATUSES, statusLabel, toLocalDateString } from '@vfm/shared';
import type {
  InsuranceListResponse,
  RegistrationListResponse,
  VehicleListResponse,
} from '@vfm/shared/schemas';
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
import { deadlineLabel, deadlineLevel, deadlineTone } from '../../lib/deadlines.js';
import { toQueryString } from '../vehicles/vehicles-model.js';
import { buildRecordsQuery, toRecordRows } from '../vehicles/records-model.js';

const PAGE_SIZE = 25;

/** Rokovi u filteru — iste vrijednosti kao pragovi (`DEADLINE_THRESHOLDS`). */
const WINDOWS = [
  { value: '', label: 'Svi rokovi' },
  { value: '7', label: 'Ističe u 7 dana' },
  { value: '30', label: 'Ističe u 30 dana' },
  { value: '365', label: 'Ističe u godinu dana' },
] as const;

export type RecordsListKind = 'REGISTRATION' | 'INSURANCE';

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('bs-BA', { timeZone: 'UTC' });
}

function money(amount: number | null): string {
  return amount === null ? '—' : `${(amount / 100).toFixed(2)} KM`;
}

export function RecordsListPage({ kind }: { kind: RecordsListKind }) {
  const today = toLocalDateString(new Date());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [windowDays, setWindowDays] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => buildRecordsQuery({ q, status, vehicleId, windowDays }, page, PAGE_SIZE),
    [page, q, status, vehicleId, windowDays],
  );

  const endpoint = kind === 'REGISTRATION' ? '/registrations' : '/insurances';

  const list = useQuery({
    queryKey: [kind.toLowerCase(), query],
    queryFn: () =>
      api.get<RegistrationListResponse | InsuranceListResponse>(`${endpoint}?${toQueryString(query)}`),
  });

  // Mapa `vehicleId → naziv` (jedan zahtjev; lista vozila je mala i keširana).
  const vehicles = useQuery({
    queryKey: ['vehicles', 'lookup'],
    queryFn: () =>
      api.get<VehicleListResponse>(
        `/vehicles?${toQueryString({ page: 1, pageSize: 100, includeArchived: true })}`,
      ),
  });

  const vehicleNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const vehicle of vehicles.data?.items ?? []) {
      map.set(vehicle.id, `${vehicle.internalNo} · ${vehicle.make} ${vehicle.model}`);
    }
    return map;
  }, [vehicles.data]);

  const rows = toRecordRows(kind, list.data?.items ?? []);
  const total = list.data?.total ?? 0;
  const filtered = q !== '' || status !== '' || windowDays !== '' || vehicleId !== '';
  const title = kind === 'REGISTRATION' ? 'Registracije' : 'Osiguranja';

  const reset = () => {
    setQ('');
    setStatus('');
    setWindowDays('');
    setVehicleId('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-[var(--fg-muted)]">
          {list.isPending ? 'Učitavanje…' : `${total} zapisa`} · periodi se ne preklapaju (409 PERIOD_OVERLAP)
        </p>
      </div>

      {list.error && (
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--danger)]">
              {list.error instanceof ApiError ? list.error.message : 'Greška pri učitavanju.'}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader title="Filteri" description="Rokovi se računaju prema `validUntil`." />
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Pretraga" htmlFor={`${kind}-q`}>
              <input
                id={`${kind}-q`}
                className={inputClassName}
                placeholder={kind === 'REGISTRATION' ? 'Broj registracije' : 'Broj police ili kuća'}
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field label="Vozilo" htmlFor={`${kind}-vozilo`}>
              <select
                id={`${kind}-vozilo`}
                className={inputClassName}
                value={vehicleId}
                onChange={(event) => {
                  setVehicleId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Sva vozila</option>
                {(vehicles.data?.items ?? []).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.internalNo} · {vehicle.make} {vehicle.model}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status" htmlFor={`${kind}-status`}>
              <select
                id={`${kind}-status`}
                className={inputClassName}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Svi</option>
                {RECORD_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value, 'record')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rok" htmlFor={`${kind}-rok`}>
              <select
                id={`${kind}-rok`}
                className={inputClassName}
                value={windowDays}
                onChange={(event) => {
                  setWindowDays(event.target.value);
                  setPage(1);
                }}
              >
                {WINDOWS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {filtered && (
            <Button className="mt-3" size="sm" variant="ghost" onClick={reset}>
              Očisti filtere
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {list.isPending ? (
            <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              title={filtered ? 'Nema rezultata za filtere' : `Nema ${title.toLowerCase()}`}
              description={
                filtered
                  ? 'Promijenite pretragu, vozilo ili rok.'
                  : 'Evidencija se dodaje s profila vozila (tab Registracije/Osiguranje).'
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Vozilo</TH>
                  <TH>{kind === 'REGISTRATION' ? 'Broj' : 'Polisa'}</TH>
                  <TH>Period</TH>
                  <TH>Rok</TH>
                  <TH>Status</TH>
                  <TH align="right">{kind === 'REGISTRATION' ? 'Trošak' : 'Premija'}</TH>
                  <TH>{kind === 'REGISTRATION' ? 'Izdavao' : 'Kuća / vrsta'}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <Link className="hover:underline" to={`/vozila/${row.vehicleId}`}>
                        {vehicleNames.get(row.vehicleId) ?? 'Nepoznato vozilo'}
                      </Link>
                    </TD>
                    <TD className="font-medium">{row.number}</TD>
                    <TD>
                      {formatDate(row.validFrom)} – {formatDate(row.validUntil)}
                    </TD>
                    <TD>
                      <Badge
                        level={deadlineLevel(deadlineTone(row.validUntil, today))}
                        title={row.validUntil}
                      >
                        {deadlineLabel(row.validUntil, today)}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge level="neutral">{statusLabel(row.status, 'record')}</Badge>
                    </TD>
                    <TD align="right">{money(row.amount)}</TD>
                    <TD>{row.extra}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(list.data?.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--fg-muted)]">
            Strana {list.data?.page ?? 1} / {list.data?.totalPages ?? 1}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Prethodna
            </Button>
            <Button
              size="sm"
              disabled={page >= (list.data?.totalPages ?? 1)}
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
