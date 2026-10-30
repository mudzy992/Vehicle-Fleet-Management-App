/**
 * Rokovi (W14, docs/06 §9.1; docs/07 §2.14).
 *
 * Zakazani podsjetnici se **ne** kreiraju ručno: skener u 06:00
 * (`Europe/Sarajevo`) upisuje ih iz politika (`ReminderPolicy`, default 5 dana
 * prije), a `dedupeKey` unique čini ponovni sken idempotentnim. Ekran zato nudi
 * samo pregled, potvrdu (`acknowledge`) i odgađanje (`snooze`).
 *
 * `dueDate` može biti `null` (podsjetnici po kilometraži) — tada se prikazuje
 * `fireAt`, a boja roka se ne izmišlja kao „isteklo".
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toLocalDateString } from '@vfm/shared';
import { REMINDER_KINDS, REMINDER_STATUSES, statusLabel } from '@vfm/shared';
import type { ReminderListResponse, ReminderScanResult } from '@vfm/shared/schemas';
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
import { toQueryString } from '../vehicles/vehicles-model.js';

const PAGE_SIZE = 50;

/** Veza zapisa → ekran; nepoznat tip ostaje tekst (npr. `VEHICLE_HANDOVER`). */
function entityLink(entityType: string, entityId: string): string | null {
  if (entityType === 'Vehicle') return `/vozila/${entityId}`;
  if (entityType === 'Driver') return `/vozaci/${entityId}`;
  return null;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' });
}

export function RemindersPage() {
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();
  const today = toLocalDateString(new Date());

  const [status, setStatus] = useState('SCHEDULED');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(status ? { status } : {}),
      ...(kind ? { kind } : {}),
    }),
    [page, status, kind],
  );

  const { data, isPending, error } = useQuery({
    queryKey: ['reminders', query],
    queryFn: () => api.get<ReminderListResponse>(`/reminders?${toQueryString(query)}`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['reminders'] });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/reminders/${id}/acknowledge`),
    onSuccess: async () => {
      setMessage('Podsjetnik je potvrđen.');
      await invalidate();
    },
    onError: (cause) =>
      setMessage(cause instanceof ApiError ? cause.message : 'Greška pri potvrdi podsjetnika.'),
  });

  const snooze = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => api.post(`/reminders/${id}/snooze`, { days }),
    onSuccess: async () => {
      setMessage('Podsjetnik je odgođen.');
      await invalidate();
    },
    onError: (cause) =>
      setMessage(cause instanceof ApiError ? cause.message : 'Greška pri odgađanju podsjetnika.'),
  });

  const scan = useMutation({
    mutationFn: () => api.post<ReminderScanResult>('/reminders/scan'),
    onSuccess: async (result) => {
      setMessage(`Sken završen: ${result.candidates} kandidata, ${result.created} novih podsjetnika.`);
      await invalidate();
    },
    onError: (cause) => setMessage(cause instanceof ApiError ? cause.message : 'Sken nije uspio.'),
  });

  const items = data?.items ?? [];

  return (
    <div className="vfm-module-page">
      <div className="vfm-module-heading">
        <div>
          <h1 className="vfm-module-title">Rokovi</h1>
          <p className="text-sm text-fg-muted">
            {isPending ? 'Učitavanje…' : `${data?.total ?? 0} podsjetnika`} · skener radi u 06:00
            (Europe/Sarajevo)
          </p>
        </div>
        {hasPermission('system:run_maintenance') && (
          <Button size="sm" variant="secondary" loading={scan.isPending} onClick={() => scan.mutate()}>
            Pokreni skener
          </Button>
        )}
      </div>

      {message && (
        <p
          className="text-sm"
          role={acknowledge.isError || snooze.isError || scan.isError ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}

      <Card>
        <CardHeader title="Filteri" description="Samo ono što je u prozorima politika." />
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status" htmlFor="rokovi-status">
              <select
                id="rokovi-status"
                className={inputClassName}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Svi</option>
                {REMINDER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value, 'reminderStatus')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vrsta" htmlFor="rokovi-vrsta">
              <select
                id="rokovi-vrsta"
                className={inputClassName}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Sve</option>
                {REMINDER_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value, 'reminderKind')}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent>
            <p className="text-sm text-danger" role="alert">
              {error instanceof ApiError ? error.message : 'Greška pri učitavanju podsjetnika.'}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {isPending ? (
            <p className="text-sm text-fg-muted" role="status">
              Učitavanje…
            </p>
          ) : error ? (
            <p className="text-sm text-danger">Podsjetnici nisu dostupni.</p>
          ) : items.length === 0 ? (
            <EmptyState
              title="Nema podsjetnika"
              description="Skener upisuje podsjetnike iz politika; ako je prazno i poslije skena, provjerite pragove u Postavke → Podsjetnici."
            />
          ) : (
            <Table scrollLabel="Podsjetnici — pomjerite tabelu horizontalno za pregled svih kolona">
              <THead>
                <TR>
                  <TH>Vrsta</TH>
                  <TH>Zapis</TH>
                  <TH>Rok</TH>
                  <TH>Status</TH>
                  <TH>Akcije</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => {
                  const link = entityLink(item.entityType, item.entityId);
                  return (
                    <TR key={item.id}>
                      <TD>{statusLabel(item.kind, 'reminderKind')}</TD>
                      <TD>
                        {link ? (
                          <Link className="hover:underline" to={link}>
                            {item.entityType}
                          </Link>
                        ) : (
                          item.entityType
                        )}
                        <span className="ml-2 text-xs text-fg-muted">
                          {item.dueKm === null ? '' : `${item.dueKm.toLocaleString('bs-BA')} km`}
                        </span>
                      </TD>
                      <TD>
                        {item.dueDate ? (
                          <Badge
                            level={deadlineLevel(deadlineTone(item.dueDate, today))}
                            title={item.dueDate}
                          >
                            {deadlineLabel(item.dueDate, today)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-fg-muted">{formatDateTime(item.fireAt)}</span>
                        )}
                      </TD>
                      <TD>
                        <Badge level={item.due ? 'warning' : 'neutral'}>
                          {statusLabel(item.status, 'reminderStatus')}
                        </Badge>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {hasPermission('reminder:acknowledge') && item.status !== 'ACKNOWLEDGED' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={acknowledge.isPending}
                              onClick={() => acknowledge.mutate(item.id)}
                            >
                              Potvrdi
                            </Button>
                          )}
                          {hasPermission('reminder:snooze') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={snooze.isPending}
                              onClick={() => snooze.mutate({ id: item.id, days: 7 })}
                            >
                              +7 d
                            </Button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
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
