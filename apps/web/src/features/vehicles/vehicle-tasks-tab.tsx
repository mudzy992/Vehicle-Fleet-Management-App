import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { TaskListResponse } from '@vfm/shared/schemas';
import { statusLabel } from '@vfm/shared';
import {
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
import { ApiError, api } from '../../lib/api.js';

const PAGE_SIZE = 20;
const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' }) : '—';

export function VehicleTasksTab({ vehicleId }: { vehicleId: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['vehicle', vehicleId, 'tasks', page],
    queryFn: () =>
      api.get<TaskListResponse>(`/vehicles/${vehicleId}/tasks?page=${page}&pageSize=${PAGE_SIZE}`),
  });
  const data = query.data;

  if (query.isPending)
    return (
      <p role="status" className="text-sm text-fg-muted">
        Učitavanje zadataka…
      </p>
    );
  if (query.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {query.error instanceof ApiError ? query.error.message : 'Zadaci vozila se ne mogu učitati.'}
      </p>
    );
  if (!data?.items.length)
    return (
      <Card>
        <CardContent>
          <EmptyState
            title="Nema zadataka za ovo vozilo"
            description="Kreirani zadaci povezani s vozilom pojavit će se ovdje."
          />
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">Ukupno: {data.total}</p>
      <Card flush>
        <Table scrollLabel="Zadaci vozila — pomjerite tabelu horizontalno za pregled svih kolona">
          <THead>
            <TR>
              <TH>Kod i naslov</TH>
              <TH>Vrsta</TH>
              <TH>Status</TH>
              <TH>Prioritet</TH>
              <TH>Izvršilac</TH>
              <TH>Rok</TH>
              <TH>Kreirano</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.map((task) => (
              <TR key={task.id}>
                <TD>
<Link className="font-medium text-primary hover:underline" to={`/zadaci/${task.id}`}>
                  {task.code} · {task.title}
                </Link>
                </TD>
                <TD>{task.taskTypeName}</TD>
                <TD>{statusLabel(task.status, 'taskStatus')}</TD>
                <TD>{statusLabel(task.priority, 'taskPriority')}</TD>
                <TD>{task.assigneeName ?? 'Nije dodijeljen'}</TD>
                <TD>{dateTime(task.dueAt)}</TD>
                <TD>{dateTime(task.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
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
