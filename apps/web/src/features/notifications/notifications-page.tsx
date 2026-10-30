import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { OUTBOX_EVENT_TYPES } from '@vfm/shared';
import type {
  NotificationListResponse,
  NotificationMarkAllRead,
  NotificationPreferenceInput,
  NotificationPreferenceList,
  NotificationPreferenceView,
  NotificationUnreadCount,
  NotificationView,
} from '@vfm/shared/schemas';
import { Badge, Button, Card, CardContent, EmptyState, Field, Modal } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { notificationDate, notificationDestination, notificationTypeLabel } from './notifications-model.js';

const PAGE_SIZE = 20;
const NOTIFICATION_QUERY_KEY = ['notifications'] as const;
const UNREAD_QUERY_KEY = ['notification-unread-count'] as const;
const PREFERENCE_QUERY_KEY = ['notification-preferences'] as const;

interface StreamMessage {
  readonly type: string;
  readonly data: unknown;
}

async function consumeEventStream(
  response: Response,
  signal: AbortSignal,
  onMessage: (message: StreamMessage) => void,
  onEventId: (id: string) => void,
): Promise<void> {
  if (!response.body) throw new Error('Server nije otvorio SSE stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = 'message';
  let eventId = '';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length > 0) {
      let data: unknown = dataLines.join('\n');
      try {
        data = JSON.parse(data as string) as unknown;
      } catch {
        /* Keep plain text SSE payload. */
      }
      onMessage({ type: eventType, data });
      if (eventId) onEventId(eventId);
    }
    eventType = 'message';
    eventId = '';
    dataLines = [];
  };

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') {
          dispatch();
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const valueText = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /u, '');
        if (field === 'event') eventType = valueText;
        else if (field === 'id' && !valueText.includes('\0')) eventId = valueText;
        else if (field === 'data') dataLines.push(valueText);
      }
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function priorityLevel(priority: NotificationView['priority']): 'neutral' | 'info' | 'warning' | 'danger' {
  if (priority === 'URGENT') return 'danger';
  if (priority === 'HIGH') return 'warning';
  if (priority === 'NORMAL') return 'info';
  return 'neutral';
}

function defaultPreference(type: string): NotificationPreferenceInput {
  return { type, channelInApp: true, channelFcm: true, channelEmail: false };
}

function currentPreference(
  type: string,
  rows: readonly NotificationPreferenceView[],
): NotificationPreferenceInput {
  const row = rows.find((item) => item.type === type);
  return row
    ? {
        type: row.type,
        channelInApp: row.channelInApp,
        channelFcm: row.channelFcm,
        channelEmail: row.channelEmail,
      }
    : defaultPreference(type);
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status, hasPermission } = useSession();
  const canView = hasPermission('notification:view');
  const canMarkRead = hasPermission('notification:mark_read');
  const canManagePreferences = hasPermission('notification:manage_preferences');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');

  const notificationsQuery = useQuery({
    queryKey: [...NOTIFICATION_QUERY_KEY, unreadOnly, page],
    queryFn: () =>
      api.get<NotificationListResponse>(
        `/notifications?page=${page}&pageSize=${PAGE_SIZE}&unreadOnly=${unreadOnly}`,
      ),
    enabled: status === 'authenticated' && canView,
    refetchInterval: 30_000,
  });
  const unreadQuery = useQuery({
    queryKey: UNREAD_QUERY_KEY,
    queryFn: () => api.get<NotificationUnreadCount>('/notifications/unread-count'),
    enabled: status === 'authenticated' && canView,
    refetchInterval: 30_000,
  });
  const preferencesQuery = useQuery({
    queryKey: PREFERENCE_QUERY_KEY,
    queryFn: () => api.get<NotificationPreferenceList>('/notifications/preferences'),
    enabled: preferencesOpen && canManagePreferences,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post<NotificationView>(`/notifications/${id}/read`),
    onSuccess: (updated) => {
      queryClient.setQueryData<NotificationUnreadCount>(UNREAD_QUERY_KEY, (current) =>
        current ? { count: Math.max(0, current.count - 1) } : current,
      );
      queryClient.setQueriesData<NotificationListResponse>({ queryKey: NOTIFICATION_QUERY_KEY }, (current) =>
        current
          ? { ...current, items: current.items.map((item) => (item.id === updated.id ? updated : item)) }
          : current,
      );
      setActionError(null);
    },
    onError: (error) =>
      setActionError(error instanceof ApiError ? error.message : 'Obavijest nije označena kao pročitana.'),
  });
  const markAllRead = useMutation({
    mutationFn: () => api.post<NotificationMarkAllRead>('/notifications/read-all', {}),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: NOTIFICATION_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY }),
      ]);
    },
    onError: (error) =>
      setActionError(error instanceof ApiError ? error.message : 'Obavijesti nisu označene kao pročitane.'),
  });
  const savePreference = useMutation({
    mutationFn: (input: NotificationPreferenceInput) =>
      api.put<NotificationPreferenceView>('/notifications/preferences', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PREFERENCE_QUERY_KEY });
      setActionError(null);
    },
    onError: (error) => setActionError(error instanceof ApiError ? error.message : 'Postavka nije sačuvana.'),
  });

  useEffect(() => {
    if (status !== 'authenticated' || !canView) return;
    const controller = new AbortController();
    let lastEventId: string | undefined;
    let retryDelay = 1_000;
    const wait = (milliseconds: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, milliseconds);
        controller.signal.addEventListener(
          'abort',
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await api.openEventStream('/notifications/stream', controller.signal, lastEventId);
          setStreamState('connected');
          retryDelay = 1_000;
          await consumeEventStream(
            response,
            controller.signal,
            (message) => {
              if (message.type === 'notification') {
                void queryClient.invalidateQueries({ queryKey: NOTIFICATION_QUERY_KEY });
                void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY });
              } else if (
                message.type === 'unread-count' &&
                typeof message.data === 'object' &&
                message.data !== null &&
                'count' in message.data
              ) {
                const count = (message.data as { count?: unknown }).count;
                if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
                  queryClient.setQueryData<NotificationUnreadCount>(UNREAD_QUERY_KEY, { count });
                }
              }
            },
            (id) => {
              lastEventId = id;
            },
          );
          if (!controller.signal.aborted) setStreamState('reconnecting');
        } catch {
          if (controller.signal.aborted) break;
          setStreamState('reconnecting');
          void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY });
        }
        await wait(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    })();
    return () => controller.abort();
  }, [status, canView, queryClient]);

  const rows = notificationsQuery.data?.items ?? [];
  const totalPages = notificationsQuery.data?.totalPages ?? 0;
  const preferenceInputs = useMemo(
    () => OUTBOX_EVENT_TYPES.map((type) => currentPreference(type, preferencesQuery.data?.items ?? [])),
    [preferencesQuery.data?.items],
  );

  const openNotification = (item: NotificationView) => {
    const destination = notificationDestination(item);
    if (item.isRead || !canMarkRead) {
      if (destination) navigate(destination);
      return;
    }
    markRead.mutate(item.id, {
      onSuccess: () => {
        if (destination) navigate(destination);
      },
    });
  };

  return (
    <main className="vfm-module-page">
      <header className="vfm-module-heading">
        <div>
          <h1 className="vfm-module-title">Obavijesti</h1>
          <p className="text-sm text-fg-muted">
            Lične in-app obavijesti · {unreadQuery.data?.count ?? 0} nepročitanih
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManagePreferences ? (
            <Button variant="secondary" onClick={() => setPreferencesOpen(true)}>
              Postavke
            </Button>
          ) : null}
          {canMarkRead && (unreadQuery.data?.count ?? 0) > 0 ? (
            <Button loading={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
              Označi sve pročitane
            </Button>
          ) : null}
        </div>
      </header>

      {actionError ? (
        <p role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger">
          {actionError}
        </p>
      ) : null}
      {notificationsQuery.error ? (
        <p role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger">
          {notificationsQuery.error instanceof ApiError
            ? notificationsQuery.error.message
            : 'Obavijesti se ne mogu učitati.'}
        </p>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter obavijesti">
            <Button
              variant={!unreadOnly ? 'primary' : 'secondary'}
              onClick={() => {
                setUnreadOnly(false);
                setPage(1);
              }}
            >
              Sve
            </Button>
            <Button
              variant={unreadOnly ? 'primary' : 'secondary'}
              onClick={() => {
                setUnreadOnly(true);
                setPage(1);
              }}
            >
              Nepročitane
            </Button>
          </div>
          <span role="status" className="text-sm text-fg-muted">
            Veza uživo:{' '}
            {streamState === 'connected'
              ? 'povezana'
              : streamState === 'connecting'
                ? 'uspostavlja se'
                : 'ponovno povezivanje'}
          </span>
        </CardContent>
      </Card>

      {notificationsQuery.isPending ? (
        <Card>
          <CardContent>
            <p role="status" className="text-sm text-fg-muted">
              Učitavanje obavijesti…
            </p>
          </CardContent>
        </Card>
      ) : null}
      {!notificationsQuery.isPending && rows.length === 0 ? (
        <Card>
          <EmptyState
            title={unreadOnly ? 'Nema nepročitanih obavijesti' : 'Još nema obavijesti'}
            description="Nove obavijesti će se pojaviti ovdje kada budu dostupne."
          />
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <section className="space-y-3" aria-label="Lista obavijesti">
          {rows.map((item) => {
            const destination = notificationDestination(item);
            const content = (
              <Card key={item.id} className={item.isRead ? 'opacity-80' : 'border-primary'}>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {!item.isRead ? (
                        <span className="h-2 w-2 rounded-full bg-primary" aria-label="Nepročitano" />
                      ) : null}
                      <h2 className="text-base font-semibold">{item.title}</h2>
                      <Badge level={priorityLevel(item.priority)}>
                        {item.priority === 'URGENT'
                          ? 'Hitno'
                          : item.priority === 'HIGH'
                            ? 'Visok prioritet'
                            : item.priority === 'LOW'
                              ? 'Nizak prioritet'
                              : 'Uobičajeno'}
                      </Badge>
                    </div>
                    <p className="text-sm text-fg-muted">{item.body ?? notificationTypeLabel(item.type)}</p>
                    <p className="text-xs text-fg-muted">
                      {notificationTypeLabel(item.type)} · {notificationDate(item.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!item.isRead && canMarkRead ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={markRead.isPending && markRead.variables === item.id}
                        onClick={() => markRead.mutate(item.id)}
                      >
                        Označi pročitano
                      </Button>
                    ) : null}
                    {destination ? (
                      <Button size="sm" variant="ghost" onClick={() => openNotification(item)}>
                        Otvori
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
            return (
              <article
                key={item.id}
                aria-label={`${item.title}, ${item.isRead ? 'pročitano' : 'nepročitano'}`}
              >
                {content}
              </article>
            );
          })}
        </section>
      ) : null}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Stranice obavijesti">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Prethodna
          </Button>
          <span className="text-sm text-fg-muted">
            Stranica {page} od {totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Sljedeća
          </Button>
        </nav>
      ) : null}

      {canManagePreferences ? (
        <Modal
          open={preferencesOpen}
          title="Postavke obavijesti"
          description="Postavke važe samo za vaš korisnički račun. Promjene se čuvaju po vrsti obavijesti."
          onClose={() => setPreferencesOpen(false)}
          size="lg"
          footer={
            <Button variant="secondary" onClick={() => setPreferencesOpen(false)}>
              Zatvori
            </Button>
          }
        >
          {preferencesQuery.error ? (
            <p role="alert" className="mb-3 text-sm text-danger">
              Postavke nisu dostupne.
            </p>
          ) : null}
          <p className="mb-4 rounded-lg border border-warning bg-warning-soft p-3 text-sm text-warning">
            Push dostava zavisi od Firebase/FCM konfiguracije vlasnika sistema. E-mail kanal trenutno nije
            aktivan; njegove postavke su samo informativne.
          </p>
          <div className="space-y-3">
            {preferenceInputs.map((input) => (
              <PreferenceRow
                key={input.type}
                input={input}
                saving={savePreference.isPending && savePreference.variables?.type === input.type}
                onChange={(next) => savePreference.mutate(next)}
              />
            ))}
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

function PreferenceRow({
  input,
  saving,
  onChange,
}: {
  input: NotificationPreferenceInput;
  saving: boolean;
  onChange: (input: NotificationPreferenceInput) => void;
}) {
  const update = (key: keyof Omit<NotificationPreferenceInput, 'type'>, value: boolean) =>
    onChange({ ...input, [key]: value });
  return (
    <fieldset
      className="vfm-notification-preference-grid grid gap-3 rounded-lg border border-border p-3"
      disabled={saving}
    >
      <legend className="sr-only">{notificationTypeLabel(input.type)}</legend>
      <div className="min-w-0">
        <p className="font-medium">{notificationTypeLabel(input.type)}</p>
        {saving ? (
          <p role="status" className="text-xs text-fg-muted">
            Čuvanje…
          </p>
        ) : null}
      </div>
      <PreferenceCheckbox
        id={`notification-${input.type}-in-app`}
        label="In-app"
        checked={input.channelInApp}
        onChange={(value) => update('channelInApp', value)}
      />
      <PreferenceCheckbox
        id={`notification-${input.type}-push`}
        label="Push"
        checked={input.channelFcm}
        onChange={(value) => update('channelFcm', value)}
      />
      <PreferenceCheckbox
        id={`notification-${input.type}-email`}
        label="E-mail · neaktivan"
        checked={input.channelEmail}
        disabled
        onChange={() => undefined}
      />
    </fieldset>
  );
}

function PreferenceCheckbox({
  id,
  label,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        className="vfm-checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </Field>
  );
}
