/**
 * Vozač — detalji (W08, docs/06 §9.1; docs/07 §2.4).
 *
 * - PII (telefon, e-mail, adresa, datum rođenja, broj dozvole) dolazi **samo**
 *   uz `driver:view_pii`; kad nije dato, server vraća maskirane vrijednosti i
 *   `piiRedacted: true`, a ekran to kaže umjesto da izgleda kao prazan profil.
 * - Rok dozvole i kategorije nisu PII — vidljivi su svima s `driver:view`.
 * - Kategorija se ne „preuređuje": mijenja se datum/ograničenje, a pogrešna
 *   kategorija se briše i dodaje (server čuva historiju kroz audit).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { toLocalDateString } from '@vfm/shared';
import { statusLabel } from '@vfm/shared';
import type { DriverDetail, DriverLicenseCategoryList } from '@vfm/shared/schemas';
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
import { useSession } from '../auth/session.js';

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('bs-BA', { timeZone: 'UTC' });
}

export function DriverDetailPage() {
  const { driverId = '' } = useParams();
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const today = toLocalDateString(new Date());

  const detail = useQuery({
    queryKey: ['driver', driverId],
    queryFn: () => api.get<DriverDetail>(`/drivers/${driverId}`),
    enabled: driverId !== '',
  });

  const categories = useQuery({
    queryKey: ['driver-categories', driverId],
    queryFn: () => api.get<DriverLicenseCategoryList>(`/drivers/${driverId}/license-categories`),
    enabled: driverId !== '',
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['driver', driverId] });
    await queryClient.invalidateQueries({ queryKey: ['driver-categories', driverId] });
    await queryClient.invalidateQueries({ queryKey: ['drivers'] });
  };

  const archive = useMutation({
    mutationFn: () => api.post<null>(`/drivers/${driverId}/archive`, { reason: 'Arhivirano s profila' }),
    onSuccess: async () => {
      setMessage('Vozač je arhiviran.');
      setMessageIsError(false);
      await invalidate();
    },
    onError: (cause) => {
      setMessage(cause instanceof ApiError ? cause.message : 'Greška pri arhiviranju vozača.');
      setMessageIsError(true);
    },
  });

  const restore = useMutation({
    mutationFn: () => api.post<null>(`/drivers/${driverId}/restore`),
    onSuccess: async () => {
      setMessage('Vozač je vraćen iz arhive.');
      setMessageIsError(false);
      await invalidate();
    },
    onError: (cause) => {
      setMessage(cause instanceof ApiError ? cause.message : 'Greška pri vraćanju vozača.');
      setMessageIsError(true);
    },
  });

  const driver = detail.data;

  if (detail.isPending)
    return (
      <p className="text-sm text-[var(--fg-muted)]" role="status">
        Učitavanje…
      </p>
    );

  if (detail.error || !driver) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--danger)]" role="alert">
            {detail.error instanceof ApiError ? detail.error.message : 'Vozač nije pronađen.'}
          </p>
          <Link className="mt-2 inline-block text-sm hover:underline" to="/vozaci">
            ← Natrag na listu
          </Link>
        </CardContent>
      </Card>
    );
  }

  const archived = driver.status === 'ARCHIVED';

  return (
    <div className="vfm-module-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="text-xs text-[var(--fg-muted)] hover:underline" to="/vozaci">
            ← Vozači
          </Link>
          <h1 className="vfm-module-title">
            {driver.firstName} {driver.lastName}
          </h1>
          <p className="text-sm text-[var(--fg-muted)]">
            {driver.employeeNumber ?? 'bez broja zaposlenog'} · {statusLabel(driver.status, 'driver')} ·{' '}
            {driver.categories.length > 0 ? driver.categories.join(', ') : 'bez kategorija'}
          </p>
        </div>
        <div className="flex gap-2">
          {!archived && hasPermission('driver:archive') && (
            <Button
              variant="secondary"
              size="sm"
              loading={archive.isPending}
              onClick={() => archive.mutate()}
            >
              Arhiviraj
            </Button>
          )}
          {archived && hasPermission('driver:archive') && (
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

      {message && (
        <p className="text-sm" role={messageIsError ? 'alert' : 'status'}>
          {message}
        </p>
      )}

      {driver.piiRedacted && (
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--warning)]">
              Lični podaci su maskirani — potrebna je permisija <code>driver:view_pii</code>.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Kontakt i identitet" description="PII polja (docs/05 §8.2)." />
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Row label="Telefon" value={driver.phone} />
              <Row label="E-mail" value={driver.email} />
              <Row label="Datum rođenja" value={formatDate(driver.dateOfBirth)} />
              <Row label="Adresa" value={driver.address} />
              <Row label="Broj dozvole" value={driver.licenseNumber} />
              <Row label="Status zaposlenja" value={driver.employmentStatus} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Vozačka dozvola" description="Rok dozvole nije PII — nosi podsjetnike." />
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Row label="Izdana" value={formatDate(driver.licenseIssuedAt)} />
              <div className="contents">
                <dt className="text-[var(--fg-muted)]">Ističe</dt>
                <dd>
                  {driver.licenseExpiresAt ? (
                    <Badge
                      level={deadlineLevel(deadlineTone(driver.licenseExpiresAt, today))}
                      title={driver.licenseExpiresAt}
                    >
                      {formatDate(driver.licenseExpiresAt)} · {deadlineLabel(driver.licenseExpiresAt, today)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <Row label="Izdavao" value={driver.licenseIssuingAuthority} />
              <Row label="Ograničenja" value={driver.restrictions} />
              <Row label="Napomena" value={driver.notes} />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Kategorije dozvole"
          description="Kategorija se briše i dodaje; datumi se mogu ispravljati."
        />
        <CardContent>
          {categories.isPending ? (
            <p className="text-sm text-[var(--fg-muted)]" role="status">
              Učitavanje…
            </p>
          ) : categories.error ? (
            <p className="text-sm text-[var(--danger)]" role="alert">
              {categories.error instanceof ApiError
                ? categories.error.message
                : 'Greška pri učitavanju kategorija dozvole.'}
            </p>
          ) : !categories.data?.items.length ? (
            <EmptyState
              title="Nema kategorija"
              description="Dodajte kategoriju (B, C, CE…) s rokom važenja."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Kategorija</TH>
                  <TH>Izdana</TH>
                  <TH>Ističe</TH>
                  <TH>Ograničenja</TH>
                  <TH> </TH>
                </TR>
              </THead>
              <TBody>
                {categories.data.items.map((item) => (
                  <TR key={item.id}>
                    <TD className="font-medium">{item.category}</TD>
                    <TD>{formatDate(item.issuedAt)}</TD>
                    <TD>
                      {item.expiresAt ? (
                        <Badge
                          level={deadlineLevel(deadlineTone(item.expiresAt, today))}
                          title={item.expiresAt}
                        >
                          {formatDate(item.expiresAt)} · {deadlineLabel(item.expiresAt, today)}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>{item.restrictions ?? '—'}</TD>
                    <TD>
                      {hasPermission('driver:update') && (
                        <DeleteCategoryButton driverId={driver.id} categoryId={item.id} onDone={invalidate} />
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {hasPermission('driver:update') && <AddCategoryForm driverId={driver.id} onDone={invalidate} />}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="contents">
      <dt className="text-[var(--fg-muted)]">{label}</dt>
      <dd className="break-words">{value ?? '—'}</dd>
    </div>
  );
}

function AddCategoryForm({ driverId, onDone }: { driverId: string; onDone: () => Promise<void> }) {
  const [category, setCategory] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      api.post(`/drivers/${driverId}/license-categories`, {
        category: category.trim().toUpperCase(),
        ...(issuedAt ? { issuedAt } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      }),
    onSuccess: async () => {
      setCategory('');
      setIssuedAt('');
      setExpiresAt('');
      setError(null);
      await onDone();
    },
    onError: (cause) => {
      setError(cause instanceof ApiError ? cause.message : 'Greška pri dodavanju kategorije.');
    },
  });

  return (
    <form
      className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <Field label="Kategorija" htmlFor="kat-kategorija">
        <input
          id="kat-kategorija"
          className={inputClassName}
          maxLength={5}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        />
      </Field>
      <Field label="Izdana" htmlFor="kat-izdana">
        <input
          id="kat-izdana"
          type="date"
          className={inputClassName}
          value={issuedAt}
          onChange={(event) => setIssuedAt(event.target.value)}
        />
      </Field>
      <Field label="Ističe" htmlFor="kat-istice">
        <input
          id="kat-istice"
          type="date"
          className={inputClassName}
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
      </Field>
      <div className="flex items-end">
        <Button type="submit" size="sm" loading={add.isPending} disabled={category.trim() === ''}>
          Dodaj kategoriju
        </Button>
      </div>
      {error && (
        <p role="alert" className="sm:col-span-4 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </form>
  );
}

function DeleteCategoryButton({
  driverId,
  categoryId,
  onDone,
}: {
  driverId: string;
  categoryId: string;
  onDone: () => Promise<void>;
}) {
  const remove = useMutation({
    mutationFn: () => api.delete<null>(`/drivers/${driverId}/license-categories/${categoryId}`),
    onSuccess: () => onDone(),
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
        Obriši
      </Button>
      {remove.error ? (
        <span role="alert" className="text-[11px] text-[var(--danger)]">
          {remove.error instanceof ApiError ? remove.error.message : 'Greška pri brisanju kategorije.'}
        </span>
      ) : null}
    </div>
  );
}
