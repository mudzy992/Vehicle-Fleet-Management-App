/** Kompleti guma — serverski filtrirana evidencija i unos novog kompleta (W12). */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { TIRE_SEASONS, TIRE_STATUSES, formatMoney, statusLabel } from '@vfm/shared';
import type { TireSetListResponse, TireSetView } from '@vfm/shared/schemas';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Field,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  inputClassName,
} from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { toQueryString } from '../vehicles/vehicles-model.js';
import { TireSetCreateForm } from './tire-set-create-form.js';
import { DEFAULT_TIRE_SET_FILTERS, buildTireSetQuery, type TireSetFilters } from './tire-sets-model.js';

const PAGE_SIZE = 25;

function formatDate(value: string | null): string {
  return value ? new Date(`${value}T00:00:00Z`).toLocaleDateString('bs-BA', { timeZone: 'UTC' }) : '—';
}

export function TireSetsPage() {
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TireSetFilters>(DEFAULT_TIRE_SET_FILTERS);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const query = useMemo(() => buildTireSetQuery(filters, page, PAGE_SIZE), [filters, page]);
  const list = useQuery({
    queryKey: ['tire-sets', query],
    queryFn: () => api.get<TireSetListResponse>(`/tire-sets?${toQueryString(query)}`),
  });

  const canCreate = hasPermission('tire:create');
  const filtered =
    filters.q !== '' ||
    filters.season !== '' ||
    filters.status !== '' ||
    filters.availableOnly ||
    filters.sortBy !== DEFAULT_TIRE_SET_FILTERS.sortBy ||
    filters.sortOrder !== DEFAULT_TIRE_SET_FILTERS.sortOrder;

  const update = (patch: Partial<TireSetFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Kompleti guma</h1>
          <p className="text-sm text-[var(--fg-muted)]">
            {list.isPending ? 'Učitavanje…' : `${list.data?.total ?? 0} kompleta u evidenciji`}
          </p>
        </div>
        {canCreate && !showCreate && (
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            Novi komplet
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

      {list.error && (
        <Card>
          <CardContent>
            <p role="alert" className="text-sm text-[var(--danger)]">
              {list.error instanceof ApiError ? list.error.message : 'Greška pri učitavanju kompleta.'}
            </p>
          </CardContent>
        </Card>
      )}

      {showCreate && canCreate && (
        <Card>
          <CardHeader
            title="Novi komplet guma"
            description="Strukturirani podaci + dodatna polja objavljene TIRE_SET forme."
          />
          <CardContent>
            <TireSetCreateForm
              onCancel={() => setShowCreate(false)}
              onCreated={async () => {
                setShowCreate(false);
                setMessage('Sačuvano.');
                await queryClient.invalidateQueries({ queryKey: ['tire-sets'] });
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader title="Filteri" description="Pretraga i paginacija rade se na serveru." />
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Field label="Pretraga" htmlFor="kompleti-q">
              <input
                id="kompleti-q"
                className={inputClassName}
                placeholder="Kod, marka, model, dimenzija ili lokacija"
                value={filters.q}
                onChange={(event) => update({ q: event.target.value })}
              />
            </Field>
            <Field label="Sezona" htmlFor="kompleti-sezona">
              <select
                id="kompleti-sezona"
                className={inputClassName}
                value={filters.season}
                onChange={(event) => update({ season: event.target.value })}
              >
                <option value="">Sve sezone</option>
                {TIRE_SEASONS.map((season) => (
                  <option key={season} value={season}>
                    {statusLabel(season, 'tireSeason')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status" htmlFor="kompleti-status">
              <select
                id="kompleti-status"
                className={inputClassName}
                value={filters.status}
                onChange={(event) => update({ status: event.target.value })}
              >
                <option value="">Svi statusi</option>
                {TIRE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status, 'tireStatus')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sortiranje" htmlFor="kompleti-sort">
              <select
                id="kompleti-sort"
                className={inputClassName}
                value={filters.sortBy}
                onChange={(event) => update({ sortBy: event.target.value })}
              >
                <option value="code">Kod kompleta</option>
                <option value="brand">Proizvođač</option>
                <option value="purchaseDate">Datum nabavke</option>
                <option value="purchasePrice">Nabavna cijena</option>
                <option value="createdAt">Datum unosa</option>
              </select>
            </Field>
            <div className="space-y-2 pt-6 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.availableOnly}
                  onChange={(event) => update({ availableOnly: event.target.checked })}
                />
                Samo dostupni za montažu
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.sortOrder === 'desc'}
                  onChange={(event) => update({ sortOrder: event.target.checked ? 'desc' : 'asc' })}
                />
                Obrnut redoslijed
              </label>
            </div>
          </div>
          {filtered && (
            <Button
              className="mt-3"
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilters(DEFAULT_TIRE_SET_FILTERS);
                setPage(1);
              }}
            >
              Očisti filtere
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {list.isPending ? (
            <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>
          ) : !list.data?.items.length ? (
            <EmptyState
              title={filtered ? 'Nema kompleta za odabrane filtere' : 'Evidencija kompleta je prazna'}
              description={
                filtered
                  ? 'Promijenite pretragu, sezonu, status ili filter dostupnosti.'
                  : canCreate
                    ? 'Dodajte prvi komplet dugmetom „Novi komplet“.'
                    : 'Komplete može dodati korisnik s pravom tire:create.'
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Komplet</TH>
                  <TH>Sezona / status</TH>
                  <TH align="right">Broj guma</TH>
                  <TH>Nabavka</TH>
                  <TH>Lokacija / vozilo</TH>
                  <TH>Napomena</TH>
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((row) => (
                  <TireSetRow key={row.id} row={row} />
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(list.data?.totalPages ?? 0) > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Strana {list.data?.page ?? page} / {list.data?.totalPages ?? 1} · {list.data?.total ?? 0} kompleta
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

function TireSetRow({ row }: { row: TireSetView }) {
  return (
    <TR>
      <TD>
        <p className="font-medium">{row.code}</p>
        <p>{[row.brand, row.model].filter(Boolean).join(' ') || '—'}</p>
        <p className="text-xs text-[var(--fg-muted)]">{row.size ?? 'Bez dimenzije'}</p>
      </TD>
      <TD>
        <p>{statusLabel(row.season, 'tireSeason')}</p>
        <StatusBadge value={row.status} domain="tireStatus" />
      </TD>
      <TD align="right" className="tabular-nums">
        {row.tireCount}
      </TD>
      <TD>
        <p>{formatDate(row.purchaseDate)}</p>
        <p className="text-xs text-[var(--fg-muted)]">
          {row.purchasePrice === null ? '—' : formatMoney(row.purchasePrice)}
        </p>
      </TD>
      <TD>
        {row.mountedVehicleId ? (
          <>
            <Link className="font-medium hover:underline" to={`/vozila/${row.mountedVehicleId}`}>
              {row.mountedVehicleInternalNo ?? 'Montirano vozilo'}
            </Link>
            <p className="text-xs text-[var(--fg-muted)]">{row.mountedVehiclePlateNumber ?? '—'}</p>
          </>
        ) : (
          (row.currentLocation ?? '—')
        )}
      </TD>
      <TD>{row.notes ?? '—'}</TD>
    </TR>
  );
}
