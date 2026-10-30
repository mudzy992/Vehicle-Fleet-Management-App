import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditLogListResponse } from '@vfm/shared/schemas';
import { Badge, Button, Card, CardContent, EmptyState } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';

const PAGE_SIZE = 25;
const dateTime = (value: string) => new Date(value).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' });

export function VehicleHistoryTab({ vehicleId }: { vehicleId: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['vehicle', vehicleId, 'history', page],
    queryFn: () =>
      api.get<AuditLogListResponse>(`/vehicles/${vehicleId}/history?page=${page}&pageSize=${PAGE_SIZE}`),
  });
  const data = query.data;

  if (query.isPending)
    return (
      <p role="status" className="text-sm text-fg-muted">
        Učitavanje historije…
      </p>
    );
  if (query.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {query.error instanceof ApiError ? query.error.message : 'Historija vozila se ne može učitati.'}
      </p>
    );
  if (!data?.items.length)
    return (
      <Card>
        <CardContent>
          <EmptyState
            title="Nema historijskih promjena"
            description="Promjene osnovnih podataka vozila, arhiviranje i korekcije evidentirat će se ovdje."
          />
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">Promjene osnovnog zapisa vozila · ukupno: {data.total}</p>
      <ol className="space-y-2" aria-label="Historija vozila">
        {data.items.map((entry) => (
          <li key={entry.id}>
            <Card>
              <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      level={
                        entry.severity === 'CRITICAL'
                          ? 'danger'
                          : entry.severity === 'WARN'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {entry.action}
                    </Badge>
                    <span className="text-sm font-medium">
                      {entry.actorEmail ??
                        (entry.actorId ? `Korisnik ${entry.actorId.slice(0, 8)}` : 'Sistem')}
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted">
                    {entry.changedFields.length
                      ? `Promijenjena polja: ${entry.changedFields.join(', ')}`
                      : 'Zabilježena promjena vozila'}
                    {entry.reason ? ` · Razlog: ${entry.reason}` : ''}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-fg-muted" dateTime={entry.createdAt}>
                  {dateTime(entry.createdAt)}
                </time>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      {data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-fg-muted">
            Stranica {data.page} od {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Prethodna
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= data.totalPages}
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
