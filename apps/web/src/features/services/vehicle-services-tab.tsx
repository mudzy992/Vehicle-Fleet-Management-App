import { ServiceEditForm } from './service-edit-form.js';
import type { ServiceRecord } from '@vfm/shared/schemas';
import { ServiceItemsPanel } from './service-items-panel.js';
import { ServiceCreateForm } from './service-create-form.js';
import { useSession } from '../auth/session.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  nextServicesPageAfterDelete,
  serviceDeleteConfirmation,
  serviceDeletedMessage,
} from './service-delete-model.js';
/** Pregled, unos, izmjena i brisanje servisa vozila. */
import { useQuery } from '@tanstack/react-query';
import { statusLabel } from '@vfm/shared';
import type { ServiceListResponse } from '@vfm/shared/schemas';
import { useState } from 'react';
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

export function VehicleServicesTab({ vehicleId }: { vehicleId: string }) {
  const client = useQueryClient();
  const { hasPermission } = useSession();
  const [editing, setEditing] = useState<ServiceRecord | null>(null);
  const [itemsId, setItemsId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['services', vehicleId, page],
    queryFn: () =>
      api.get<ServiceListResponse>(
        `/services?vehicleId=${encodeURIComponent(vehicleId)}&page=${page}&pageSize=25`,
      ),
  });
  const canDelete = hasPermission('service:delete');
  const remove = useMutation({
    mutationFn: (row: ServiceRecord) => api.delete<void>(`/services/${row.id}`),
    onSuccess: async (_data, row) => {
      const nextPage = nextServicesPageAfterDelete(page, query.data?.items.length ?? 0);
      if (nextPage !== page) setPage(nextPage);
      setDeleteMessage(serviceDeletedMessage(row));
      setDeleteError(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['services'] }),
        client.invalidateQueries({ queryKey: ['service-items', row.id] }),
        client.invalidateQueries({ queryKey: ['vehicle', vehicleId] }),
        client.invalidateQueries({ queryKey: ['vehicles'] }),
      ]);
    },
    onError: (error) =>
      setDeleteError(
        error instanceof ApiError || error instanceof Error ? error.message : 'Brisanje nije uspjelo.',
      ),
  });
  const requestDelete = (row: ServiceRecord) => {
    setDeleteMessage(null);
    setDeleteError(null);
    if (window.confirm(serviceDeleteConfirmation(row))) remove.mutate(row);
  };
  const deleteFeedback = (
    <>
      {deleteMessage && <p className="text-sm">{deleteMessage}</p>}
      {deleteError && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {deleteError}
        </p>
      )}
    </>
  );
  if (editing && hasPermission('service:update'))
    return <ServiceEditForm key={editing.id} record={editing} onClose={() => setEditing(null)} />;
  if (itemsId) return <ServiceItemsPanel serviceId={itemsId} onClose={() => setItemsId(null)} />;
  if (adding && hasPermission('service:create'))
    return (
      <ServiceCreateForm
        vehicleId={vehicleId}
        onCancel={() => setAdding(false)}
        onCreated={async () => {
          await Promise.all([
            client.invalidateQueries({ queryKey: ['services'] }),
            client.invalidateQueries({ queryKey: ['vehicle', vehicleId] }),
            client.invalidateQueries({ queryKey: ['vehicles'] }),
            client.invalidateQueries({ queryKey: ['odometer', vehicleId] }),
          ]);
          setAdding(false);
        }}
      />
    );
  const addButton = hasPermission('service:create') ? (
    <Button size="sm" onClick={() => setAdding(true)}>
      Novi servis
    </Button>
  ) : null;
  if (query.isPending) return <p>Učitavanje servisa…</p>;
  if (query.error)
    return (
      <p role="alert">
        {query.error instanceof ApiError ? query.error.message : 'Učitavanje servisa nije uspjelo.'}
      </p>
    );
  if (!query.data?.items.length)
    return (
      <div className="space-y-4">
        {addButton}
        {deleteFeedback}
        <EmptyState title="Nema servisnih evidencija" description="Dodajte servisnu evidenciju." />
      </div>
    );
  return (
    <div className="space-y-4">
      {addButton}
      {deleteFeedback}
      <Card>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Datum</TH>
                <TH>Vrsta / radionica</TH>
                <TH>Kilometraža</TH>
                <TH align="right">Trošak</TH>
                <TH>Sljedeći servis</TH>
                <TH>Status</TH>
                <TH>Radnje</TH>
              </TR>
            </THead>
            <TBody>
              {query.data.items.map((row) => (
                <TR key={row.id}>
                  <TD>
                    {new Date(`${row.serviceDate}T00:00:00Z`).toLocaleDateString('bs-BA', {
                      timeZone: 'UTC',
                    })}
                  </TD>
                  <TD>
                    <p>{row.serviceType}</p>
                    <p className="text-xs text-[var(--fg-muted)]">{row.workshopName ?? '—'}</p>
                    {row.description && <p className="text-sm">{row.description}</p>}
                  </TD>
                  <TD>{row.odometerKm === null ? '—' : `${row.odometerKm.toLocaleString('bs-BA')} km`}</TD>
                  <TD align="right">
                    {(row.totalCost / 100).toFixed(2)} {row.currency === 'BAM' ? 'KM' : row.currency}
                  </TD>
                  <TD>
                    {row.nextServiceDueDate ?? '—'}
                    {row.nextServiceDueKm !== null && (
                      <p>{row.nextServiceDueKm.toLocaleString('bs-BA')} km</p>
                    )}
                  </TD>
                  <TD>
                    <Badge level="neutral">{statusLabel(row.status, 'record')}</Badge>
                  </TD>
                  <TD>
                    <Button size="sm" variant="ghost" onClick={() => setItemsId(row.id)}>
                      Stavke
                    </Button>
                    {hasPermission('service:update') && row.status === 'ACTIVE' && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                        Uredi servis
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={remove.isPending}
                        loading={remove.isPending && remove.variables?.id === row.id}
                        aria-label={`Obriši servis ${row.serviceType} od ${row.serviceDate}`}
                        onClick={() => requestDelete(row)}
                      >
                        Obriši
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex items-center justify-between">
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
    </div>
  );
}
