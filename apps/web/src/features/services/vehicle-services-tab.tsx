import { ServiceCreateForm } from './service-create-form.js';
import { useSession } from '../auth/session.js';
import { useQueryClient } from '@tanstack/react-query';
/** Pregled i unos servisa vozila; stavke računa slijede odvojeno. */
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
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['services', vehicleId, page],
    queryFn: () =>
      api.get<ServiceListResponse>(
        `/services?vehicleId=${encodeURIComponent(vehicleId)}&page=${page}&pageSize=25`,
      ),
  });
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
        <EmptyState
          title="Nema servisnih evidencija"
          description="Dodajte servisnu evidenciju. Stavke računa slijede u narednoj cjelini."
        />
      </div>
    );
  return (
    <div className="space-y-4">
      {addButton}
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
