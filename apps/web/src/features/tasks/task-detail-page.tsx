import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { statusLabel } from '@vfm/shared';
import type { TaskCommentListResponse, TaskDetail } from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Field,
  StatusBadge,
  inputClassName,
} from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { TaskCompletionForm } from './task-completion-form.js';
import { TaskStatusActions } from './task-status-actions.js';

const COMMENTS_PAGE_SIZE = 20;

function dateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('bs-BA', {
    timeZone: 'Europe/Sarajevo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Da' : 'Ne';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function TaskDetailPage() {
  const { taskId } = useParams();
  const { hasPermission, status } = useSession();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const taskQuery = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.get<TaskDetail>(`/tasks/${taskId}`),
    enabled: status === 'authenticated' && Boolean(taskId),
  });
  const commentsQuery = useQuery({
    queryKey: ['task-comments', taskId, 1],
    queryFn: () =>
      api.get<TaskCommentListResponse>(`/tasks/${taskId}/comments?page=1&pageSize=${COMMENTS_PAGE_SIZE}`),
    enabled: status === 'authenticated' && Boolean(taskId) && taskQuery.isSuccess,
  });

  const claimMutation = useMutation({
    mutationFn: () => api.post<TaskDetail>(`/tasks/${taskId}/claim`),
    onSuccess: async (task) => {
      setClaimError(null);
      setMessage(`Preuzeli ste zadatak ${task.code}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
    onError: async (error) => {
      setClaimError(error instanceof ApiError ? error.message : 'Zadatak nije preuzet. Osvježite stranicu.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
  });
  const commentMutation = useMutation({
    mutationFn: (body: string) => api.post(`/tasks/${taskId}/comments`, { body }),
    onSuccess: async () => {
      setComment('');
      setMessage('Komentar je dodan.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task-comments', taskId] }),
        queryClient.invalidateQueries({ queryKey: ['task', taskId] }),
      ]);
    },
    onError: (error) =>
      setMessage(error instanceof ApiError ? error.message : 'Komentar nije dodan. Pokušajte ponovo.'),
  });

  if (!taskId) {
    return <EmptyState title="Zadatak nije pronađen" description="Nedostaje identifikator zadatka." />;
  }
  if (taskQuery.isPending) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-fg-muted">Učitavanje zadatka…</p>
        </CardContent>
      </Card>
    );
  }
  if (taskQuery.error) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            title="Zadatak nije dostupan"
            description={
              taskQuery.error instanceof ApiError ? taskQuery.error.message : 'Greška pri učitavanju zadatka.'
            }
          />
          <Link className="mt-3 inline-block text-sm text-primary underline" to="/zadaci">
            Nazad na zadatke
          </Link>
        </CardContent>
      </Card>
    );
  }

  const task = taskQuery.data;
  if (!task) return null;
  const mayClaim = hasPermission('task:claim') && task.status === 'OPEN';
  const mayComplete =
    (hasPermission('task:complete') || hasPermission('task:complete_override')) &&
    task.status === 'IN_PROGRESS';
  const mayComment = hasPermission('task:comment');

  return (
    <main className="vfm-module-page">
      <header className="space-y-2">
        <Link className="text-sm text-primary underline" to="/zadaci">
          ← Zadaci
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-fg-muted">{task.code}</p>
            <h1 className="vfm-module-title">{task.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge value={task.status} domain="taskStatus" />
            <StatusBadge value={task.priority} domain="taskPriority" />
          </div>
        </div>
      </header>

      {message && (
        <p role="status" className="rounded-md bg-surface px-3 py-2 text-sm">
          {message}
        </p>
      )}
      {claimError && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {claimError}
        </p>
      )}

      {mayComplete && (
        <TaskCompletionForm
          key={`${task.id}-${task.version}`}
          task={task}
          onCompleted={() => setMessage('Zadatak je završen.')}
        />
      )}
      <TaskStatusActions
        task={task}
        canCancel={hasPermission('task:cancel')}
        canRelease={hasPermission('task:release')}
        canReopen={hasPermission('task:reopen')}
      />

      {mayClaim && (
        <Card>
          <CardContent>
            <Button
              className="min-h-11 w-full sm:w-auto"
              loading={claimMutation.isPending}
              onClick={() => claimMutation.mutate()}
            >
              Preuzmi zadatak
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader title="Detalji" description={task.taskTypeName} />
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-fg-muted">Vozilo</dt>
              <dd className="mt-1 text-sm">
                {[task.vehicleInternalNo, task.vehicleMake, task.vehicleModel].filter(Boolean).join(' · ') ||
                  'Bez vozila'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Rok</dt>
              <dd className="mt-1 text-sm">{dateTime(task.dueAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Kreirao</dt>
              <dd className="mt-1 text-sm">{task.createdByName}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Izvršilac</dt>
              <dd className="mt-1 text-sm">{task.assigneeName ?? 'Nije preuzet'}</dd>
            </div>
          </dl>
          {task.description && <p className="mt-4 whitespace-pre-wrap text-sm">{task.description}</p>}
        </CardContent>
      </Card>

      {Object.keys(task.formData).length > 0 && (
        <Card>
          <CardHeader title="Podaci forme" description={`Snapshot forme v${task.formSchemaVersion}`} />
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              {Object.entries(task.formData).map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="text-xs text-fg-muted">{key}</dt>
                  <dd className="mt-1 break-words text-sm">{valueText(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader title="Učesnici" description="Aktivne i ranije dodjele" />
        <CardContent>
          {task.assignments.length === 0 ? (
            <p className="text-sm text-fg-muted">Nema evidentiranih dodjela.</p>
          ) : (
            <ul className="space-y-2">
              {task.assignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0"
                >
                  <span className="text-sm">{assignment.userName}</span>
                  <span className="flex items-center gap-2">
                    <Badge>{statusLabel(assignment.role, 'taskAssignmentRole')}</Badge>
                    {assignment.revokedAt && <Badge level="neutral">Opozvano</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Historija" description={`${task.events.length} događaja`} />
        <CardContent>
          {task.events.length === 0 ? (
            <p className="text-sm text-fg-muted">Nema događaja.</p>
          ) : (
            <ol className="space-y-3">
              {task.events.map((event) => (
                <li key={event.id} className="border-l-2 border-border pl-3">
                  <p className="text-sm font-medium">{statusLabel(event.action, 'taskEvent')}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {event.actorName ?? 'Sistem'} · {dateTime(event.at)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Komentari"
          description={`${commentsQuery.data?.total ?? task.commentCount} komentara`}
        />
        <CardContent>
          {mayComment && (
            <form
              className="mb-4 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const body = comment.trim();
                if (body) commentMutation.mutate(body);
              }}
            >
              <Field label="Novi komentar" htmlFor="task-comment">
                <textarea
                  id="task-comment"
                  className={`${inputClassName} min-h-24`}
                  maxLength={2000}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Unesite komentar…"
                />
              </Field>
              <Button
                type="submit"
                variant="secondary"
                disabled={!comment.trim()}
                loading={commentMutation.isPending}
              >
                Dodaj komentar
              </Button>
            </form>
          )}
          {commentsQuery.isPending ? (
            <p className="text-sm text-fg-muted">Učitavanje komentara…</p>
          ) : commentsQuery.error ? (
            <p role="alert" className="text-sm text-danger">
              {commentsQuery.error instanceof ApiError
                ? commentsQuery.error.message
                : 'Greška pri učitavanju komentara.'}
            </p>
          ) : (commentsQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-fg-muted">Još nema komentara.</p>
          ) : (
            <ul className="space-y-3">
              {commentsQuery.data!.items.map((item) => (
                <li key={item.id} className="rounded-md bg-surface-muted p-3">
                  <p className="whitespace-pre-wrap text-sm">{item.body}</p>
                  <p className="mt-2 text-xs text-fg-muted">
                    {item.authorName} · {dateTime(item.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
