import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TaskDetail } from '@vfm/shared/schemas';
import { Button, Card, CardContent, CardHeader, Field, inputClassName } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';

type Action = 'cancel' | 'release' | 'reopen';

export function TaskStatusActions({
  task,
  canCancel,
  canRelease,
  canReopen,
}: {
  task: TaskDetail;
  canCancel: boolean;
  canRelease: boolean;
  canReopen: boolean;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const labels: Record<Action, string> = { cancel: 'Otkaži zadatak', release: 'Vrati među slobodne', reopen: 'Ponovo otvori' };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error('Odaberite akciju.');
      const body = { version: task.version, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      return api.post<TaskDetail>(`/tasks/${task.id}/${action}`, body);
    },
    onSuccess: async () => {
      setSucceeded(true);
      setMessage(action === 'cancel' ? 'Zadatak je otkazan.' : action === 'release' ? 'Zadatak je vraćen među slobodne.' : 'Zadatak je ponovo otvoren.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task', task.id] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
    onError: async (error) => {
      setMessage(error instanceof ApiError ? error.message : 'Promjena statusa nije uspjela. Osvježite zadatak.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task', task.id] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
  });

  const allowed: Action[] = [];
  if (canCancel && ['OPEN', 'IN_PROGRESS'].includes(task.status)) allowed.push('cancel');
  if (canRelease && task.status === 'IN_PROGRESS') allowed.push('release');
  if (canReopen && ['COMPLETED', 'CANCELLED'].includes(task.status)) allowed.push('reopen');
  // Keep the live success announcement mounted after a transition removes the
  // available actions (for example, releasing IN_PROGRESS back to OPEN).
  if (allowed.length === 0 && !message) return null;

  return (
    <Card>
      <CardHeader title="Radnje nad zadatkom" />
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {allowed.map((item) => (
            <Button key={item} variant={item === 'cancel' ? 'danger' : 'secondary'} onClick={() => { setAction(item); setReason(''); setMessage(null); setSucceeded(false); }}>
              {labels[item]}
            </Button>
          ))}
        </div>
        {action && allowed.includes(action) && !succeeded && (
          <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
            <Field label={action === 'cancel' ? 'Razlog otkazivanja *' : 'Razlog (opciono)'} htmlFor="task-status-reason" hint={action === 'cancel' ? 'Unesite najmanje 3 znaka.' : undefined}>
              <textarea id="task-status-reason" className={`${inputClassName} min-h-20`} maxLength={500} required={action === 'cancel'} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant={action === 'cancel' ? 'danger' : 'primary'} disabled={action === 'cancel' && reason.trim().length < 3} loading={mutation.isPending}>Potvrdi: {labels[action]}</Button>
              <Button variant="ghost" disabled={mutation.isPending} onClick={() => setAction(null)}>Odustani</Button>
            </div>
          </form>
        )}
        {message && <p role={mutation.isError ? 'alert' : 'status'} className="mt-3 text-sm">{message}</p>}
      </CardContent>
    </Card>
  );
}
