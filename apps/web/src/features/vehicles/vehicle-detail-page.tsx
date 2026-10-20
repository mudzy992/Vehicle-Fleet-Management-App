/**
 * Detalji vozila (W06, docs/06 §5.5; docs/07 §2.5).
 *
 * Tabovi koji su u Fazi 3 stvarno implementirani: **Osnovno**, **Registracije**,
 * **Osiguranje**, **Kilometraža**, **Prilozi**. Ostali tabovi (Servisi, Gume,
 * Zadaci, Historija) pripadaju Fazi 4/5 i ovdje su označeni kao takvi — bolje
 * vidljivo „nije još" nego prazan tab koji izgleda kao greška.
 *
 * Kilometraža: niža vrijednost je `422 ODOMETER_REGRESSION`; ekran nudi
 * „korekcija" tek kad korisnik ima `odometer:correct` i traži razlog.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { statusLabel } from '@vfm/shared';
import type {
  AttachmentListResponse,
  InsuranceListResponse,
  OdometerListResponse,
  RegistrationListResponse,
  VehicleDetail,
} from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  buttonClassName,
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
import { VehicleRecordForm } from './record-form.js';
import { useSession } from '../auth/session.js';
import { deadlineLabel, deadlineTone, toQueryString } from './vehicles-model.js';

type Tab = 'osnovno' | 'registracije' | 'osiguranje' | 'kilometraza' | 'prilozi';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'osnovno', label: 'Osnovno' },
  { id: 'registracije', label: 'Registracije' },
  { id: 'osiguranje', label: 'Osiguranje' },
  { id: 'kilometraza', label: 'Kilometraža' },
  { id: 'prilozi', label: 'Prilozi' },
];

const PHASE_LATER: ReadonlyArray<{ label: string; phase: string }> = [
  { label: 'Servisi', phase: 'Faza 4' },
  { label: 'Gume', phase: 'Faza 4' },
  { label: 'Zadaci', phase: 'Faza 5' },
  { label: 'Historija', phase: 'Faza 5' },
];

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('bs-BA', { timeZone: 'UTC' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' });
}

export function VehicleDetailPage() {
  const { vehicleId = '' } = useParams();
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('osnovno');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
    enabled: vehicleId !== '',
  });

  const vehicle = detail.data;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
    await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };

  const archive = useMutation({
    mutationFn: () => api.post<null>(`/vehicles/${vehicleId}/archive`, { reason: 'Arhivirano s detalja' }),
    onSuccess: async () => {
      setActionMessage('Vozilo je arhivirano.');
      await invalidate();
    },
  });

  const restore = useMutation({
    mutationFn: () => api.post<null>(`/vehicles/${vehicleId}/restore`),
    onSuccess: async () => {
      setActionMessage('Vozilo je vraćeno iz arhive.');
      await invalidate();
    },
  });

  if (detail.isPending) return <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>;

  if (detail.error || !vehicle) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--danger)]">
            {detail.error instanceof ApiError ? detail.error.message : 'Vozilo nije pronađeno.'}
          </p>
          <Link className="mt-2 inline-block text-sm hover:underline" to="/vozila">
            ← Natrag na listu
          </Link>
        </CardContent>
      </Card>
    );
  }

  const archived = vehicle.status === 'ARCHIVED';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-xs text-[var(--fg-muted)] hover:underline" to="/vozila">
            ← Vozila
          </Link>
          <h1 className="text-xl font-semibold">
            {vehicle.internalNo} · {vehicle.make} {vehicle.model}
          </h1>
          <p className="text-sm text-[var(--fg-muted)]">
            {vehicle.plateNumber ?? 'bez tablica'} · {statusLabel(vehicle.status, 'vehicle')} ·{' '}
            {vehicle.odometerKm.toLocaleString('bs-BA')} km
          </p>
        </div>
        <div className="flex gap-2">
          {!archived && hasPermission('vehicle:update') && (
            <Link className={buttonClassName('secondary', 'sm')} to={`/vozila/${vehicle.id}/izmjena`}>
              Uredi
            </Link>
          )}
          {!archived && hasPermission('vehicle:archive') && (
            <Button
              variant="secondary"
              size="sm"
              loading={archive.isPending}
              onClick={() => archive.mutate()}
            >
              Arhiviraj
            </Button>
          )}
          {archived && hasPermission('vehicle:archive') && (
            <Button
              variant="secondary"
              size="sm"
              loading={restore.isPending}
              onClick={() => restore.mutate()}
            >
              Vrati iz arhive
            </Button>
          )}
        </div>
      </div>

      {actionMessage && <p className="text-sm">{actionMessage}</p>}

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={[
              'rounded-md px-3 py-1.5 text-sm',
              tab === item.id
                ? 'bg-[var(--primary)] text-[var(--primary-fg)]'
                : 'text-[var(--fg-muted)] hover:bg-[var(--hover)]',
            ].join(' ')}
          >
            {item.label}
          </button>
        ))}
        {PHASE_LATER.map((item) => (
          <span
            key={item.label}
            title={`${item.label} — ${item.phase}`}
            className="cursor-not-allowed rounded-md px-3 py-1.5 text-sm text-[var(--fg-muted)] opacity-60"
          >
            {item.label} <span className="text-[10px]">({item.phase})</span>
          </span>
        ))}
      </div>

      {tab === 'osnovno' && <OverviewTab vehicle={vehicle} />}
      {tab === 'registracije' && <RegistrationsTab vehicleId={vehicle.id} onChanged={invalidate} />}
      {tab === 'osiguranje' && <InsurancesTab vehicleId={vehicle.id} onChanged={invalidate} />}
      {tab === 'kilometraza' && <OdometerTab vehicle={vehicle} onChanged={invalidate} />}
      {tab === 'prilozi' && <AttachmentsTab vehicleId={vehicle.id} />}
    </div>
  );
}

function OverviewTab({ vehicle }: { vehicle: VehicleDetail }) {
  const rows: ReadonlyArray<[string, string]> = [
    ['VIN', vehicle.vin ?? '—'],
    ['Godina', vehicle.year ? String(vehicle.year) : '—'],
    ['Boja', vehicle.color ?? '—'],
    ['Karoserija', vehicle.bodyType ?? '—'],
    ['Motor', vehicle.engineCcm ? `${vehicle.engineCcm} cm³` : '—'],
    ['Snaga', vehicle.enginePowerKw ? `${vehicle.enginePowerKw} kW` : '—'],
    ['Mjenjač', vehicle.transmission ?? '—'],
    ['Sjedišta', vehicle.seats ? String(vehicle.seats) : '—'],
    ['Vlasništvo', vehicle.ownershipType],
    ['Nabavljeno', formatDate(vehicle.acquisitionDate)],
    ['Cijena nabavke', vehicle.acquisitionPrice ? `${(vehicle.acquisitionPrice / 100).toFixed(2)} KM` : '—'],
    ['Troškovni centar', vehicle.costCenter ?? '—'],
    ['Zadnji servis (datum)', formatDate(vehicle.nextServiceDueDate)],
    ['Zadnji servis (km)', vehicle.nextServiceDueKm ? vehicle.nextServiceDueKm.toLocaleString('bs-BA') : '—'],
    ['Kilometraža ažurirana', vehicle.odometerUpdatedAt ? formatDateTime(vehicle.odometerUpdatedAt) : '—'],
    ['Napomena', vehicle.notes ?? '—'],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Podaci vozila"
          description="Normalizovane kolone (JSONB samo za dodatna polja forme)."
        />
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-[var(--fg-muted)]">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Rokovi" />
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-2">
                <span>Registracija</span>
                <Deadline date={vehicle.registrationExpiresAt} />
              </li>
              <li className="flex items-center justify-between gap-2">
                <span>Osiguranje</span>
                <Deadline date={vehicle.insuranceExpiresAt} />
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Forma zapisa"
            description="Verzija forme koja je validirala zapis (P10) — migracija je eksplicitna."
          />
          <CardContent>
            <p className="text-xs text-[var(--fg-muted)]">Verzija forme</p>
            <p className="font-mono text-xs">{vehicle.formSchemaVersionId}</p>
            {Object.keys(vehicle.formData).length > 0 && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--surface-muted)] p-2 text-[11px]">
                {JSON.stringify(vehicle.formData, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Deadline({ date }: { date: string | null }) {
  const tone = deadlineTone(date);
  if (!date) return <span className="text-[var(--fg-muted)]">—</span>;
  const level = tone === 'overdue' ? 'danger' : tone === 'ok' ? 'success' : 'warning';
  return (
    <Badge level={level} title={date}>
      {formatDate(date)} · {deadlineLabel(date)}
    </Badge>
  );
}

function RegistrationsTab({ vehicleId, onChanged }: { vehicleId: string; onChanged: () => Promise<void> }) {
  const { hasPermission } = useSession();
  const [adding, setAdding] = useState(false);
  const query = useQuery({
    queryKey: ['registrations', vehicleId],
    queryFn: () =>
      api.get<RegistrationListResponse>(
        `/registrations?${toQueryString({ vehicleId, page: 1, pageSize: 25 })}`,
      ),
  });

  return (
    <div className="space-y-4">
      {hasPermission('registration:create') &&
        (adding ? (
          <VehicleRecordForm
            kind="REGISTRATION"
            vehicleId={vehicleId}
            onCreated={async () => {
              setAdding(false);
              await onChanged();
            }}
          />
        ) : (
          <Button size="sm" onClick={() => setAdding(true)}>
            Nova registracija
          </Button>
        ))}

      {query.isPending ? (
        <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>
      ) : !query.data?.items.length ? (
        <EmptyState
          title="Nema registracija"
          description="Registracija se dodaje kroz formu „Registracija vozila“; periodi se ne smiju preklapati (409 PERIOD_OVERLAP)."
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Broj</TH>
                  <TH>Period</TH>
                  <TH>Status</TH>
                  <TH align="right">Cijena</TH>
                  <TH>Izdavao</TH>
                </TR>
              </THead>
              <TBody>
                {query.data.items.map((item) => (
                  <TR key={item.id}>
                    <TD>{item.registrationNumber}</TD>
                    <TD>
                      {formatDate(item.validFrom)} – {formatDate(item.validUntil)}
                    </TD>
                    <TD>
                      <Badge level="neutral">{statusLabel(item.status, 'record')}</Badge>
                    </TD>
                    <TD align="right">
                      {item.costAmount === null ? '—' : `${(item.costAmount / 100).toFixed(2)} KM`}
                    </TD>
                    <TD>{item.issuedBy ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InsurancesTab({ vehicleId, onChanged }: { vehicleId: string; onChanged: () => Promise<void> }) {
  const { hasPermission } = useSession();
  const [adding, setAdding] = useState(false);
  const query = useQuery({
    queryKey: ['insurances', vehicleId],
    queryFn: () =>
      api.get<InsuranceListResponse>(`/insurances?${toQueryString({ vehicleId, page: 1, pageSize: 25 })}`),
  });

  return (
    <div className="space-y-4">
      {hasPermission('insurance:create') &&
        (adding ? (
          <VehicleRecordForm
            kind="INSURANCE"
            vehicleId={vehicleId}
            onCreated={async () => {
              setAdding(false);
              await onChanged();
            }}
          />
        ) : (
          <Button size="sm" onClick={() => setAdding(true)}>
            Novo osiguranje
          </Button>
        ))}

      {query.isPending ? (
        <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>
      ) : !query.data?.items.length ? (
        <EmptyState
          title="Nema osiguranja"
          description="Polica se dodaje kroz formu „Osiguranje vozila“; periodi se ne smiju preklapati."
        />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Polisa</TH>
                  <TH>Kuća</TH>
                  <TH>Period</TH>
                  <TH>Status</TH>
                  <TH align="right">Premija</TH>
                </TR>
              </THead>
              <TBody>
                {query.data.items.map((item) => (
                  <TR key={item.id}>
                    <TD>{item.policyNumber ?? '—'}</TD>
                    <TD>{item.insuranceCompany ?? '—'}</TD>
                    <TD>
                      {formatDate(item.validFrom)} – {formatDate(item.validUntil)}
                    </TD>
                    <TD>
                      <Badge level="neutral">{statusLabel(item.status, 'record')}</Badge>
                    </TD>
                    <TD align="right">
                      {item.premiumAmount === null ? '—' : `${(item.premiumAmount / 100).toFixed(2)} KM`}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OdometerTab({ vehicle, onChanged }: { vehicle: VehicleDetail; onChanged: () => Promise<void> }) {
  const { hasPermission } = useSession();
  const [valueKm, setValueKm] = useState('');
  const [readingAt, setReadingAt] = useState('');
  const [correction, setCorrection] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['odometer', vehicle.id],
    queryFn: () => api.get<OdometerListResponse>(`/vehicles/${vehicle.id}/odometer?page=1&pageSize=50`),
  });

  const add = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { valueKm: Number(valueKm), source: 'MANUAL' };
      if (readingAt) payload.readingAt = new Date(`${readingAt}T12:00:00.000Z`).toISOString();
      if (correction) payload.correctionReason = reason.trim();
      const path = correction
        ? `/vehicles/${vehicle.id}/odometer/correct`
        : `/vehicles/${vehicle.id}/odometer`;
      return api.post<unknown>(path, payload);
    },
    onSuccess: async () => {
      setMessage('Očitanje je upisano.');
      setValueKm('');
      setReadingAt('');
      setReason('');
      await onChanged();
      await query.refetch();
    },
    onError: (error) => {
      setMessage(
        error instanceof ApiError && error.code === 'ODOMETER_REGRESSION'
          ? 'Nova vrijednost je niža od trenutne — potvrdite korekciju i unesite razlog.'
          : error instanceof ApiError
            ? error.message
            : 'Greška pri upisu očitanja.',
      );
    },
  });

  const canCreate = hasPermission('odometer:create');
  const canCorrect = hasPermission('odometer:correct');

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Card>
        <CardHeader
          title="Novo očitanje"
          description="Niža vrijednost zahtijeva korekciju s razlogom (422)."
        />
        <CardContent>
          <div className="space-y-3">
            <Field label="Kilometraža (km)" htmlFor="odo-km">
              <input
                id="odo-km"
                className={inputClassName}
                inputMode="numeric"
                value={valueKm}
                onChange={(event) => setValueKm(event.target.value.replace(/[^0-9]/gu, ''))}
              />
            </Field>
            <Field label="Datum očitanja" htmlFor="odo-date" hint="Prazno = sada.">
              <input
                id="odo-date"
                type="date"
                className={inputClassName}
                value={readingAt}
                onChange={(event) => setReadingAt(event.target.value)}
              />
            </Field>
            {canCorrect && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={correction}
                  onChange={(event) => setCorrection(event.target.checked)}
                />
                Korekcija (niža vrijednost)
              </label>
            )}
            {correction && (
              <Field label="Razlog korekcije" htmlFor="odo-reason" hint="Najmanje 5 znakova; ide u audit.">
                <input
                  id="odo-reason"
                  className={inputClassName}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            )}
            <Button
              size="sm"
              loading={add.isPending}
              disabled={!canCreate || valueKm === '' || (correction && reason.trim().length < 5)}
              onClick={() => add.mutate()}
            >
              Upiši očitanje
            </Button>
            {message && <p className="text-xs">{message}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Historija kilometraže"
          description="Nema brisanja — pogrešno očitanje se ispravlja korekcijom."
        />
        <CardContent>
          {query.isPending ? (
            <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>
          ) : !query.data?.items.length ? (
            <EmptyState title="Nema očitanja" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH align="right">Km</TH>
                  <TH>Vrijeme</TH>
                  <TH>Izvor</TH>
                  <TH>Korekcija</TH>
                </TR>
              </THead>
              <TBody>
                {query.data.items.map((item) => (
                  <TR key={item.id}>
                    <TD align="right">{item.valueKm.toLocaleString('bs-BA')}</TD>
                    <TD>{formatDateTime(item.readingAt)}</TD>
                    <TD>{statusLabel(item.source, 'odometerSource')}</TD>
                    <TD>{item.isCorrection ? (item.correctionReason ?? 'da') : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AttachmentsTab({ vehicleId }: { vehicleId: string }) {
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['attachments', 'VEHICLE', vehicleId],
    queryFn: () =>
      api.get<AttachmentListResponse>(
        `/attachments?${toQueryString({ ownerType: 'VEHICLE', ownerId: vehicleId, page: 1, pageSize: 50 })}`,
      ),
  });

  if (query.isPending) return <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>;
  if (!query.data?.items.length) {
    return (
      <EmptyState
        title="Nema priloga"
        description="Prilozi se dodaju uz zapis (registracija, osiguranje, zadatak) ili kroz upload na detalju vozila."
      />
    );
  }

  return (
    <Card>
      <CardContent>
        {error && <p className="mb-2 text-xs text-[var(--danger)]">{error}</p>}
        <Table>
          <THead>
            <TR>
              <TH>Fajl</TH>
              <TH>Tip</TH>
              <TH align="right">Veličina</TH>
              <TH>Dodano</TH>
              <TH> </TH>
            </TR>
          </THead>
          <TBody>
            {query.data.items.map((item) => (
              <TR key={item.id}>
                <TD>{item.fileName}</TD>
                <TD>{item.mimeType}</TD>
                <TD align="right">{(item.sizeBytes / 1024).toFixed(0)} kB</TD>
                <TD>{formatDateTime(item.createdAt)}</TD>
                <TD>
                  {/* Preuzimanje ide kroz **potpisani URL** — `<a href>` ne nosi
                      access token iz memorije, a `/content` ga traži. */}
                  <button
                    type="button"
                    className="text-sm hover:underline"
                    onClick={async () => {
                      try {
                        const signed = await api.get<{ url: string }>(`/attachments/${item.id}/url`);
                        window.open(signed.url, '_blank', 'noopener');
                      } catch (cause) {
                        setError(cause instanceof ApiError ? cause.message : 'Preuzimanje nije uspjelo.');
                      }
                    }}
                  >
                    Preuzmi
                  </button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
