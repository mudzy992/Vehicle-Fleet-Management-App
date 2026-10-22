import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { TASK_ASSIGN_MODES, TASK_PRIORITIES, type TaskAssignMode } from '@vfm/shared';
import type {
  FormSchemaSummary,
  FormVersionDetail,
  TaskDetail,
  TaskTypeListResponse,
  UserListResponse,
  VehicleListResponse,
} from '@vfm/shared/schemas';
import { parseDefinition } from '@vfm/form-engine';
import type { RenderModel } from '@vfm/form-renderer';
import { buildRenderModel } from '@vfm/form-renderer';
import { Button, Card, CardContent, CardHeader, EmptyState, Field, inputClassName } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { FormFields } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { toQueryString } from '../vehicles/vehicles-model.js';
import { effectiveTaskForm } from '../task-types/task-types-model.js';
import { useSession } from '../auth/session.js';

const PAGE_SIZE = 100;
const PRIORITY_LABELS: Record<(typeof TASK_PRIORITIES)[number], string> = {
  LOW: 'Niska', NORMAL: 'Normalna', HIGH: 'Visoka', URGENT: 'Hitna',
};

export function TaskCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useSession();
  const canViewUsers = hasPermission('user:view');
  const [step, setStep] = useState(1);
  const [taskTypeId, setTaskTypeId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<(typeof TASK_PRIORITIES)[number]>('NORMAL');
  const [dueLocal, setDueLocal] = useState('');
  const [assignMode, setAssignMode] = useState<TaskAssignMode>('OPEN_CLAIM');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [invitedUserIds, setInvitedUserIds] = useState<string[]>([]);
  const [observerUserIds, setObserverUserIds] = useState<string[]>([]);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const today = useMemo(() => sarajevoToday(), []);

  const typesQuery = useQuery({
    queryKey: ['task-types', 'create-options'],
    queryFn: () => api.get<TaskTypeListResponse>(`/task-types?${toQueryString({ page: 1, pageSize: PAGE_SIZE, activeOnly: true })}`),
    retry: false,
  });
  const vehiclesQuery = useQuery({
    queryKey: ['vehicles', 'task-create-options'],
    queryFn: () => api.get<VehicleListResponse>(`/vehicles?${toQueryString({ page: 1, pageSize: PAGE_SIZE, status: 'ACTIVE' })}`),
    retry: false,
  });
  const usersQuery = useQuery({
    queryKey: ['users', 'task-create-options'],
    queryFn: () => api.get<UserListResponse>(`/users?${toQueryString({ page: 1, pageSize: PAGE_SIZE, status: 'ACTIVE' })}`),
    enabled: canViewUsers,
    retry: false,
  });
  const formsQuery = useQuery({
    queryKey: ['form-schemas', 'TASK', 'PUBLISHED'],
    queryFn: () => api.get<FormSchemaSummary[]>('/form-schemas?subject=TASK&status=PUBLISHED'),
    retry: false,
  });

  const selectedType = typesQuery.data?.items.find((item) => item.id === taskTypeId) ?? null;
  const effectiveForm = useMemo(
    () => selectedType ? effectiveTaskForm(formsQuery.data ?? [], selectedType) : null,
    [formsQuery.data, selectedType],
  );
  const versionQuery = useQuery({
    queryKey: ['form-version', effectiveForm?.id, effectiveForm?.currentPublishedVersionId],
    queryFn: () => api.get<FormVersionDetail>(`/form-schemas/${effectiveForm!.id}/versions/${effectiveForm!.currentPublishedVersionId}`),
    enabled: Boolean(effectiveForm?.currentPublishedVersionId),
    retry: false,
  });
  const parsed = useMemo(
    () => versionQuery.data ? parseDefinition(versionQuery.data.definition) : null,
    [versionQuery.data],
  );
  const model = useMemo<RenderModel | null>(() => {
    if (!parsed?.ok || !versionQuery.data) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values: formData,
      today,
      version: versionQuery.data.version,
      formSchemaVersionId: versionQuery.data.id,
    });
  }, [parsed, versionQuery.data, formData, today]);

  const create = useMutation({
    mutationFn: () => {
      if (!selectedType || !effectiveForm || !versionQuery.data) throw new Error('Nedostaje objavljena TASK forma.');
      return api.post<TaskDetail>('/tasks', {
        taskTypeId: selectedType.id,
        vehicleId: vehicleId || null,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        priority,
        assignMode,
        ...(assignMode === 'ASSIGN_DIRECT' ? { assigneeUserId } : {}),
        ...(assignMode === 'OPEN_CLAIM' ? { invitedUserIds } : {}),
        observerUserIds,
        ...(dueLocal ? { dueAt: new Date(dueLocal).toISOString() } : {}),
        formData,
      });
    },
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await navigate(`/zadaci/${task.id}`);
    },
    onError: (error) => {
      setMessage(error instanceof ApiError ? error.message : 'Kreiranje zadatka nije uspjelo.');
      const next: Record<string, string> = {};
      if (error instanceof ApiError) {
        for (const detail of error.details ?? []) {
          const path = detail.path.join('.');
          next[path.startsWith('formData.') ? path.slice('formData.'.length) : path] = detail.message;
        }
      }
      setErrors(next);
    },
  });

  if (typesQuery.isPending) return <p className="text-sm text-[var(--fg-muted)]">Učitavanje vrsta zadataka…</p>;
  if (typesQuery.error) return <EmptyState title="Vrste zadataka nisu dostupne" description={typesQuery.error instanceof ApiError ? typesQuery.error.message : 'Greška pri učitavanju vrsta.'} />;
  const types = typesQuery.data?.items ?? [];
  if (types.length === 0) return <EmptyState title="Nema aktivnih vrsta" description="Prije kreiranja zadatka potrebno je aktivirati barem jednu vrstu zadatka." />;

  const vehicleItems = vehiclesQuery.data?.items ?? [];
  const users = usersQuery.data?.items ?? [];
  const nextStep = () => {
    setMessage(null);
    if (step === 1) {
      if (!selectedType) { setMessage('Odaberite vrstu zadatka.'); return; }
      if (selectedType.requiresVehicle && !vehicleId) { setMessage('Odabrana vrsta zahtijeva vozilo.'); return; }
      setPriority(selectedType.defaultPriority);
      setAssignMode(selectedType.defaultAssignMode);
      setAssigneeUserId('');
      setInvitedUserIds([]);
    }
    if (step === 2 && assignMode === 'ASSIGN_DIRECT' && !assigneeUserId) {
      setMessage('Odaberite direktnog izvršioca ili promijenite način dodjele.');
      return;
    }
    if (step === 2 && assignMode === 'ASSIGN_DIRECT' && !canViewUsers) {
      setMessage('Za odabir izvršioca potrebna je permisija user:view. Odaberite OPEN_CLAIM ili BROADCAST.');
      return;
    }
    setStep((current) => Math.min(3, current + 1));
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <Link className="text-sm text-[var(--primary)] underline" to="/zadaci">← Zadaci</Link>
        <h1 className="text-xl font-semibold">Novi zadatak</h1>
        <p className="text-sm text-[var(--fg-muted)]">Korak {step} od 3</p>
      </header>
      <div className="flex gap-2" aria-label="Napredak">
        {[1, 2, 3].map((number) => <span key={number} className={`h-1.5 flex-1 rounded ${number <= step ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`} />)}
      </div>
      {message && <p role="alert" className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{message}</p>}

      {step === 1 && (
        <Card>
          <CardHeader title="Vrsta i vozilo" description="Odaberite aktivnu vrstu; zahtjev za vozilom određuje konfiguracija vrste." />
          <CardContent className="space-y-4">
            <Field label="Vrsta zadatka *" htmlFor="task-create-type">
              <select id="task-create-type" className={inputClassName} value={taskTypeId} onChange={(event) => { setTaskTypeId(event.target.value); setFormData({}); }}>
                <option value="">Odaberite…</option>
                {types.map((type) => <option key={type.id} value={type.id}>{type.code} · {type.name}</option>)}
              </select>
            </Field>
            {selectedType?.requiresVehicle && vehiclesQuery.isPending ? <p className="text-sm text-[var(--fg-muted)]">Učitavanje vozila…</p> : null}
            {selectedType?.requiresVehicle && vehiclesQuery.error ? <p role="alert" className="text-sm text-[var(--danger)]">{vehiclesQuery.error instanceof ApiError ? vehiclesQuery.error.message : 'Vozila nije moguće učitati.'}</p> : null}
            {selectedType?.requiresVehicle && !vehiclesQuery.error && !vehiclesQuery.isPending && (
              <Field label="Vozilo *" htmlFor="task-create-vehicle">
                <select id="task-create-vehicle" className={inputClassName} value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
                  <option value="">Odaberite vozilo…</option>
                  {vehicleItems.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.internalNo} · {vehicle.make} {vehicle.model}{vehicle.plateNumber ? ` · ${vehicle.plateNumber}` : ''}</option>)}
                </select>
              </Field>
            )}
            {selectedType && <p className="text-xs text-[var(--fg-muted)]">{selectedType.requiresOdometer ? 'Pri završetku će se tražiti kilometraža.' : ''}{selectedType.requiresPhotos ? ' Za ovu vrstu su obavezne fotografije.' : ''}</p>}
          </CardContent>
        </Card>
      )}

      {step === 2 && selectedType && (
        <Card>
          <CardHeader title="Opis i rok" description="Osnovni podaci zadatka; obavezna polja dinamičke forme dolaze u sljedećem koraku." />
          <CardContent className="space-y-4">
            <Field label="Naslov" htmlFor="task-create-title" hint="Ako ostavite prazno, naslov se preuzima iz vrste zadatka.">
              <input id="task-create-title" className={inputClassName} minLength={2} maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Opis" htmlFor="task-create-description">
              <textarea id="task-create-description" className={`${inputClassName} min-h-24`} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
            </Field>
            <Field label="Prioritet" htmlFor="task-create-priority">
              <select id="task-create-priority" className={inputClassName} value={priority} onChange={(event) => setPriority(event.target.value as (typeof TASK_PRIORITIES)[number])}>
                {TASK_PRIORITIES.map((value) => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}
              </select>
            </Field>
            <Field label="Rok (opciono)" htmlFor="task-create-due">
              <input id="task-create-due" className={inputClassName} type="datetime-local" value={dueLocal} onChange={(event) => setDueLocal(event.target.value)} />
            </Field>
            <Field label="Način dodjele" htmlFor="task-create-assign-mode">
              <select id="task-create-assign-mode" className={inputClassName} value={assignMode} onChange={(event) => { setAssignMode(event.target.value as TaskAssignMode); setAssigneeUserId(''); setInvitedUserIds([]); }}>
                {TASK_ASSIGN_MODES.map((mode) => <option key={mode} value={mode}>{mode === 'OPEN_CLAIM' ? 'Slobodno preuzimanje' : mode === 'ASSIGN_DIRECT' ? 'Direktna dodjela' : 'Broadcast'}</option>)}
              </select>
            </Field>
            {assignMode === 'ASSIGN_DIRECT' && (
              <Field label="Direktni izvršilac *" htmlFor="task-create-assignee">
                {canViewUsers ? <select id="task-create-assignee" className={inputClassName} value={assigneeUserId} onChange={(event) => { setAssigneeUserId(event.target.value); setObserverUserIds((current) => current.filter((id) => id !== event.target.value)); }}>
                  <option value="">Odaberite izvršioca…</option>
                  {users.map((user) => <option key={user.id} value={user.id} disabled={observerUserIds.includes(user.id)}>{user.displayName || `${user.firstName} ${user.lastName}`} · {user.email}</option>)}
                </select> : <p className="text-sm text-[var(--danger)]">Za direktnu dodjelu potrebna je permisija user:view.</p>}
                {usersQuery.error && <span className="text-xs text-[var(--danger)]">{usersQuery.error instanceof ApiError ? usersQuery.error.message : 'Korisnici nisu dostupni.'}</span>}
              </Field>
            )}
            {assignMode === 'OPEN_CLAIM' && canViewUsers && (
              <Field label="Pozvani korisnici (opciono)" htmlFor="task-create-invited" hint="Pozvani korisnici mogu preuzeti zadatak prije ostalih.">
                <select id="task-create-invited" className={`${inputClassName} min-h-24`} multiple value={invitedUserIds} onChange={(event) => { const selected = Array.from(event.currentTarget.selectedOptions, (option) => option.value); setInvitedUserIds(selected); setObserverUserIds((current) => current.filter((id) => !selected.includes(id))); }}>
                  {users.map((user) => <option key={user.id} value={user.id} disabled={observerUserIds.includes(user.id)}>{user.displayName || `${user.firstName} ${user.lastName}`}</option>)}
                </select>
              </Field>
            )}
            {canViewUsers && (
              <Field label="Posmatrači (opciono)" htmlFor="task-create-observers" hint="Držite Ctrl/Cmd za višestruki izbor.">
                <select id="task-create-observers" className={`${inputClassName} min-h-24`} multiple value={observerUserIds} onChange={(event) => setObserverUserIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
                  {users.map((user) => <option key={user.id} value={user.id} disabled={invitedUserIds.includes(user.id) || user.id === assigneeUserId}>{user.displayName || `${user.firstName} ${user.lastName}`}</option>)}
                </select>
              </Field>
            )}
            {selectedType.dueOffsetHours && <p className="text-xs text-[var(--fg-muted)]">Vrsta predlaže rok za {selectedType.dueOffsetHours} sati; unesite tačan rok po potrebi.</p>}
          </CardContent>
        </Card>
      )}

      {step === 3 && selectedType && (
        <Card>
          <CardHeader title="Forma i potvrda" description="Server ponovo validira sva polja prema snapshotovanoj objavljenoj verziji." />
          <CardContent className="space-y-4">
            {formsQuery.isPending || (effectiveForm && versionQuery.isPending) ? <p className="text-sm text-[var(--fg-muted)]">Učitavanje objavljene TASK forme…</p> : null}
            {formsQuery.error || versionQuery.error ? <p role="alert" className="text-sm text-[var(--danger)]">{(formsQuery.error ?? versionQuery.error) instanceof ApiError ? (formsQuery.error ?? versionQuery.error as ApiError).message : 'TASK forma nije dostupna.'}</p> : null}
            {!effectiveForm && !formsQuery.isPending && <p role="alert" className="text-sm text-[var(--danger)]">Vrsta nema efektivnu objavljenu TASK formu. Zadatak se ne može kreirati.</p>}
            {model && versionQuery.data && <><p className="text-sm text-[var(--fg-muted)]">{effectiveForm?.name} · v{versionQuery.data.version}</p><FormFields model={model} errors={errors} idPrefix="task-create" onChange={(key, value) => setFormData((current) => ({ ...current, [key]: value }))} /></>}
            <div className="rounded-md bg-[var(--surface-muted)] p-3 text-sm">
              <p><strong>{title.trim() || selectedType.name}</strong> · {PRIORITY_LABELS[priority]} · {assignMode === 'OPEN_CLAIM' ? 'Slobodno preuzimanje' : assignMode === 'ASSIGN_DIRECT' ? 'Direktna dodjela' : 'Broadcast'}</p>
              <p className="text-[var(--fg-muted)]">{vehicleItems.find((item) => item.id === vehicleId)?.internalNo ?? 'Bez vozila'} · {dueLocal ? new Date(dueLocal).toLocaleString('bs-BA') : 'Bez roka'}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" disabled={step === 1 || create.isPending} onClick={() => { setMessage(null); setStep((current) => current - 1); }}>Nazad</Button>
        {step < 3 ? <Button onClick={nextStep}>Nastavi</Button> : <Button loading={create.isPending} disabled={!effectiveForm || !model || formsQuery.isPending || versionQuery.isPending || Boolean(versionQuery.error)} onClick={() => { setMessage(null); setErrors({}); create.mutate(); }}>Kreiraj zadatak</Button>}
      </div>
    </main>
  );
}
