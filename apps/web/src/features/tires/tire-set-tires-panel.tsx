/** Pojedinačne gume kompleta — pregled sastava i dodavanje novih zapisa. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDate, formatMoney, statusLabel } from '@vfm/shared';
import type { TireListResponse, TireSetView, TireView } from '@vfm/shared/schemas';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { CoreFields, type CoreFieldSpec } from '../forms/form-fields.js';
import { availableTirePositions, buildTirePayload, formatTreadDepth } from './tire-sets-model.js';

function productionLabel(tire: TireView): string {
  if (tire.productionWeek && tire.productionYear) {
    return `${tire.productionWeek}. sedmica ${tire.productionYear}.`;
  }
  if (tire.productionYear) return `${tire.productionYear}.`;
  if (tire.productionWeek) return `${tire.productionWeek}. sedmica`;
  return '—';
}

export function TireSetTiresPanel({ tireSet, onClose }: { tireSet: TireSetView; onClose: () => void }) {
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const canCreate = hasPermission('tire:create');

  const tiresQuery = useQuery({
    queryKey: ['tire-set-tires', tireSet.id],
    queryFn: () => api.get<TireListResponse>(`/tire-sets/${tireSet.id}/tires`),
    retry: false,
  });
  const items = tiresQuery.data?.items ?? [];
  const occupiedPositions = items.map((tire) => tire.position);
  const capacityReached = items.length >= tireSet.tireCount;

  const create = useMutation({
    mutationFn: () =>
      api.post<TireView>(`/tire-sets/${tireSet.id}/tires`, buildTirePayload(values, occupiedPositions)),
    onSuccess: async (created) => {
      setValues({});
      setShowCreate(false);
      setMessage('');
      setSuccess(
        `Guma ${created.serialNumber ?? created.dot ?? 'bez oznake'} je dodana u komplet ${tireSet.code}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['tire-set-tires', tireSet.id] });
    },
    onError: (error) => {
      setSuccess('');
      setMessage(
        error instanceof ApiError || error instanceof Error ? error.message : 'Dodavanje gume nije uspjelo.',
      );
    },
  });

  if (tiresQuery.isPending) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--fg-muted)]">Učitavanje pojedinačnih guma…</p>
        </CardContent>
      </Card>
    );
  }

  if (tiresQuery.error || !tiresQuery.data) {
    return (
      <Card>
        <CardHeader title={`Pojedinačne gume — ${tireSet.code}`} />
        <CardContent>
          <div className="space-y-3">
            <p role="alert" className="text-sm text-[var(--danger)]">
              {tiresQuery.error instanceof ApiError
                ? tiresQuery.error.message
                : 'Pojedinačne gume nije moguće učitati.'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void tiresQuery.refetch()}>
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

  const fields: readonly CoreFieldSpec[] = [
    {
      key: 'position',
      label: 'Pozicija',
      kind: 'SELECT',
      hint: 'Zauzete pozicije nisu ponuđene.',
      options: availableTirePositions(items).map((position) => ({
        value: position,
        label: statusLabel(position, 'tirePosition'),
      })),
    },
    { key: 'serialNumber', label: 'Serijski broj', kind: 'TEXT' },
    { key: 'dot', label: 'DOT oznaka', kind: 'TEXT' },
    {
      key: 'productionWeek',
      label: 'Sedmica proizvodnje',
      kind: 'INTEGER',
      hint: 'Od 1 do 53.',
    },
    { key: 'productionYear', label: 'Godina proizvodnje', kind: 'INTEGER' },
    {
      key: 'treadDepthMm',
      label: 'Dubina profila (mm)',
      kind: 'TEXT',
      hint: 'Najviše jedna decimala, npr. 7,5.',
    },
    { key: 'purchaseDate', label: 'Datum nabavke', kind: 'DATE' },
    { key: 'purchasePrice', label: 'Nabavna cijena (KM)', kind: 'TEXT' },
    { key: 'notes', label: 'Napomena', kind: 'MULTILINE' },
  ];

  return (
    <Card>
      <CardHeader
        title={`Pojedinačne gume — ${tireSet.code}`}
        description={`${items.length} od ${tireSet.tireCount} guma evidentirano · komplet: ${statusLabel(tireSet.status, 'tireStatus')}`}
        actions={
          <Button size="sm" variant="ghost" disabled={create.isPending} onClick={onClose}>
            Zatvori
          </Button>
        }
      />
      <CardContent>
        <div className="space-y-4">
          {success && <p className="text-sm">{success}</p>}

          {items.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Pozicija / status</TH>
                  <TH>Oznake</TH>
                  <TH>Proizvodnja</TH>
                  <TH align="right">Dubina profila</TH>
                  <TH>Nabavka</TH>
                  <TH>Napomena</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((tire) => (
                  <TR key={tire.id}>
                    <TD>
                      <p className="font-medium">
                        {tire.position ? statusLabel(tire.position, 'tirePosition') : 'Bez pozicije'}
                      </p>
                      <StatusBadge value={tire.status} domain="tireStatus" />
                    </TD>
                    <TD>
                      <p>{tire.serialNumber ?? 'Bez serijskog broja'}</p>
                      <p className="text-xs text-[var(--fg-muted)]">DOT: {tire.dot ?? '—'}</p>
                    </TD>
                    <TD>{productionLabel(tire)}</TD>
                    <TD align="right" className="tabular-nums">
                      {formatTreadDepth(tire.treadDepthTenthsMm)}
                    </TD>
                    <TD>
                      <p>{tire.purchaseDate ? formatDate(tire.purchaseDate) : '—'}</p>
                      <p className="text-xs text-[var(--fg-muted)]">
                        {tire.purchasePrice === null ? '—' : formatMoney(tire.purchasePrice)}
                      </p>
                    </TD>
                    <TD>{tire.notes ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState
              title="Nema evidentiranih pojedinačnih guma"
              description={
                canCreate
                  ? 'Dodajte gume jednu po jednu dok ne popunite deklarisani sastav kompleta.'
                  : 'Pojedinačne gume može dodati korisnik s pravom tire:create.'
              }
            />
          )}

          {canCreate && capacityReached && (
            <p className="text-sm text-[var(--fg-muted)]">
              Evidentiran je deklarisani broj guma. Za još jedan zapis prvo povećajte broj guma kompleta kroz
              izmjenu kompleta.
            </p>
          )}

          {canCreate && !capacityReached && !showCreate && (
            <Button
              size="sm"
              onClick={() => {
                setMessage('');
                setSuccess('');
                setShowCreate(true);
              }}
            >
              Dodaj gumu
            </Button>
          )}

          {canCreate && !capacityReached && showCreate && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setMessage('');
                setSuccess('');
                create.mutate();
              }}
            >
              <p className="text-sm text-[var(--fg-muted)]">
                Status nove gume se ne bira ručno. Server ga određuje prema statusu kompleta, aktivnoj montaži
                i odabranoj poziciji.
              </p>
              <fieldset disabled={create.isPending}>
                <CoreFields
                  fields={fields}
                  values={values}
                  idPrefix="pojedinacna-guma"
                  disabled={create.isPending}
                  onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
                />
              </fieldset>

              {message && (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {message} Unos je ostao u formi.
                </p>
              )}

              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={create.isPending}>
                  Dodaj gumu
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={create.isPending}
                  onClick={() => {
                    setShowCreate(false);
                    setMessage('');
                  }}
                >
                  Odustani
                </Button>
              </div>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
