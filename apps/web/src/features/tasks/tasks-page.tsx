import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { statusLabel } from '@vfm/shared';
import type { TaskListResponse, TaskView } from '@vfm/shared/schemas';
import { Badge, Button, Card, CardContent, EmptyState, StatusBadge } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { taskCountLabel, taskDateTime, taskListPath, type TaskListTab } from './tasks-model.js';

const TAB_LABELS: Readonly<Record<TaskListTab, string>> = {
  available: 'Slobodni',
  mine: 'Moji',
  all: 'Svi',
};

function TaskCard({
  task,
  canClaim,
  claiming,
  onClaim,
}: {
  task: TaskView;
  canClaim: boolean;
  claiming: boolean;
  onClaim: (task: TaskView) => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{task.title}</h2>
            <StatusBadge value={task.status} domain="taskStatus" />
          </div>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {task.vehicleInternalNo ? `${task.vehicleInternalNo} · ` : ''}
            {[task.vehicleMake, task.vehicleModel].filter(Boolean).join(' ') || task.taskTypeName}
          </p>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            {task.code} · Rok: {taskDateTime(task.dueAt)} · {statusLabel(task.priority, 'taskPriority')}
          </p>
        </div>
        {task.assigneeName && <Badge level="warning">{task.assigneeName}</Badge>}
      </div>
      {task.description && <p className="mt-3 line-clamp-2 text-sm">{task.description}</p>}
      {canClaim && (
        <div className="mt-4">
          <Button
            className="min-h-11 w-full sm:w-auto"
            loading={claiming}
            disabled={claiming}
            onClick={() => onClaim(task)}
          >
            Preuzmi
          </Button>
        </div>
      )}
    </Card>
  );
}

export function TasksPage() {
  const { hasPermission, status } = useSession();
  const canClaim = hasPermission('task:claim');
  const tabs: TaskListTab[] = canClaim ? ['available', 'mine', 'all'] : ['mine', 'all'];
  const [tab, setTab] = useState<TaskListTab>('available');
  useEffect(() => {
    if (status === 'authenticated' && !canClaim && tab === 'available') setTab('mine');
  }, [status, canClaim, tab]);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const tasksQuery = useQuery({
    queryKey: ['tasks', tab, page],
    queryFn: () => api.get<TaskListResponse>(taskListPath(tab, page)),
    enabled: status === 'authenticated' && (tab !== 'available' || canClaim),
  });
  const claim = useMutation({
    mutationFn: (task: TaskView) => api.post<TaskView>(`/tasks/${task.id}/claim`),
    onSuccess: async (task) => {
      setMessage(`Preuzeli ste zadatak ${task.code}.`);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: async (cause) => {
      setMessage(
        cause instanceof ApiError
          ? cause.message
          : 'Zadatak nije preuzet. Osvježite listu i pokušajte ponovo.',
      );
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const items = tasksQuery.data?.items ?? [];
  const totalPages = tasksQuery.data?.totalPages ?? 0;

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Zadaci</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {tasksQuery.isPending ? 'Učitavanje…' : taskCountLabel(tasksQuery.data)}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Prikaz zadataka">
        {tabs.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={[
              'min-h-10 rounded-md border px-4 text-sm font-medium transition-colors',
              tab === value
                ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] hover:bg-[var(--surface-hover)]',
            ].join(' ')}
            onClick={() => {
              setTab(value);
              setPage(1);
              setMessage(null);
            }}
          >
            {TAB_LABELS[value]}
          </button>
        ))}
      </div>

      {message && (
        <p role="status" className="rounded-md bg-[var(--surface)] px-3 py-2 text-sm">
          {message}
        </p>
      )}

      {tasksQuery.error && (
        <Card>
          <CardContent>
            <p role="alert" className="text-sm text-[var(--danger)]">
              {tasksQuery.error instanceof ApiError
                ? tasksQuery.error.message
                : 'Greška pri učitavanju zadataka.'}
            </p>
          </CardContent>
        </Card>
      )}

      {tasksQuery.isPending ? (
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--fg-muted)]">Učitavanje zadataka…</p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="Nema zadataka za prikaz"
            description={
              tab === 'available'
                ? 'Trenutno nema zadataka koje možete preuzeti.'
                : 'Promijenite prikaz ili pokušajte kasnije.'
            }
          />
        </Card>
      ) : (
        <section className="space-y-3" aria-label="Lista zadataka">
          {items.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              canClaim={tab === 'available' && canClaim}
              claiming={claim.isPending && claim.variables?.id === task.id}
              onClaim={(selected) => {
                setMessage(null);
                claim.mutate(selected);
              }}
            />
          ))}
        </section>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Paginacija zadataka">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Prethodna
          </Button>
          <span className="text-sm text-[var(--fg-muted)]">
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
      )}
    </main>
  );
}
