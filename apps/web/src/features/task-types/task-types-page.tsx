/** Vrste zadataka (W18) — konfiguracija, zahtjevi završetka i arhiva. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { statusLabel } from '@vfm/shared';
import type { TaskTypeListResponse, TaskTypeView } from '@vfm/shared/schemas';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Field,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  inputClassName,
} from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { toQueryString } from '../vehicles/vehicles-model.js';
import { TaskTypeCreateForm, TaskTypeEditPanel } from './task-type-form.js';
import { TaskTypeRequirementsPanel } from './task-type-requirements-panel.js';
import {
  DEFAULT_TASK_TYPE_FILTERS,
  buildTaskTypeQuery,
  isTaskTypeFiltered,
  pageAfterArchive,
  taskTypeArchiveConfirmation,
  taskTypeArchiveSuccess,
  type TaskTypeFilters,
} from './task-types-model.js';

const PAGE_SIZE = 25;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' });
}

export function TaskTypesPage() {
  const { hasPermission } = useSession();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<TaskTypeFilters>(DEFAULT_TASK_TYPE_FILTERS);
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [requirementsFor, setRequirementsFor] = useState<TaskTypeView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useMemo(() => buildTaskTypeQuery(filters, page, PAGE_SIZE), [filters, page]);
  const list = useQuery({
    queryKey: ['task-types', query],
    queryFn: () => api.get<TaskTypeListResponse>(`/task-types?${toQueryString(query)}`),
  });

  const canCreate = hasPermission('task_type:create');
  const canUpdate = hasPermission('task_type:update');
  const canArchive = hasPermission('task_type:archive');
  const filtered = isTaskTypeFiltered(filters);

  const archive = useMutation({
    mutationFn: (row: TaskTypeView) => api.post<void>(`/task-types/${row.id}/archive`, {}),
    onSuccess: async (_data, row) => {
      if (editingId === row.id) setEditingId(null);
      if (requirementsFor?.id === row.id) setRequirementsFor(null);
      setPage((current) => pageAfterArchive(list.data?.items.length ?? 0, current));
      setMessage(taskTypeArchiveSuccess(row));
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task-types'] }),
        queryClient.invalidateQueries({ queryKey: ['task-type', row.id] }),
        queryClient.invalidateQueries({ queryKey: ['task-type-requirements', row.id] }),
      ]);
    },
    onError: (error) =>
      setActionError(error instanceof Error ? error.message : 'Arhiviranje vrste zadatka nije uspjelo.'),
  });

  const updateFilters = (patch: Partial<TaskTypeFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const clearPanels = () => {
    setShowCreate(false);
    setEditingId(null);
    setRequirementsFor(null);
    setMessage(null);
    setActionError(null);
  };

  const requestArchive = (row: TaskTypeView) => {
    setMessage(null);
    setActionError(null);
    if (window.confirm(taskTypeArchiveConfirmation(row))) archive.mutate(row);
  };

  return (
    <div className="vfm-module-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="vfm-module-title">Vrste zadataka</h1>
          <p className="text-sm text-[var(--fg-muted)]">
            {list.isPending ? 'Učitavanje…' : `${list.data?.total ?? 0} vrsta u konfiguraciji`}
          </p>
        </div>
        {canCreate && !showCreate && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              clearPanels();
              setShowCreate(true);
            }}
          >
            Nova vrsta
          </Button>
        )}
      </div>

      {message && (
        <Card>
          <CardContent>
            <p className="text-sm">{message}</p>
          </CardContent>
        </Card>
      )}

      {actionError && (
        <Card>
          <CardContent>
            <p role="alert" className="text-sm text-[var(--danger)]">
              {actionError}
            </p>
          </CardContent>
        </Card>
      )}

      {list.error && (
        <Card>
          <CardContent>
            <p role="alert" className="text-sm text-[var(--danger)]">
              {list.error instanceof ApiError ? list.error.message : 'Greška pri učitavanju vrsta zadataka.'}
            </p>
          </CardContent>
        </Card>
      )}

      {showCreate && canCreate && (
        <Card>
          <CardHeader
            title="Nova vrsta zadatka"
            description="Kod je trajna tehnička oznaka. Zahtjevi završetka dodaju se nakon kreiranja, zasebnom akcijom."
          />
          <CardContent>
            <TaskTypeCreateForm
              onCancel={() => setShowCreate(false)}
              onCreated={async (created) => {
                setShowCreate(false);
                setMessage(`Nova vrsta zadatka ${created.code} je sačuvana.`);
                setActionError(null);
                await queryClient.invalidateQueries({ queryKey: ['task-types'] });
              }}
            />
          </CardContent>
        </Card>
      )}

      {editingId && canUpdate && (
        <TaskTypeEditPanel
          taskTypeId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={async (updated) => {
            setEditingId(null);
            setMessage(`Vrsta zadatka ${updated.code} je izmijenjena.`);
            setActionError(null);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['task-types'] }),
              queryClient.invalidateQueries({ queryKey: ['task-type', updated.id] }),
              queryClient.invalidateQueries({ queryKey: ['task-type-requirements', updated.id] }),
            ]);
          }}
        />
      )}

      {requirementsFor && (
        <TaskTypeRequirementsPanel
          taskType={requirementsFor}
          canUpdate={canUpdate}
          onClose={() => setRequirementsFor(null)}
          onSaved={async (saved) => {
            setMessage(`Zahtjevi završetka za ${requirementsFor.code} su ažurirani.`);
            setActionError(null);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['task-types'] }),
              queryClient.invalidateQueries({ queryKey: ['task-type', saved.taskTypeId] }),
              queryClient.invalidateQueries({ queryKey: ['task-type-requirements', saved.taskTypeId] }),
            ]);
          }}
        />
      )}

      <Card>
        <CardHeader
          title="Filteri"
          description="Arhivirane vrste se ne prikazuju; pretraga i paginacija rade se na serveru."
        />
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Pretraga" htmlFor="vrste-zadataka-q">
              <input
                id="vrste-zadataka-q"
                className={inputClassName}
                placeholder="Kod, naziv ili opis"
                value={filters.q}
                onChange={(event) => updateFilters({ q: event.target.value })}
              />
            </Field>

            <Field label="Vozilo" htmlFor="vrste-zadataka-vozilo">
              <select
                id="vrste-zadataka-vozilo"
                className={inputClassName}
                value={filters.requiresVehicle}
                onChange={(event) =>
                  updateFilters({ requiresVehicle: event.target.value as TaskTypeFilters['requiresVehicle'] })
                }
              >
                <option value="">Sve vrste</option>
                <option value="true">Zahtijevaju vozilo</option>
                <option value="false">Ne zahtijevaju vozilo</option>
              </select>
            </Field>

            <Field label="Sortiranje" htmlFor="vrste-zadataka-sort">
              <select
                id="vrste-zadataka-sort"
                className={inputClassName}
                value={filters.sortBy}
                onChange={(event) => updateFilters({ sortBy: event.target.value })}
              >
                <option value="sortOrder">Redoslijed prikaza</option>
                <option value="name">Naziv</option>
                <option value="code">Kod</option>
                <option value="createdAt">Datum kreiranja</option>
                <option value="updatedAt">Datum posljednje izmjene</option>
              </select>
            </Field>

            <div className="space-y-2 pt-6 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.activeOnly}
                  onChange={(event) => updateFilters({ activeOnly: event.target.checked })}
                />
                Samo aktivne
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.sortOrder === 'desc'}
                  onChange={(event) => updateFilters({ sortOrder: event.target.checked ? 'desc' : 'asc' })}
                />
                Obrnut redoslijed
              </label>
            </div>
          </div>

          {filtered && (
            <Button
              className="mt-3"
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilters(DEFAULT_TASK_TYPE_FILTERS);
                setPage(1);
              }}
            >
              Očisti filtere
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {list.isPending ? (
            <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>
          ) : !list.data?.items.length ? (
            <EmptyState
              title={filtered ? 'Nema vrsta za odabrane filtere' : 'Nema konfigurisanih vrsta zadataka'}
              description={
                filtered
                  ? 'Promijenite pretragu ili filtere.'
                  : canCreate
                    ? 'Pokrenite seed za 8 početnih vrsta ili dodajte novu dugmetom „Nova vrsta“.'
                    : 'Početne vrste dodaje seed, a nove korisnik s pravom task_type:create.'
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Vrsta</TH>
                  <TH>Zadane postavke</TH>
                  <TH>Uslovi</TH>
                  <TH>Forma i zahtjevi</TH>
                  <TH>Status</TH>
                  <TH align="right">Akcije</TH>
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((row) => (
                  <TaskTypeRow
                    key={row.id}
                    row={row}
                    canUpdate={canUpdate}
                    canArchive={canArchive}
                    isEditing={editingId === row.id}
                    isViewingRequirements={requirementsFor?.id === row.id}
                    isArchiving={archive.isPending && archive.variables?.id === row.id}
                    onRequirements={() => {
                      setShowCreate(false);
                      setEditingId(null);
                      setMessage(null);
                      setActionError(null);
                      setRequirementsFor((current) => (current?.id === row.id ? null : row));
                    }}
                    onEdit={() => {
                      setShowCreate(false);
                      setRequirementsFor(null);
                      setMessage(null);
                      setActionError(null);
                      setEditingId((current) => (current === row.id ? null : row.id));
                    }}
                    onArchive={() => requestArchive(row)}
                  />
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(list.data?.totalPages ?? 0) > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Strana {list.data?.page ?? page} / {list.data?.totalPages ?? 1} · {list.data?.total ?? 0} vrsta
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Prethodna
            </Button>
            <Button
              size="sm"
              disabled={page >= (list.data?.totalPages ?? 1)}
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

function TaskTypeRow({
  row,
  canUpdate,
  canArchive,
  isEditing,
  isViewingRequirements,
  isArchiving,
  onRequirements,
  onEdit,
  onArchive,
}: {
  row: TaskTypeView;
  canUpdate: boolean;
  canArchive: boolean;
  isEditing: boolean;
  isViewingRequirements: boolean;
  isArchiving: boolean;
  onRequirements: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const conditions = [
    row.requiresVehicle ? 'Vozilo' : null,
    row.requiresOdometer ? 'Kilometraža' : null,
    row.requiresPhotos ? 'Fotografije' : null,
    row.allowMultipleClaimants ? 'Više izvršilaca' : null,
  ].filter(Boolean) as string[];

  return (
    <TR className={isEditing || isViewingRequirements ? 'bg-[var(--hover)]' : undefined}>
      <TD>
        <div className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 h-3 w-3 shrink-0 rounded-full border border-[var(--border)]"
            style={row.colorHex ? { backgroundColor: row.colorHex } : undefined}
          />
          <div className="min-w-0">
            <p className="font-medium">{row.name}</p>
            <p className="font-mono text-xs text-[var(--fg-muted)]">{row.code}</p>
            <p className="mt-1 max-w-xs text-xs text-[var(--fg-muted)]">{row.description ?? 'Bez opisa'}</p>
          </div>
        </div>
      </TD>
      <TD>
        <StatusBadge value={row.defaultPriority} domain="taskPriority" />
        <p className="mt-1 text-xs">{statusLabel(row.defaultAssignMode, 'taskAssignMode')}</p>
        <p className="text-xs text-[var(--fg-muted)]">
          {row.dueOffsetHours === null ? 'Bez zadanog roka' : `Rok: ${row.dueOffsetHours} h`}
        </p>
      </TD>
      <TD>
        {conditions.length ? (
          <div className="flex max-w-[220px] flex-wrap gap-1">
            {conditions.map((condition) => (
              <Badge key={condition}>{condition}</Badge>
            ))}
          </div>
        ) : (
          <span className="text-[var(--fg-muted)]">Bez posebnih uslova</span>
        )}
      </TD>
      <TD>
        {row.formSchemaId ? (
          <>
            <p>{row.formSchemaName ?? row.formSchemaKey ?? 'Povezana forma'}</p>
            <p className="font-mono text-xs text-[var(--fg-muted)]">
              {row.formSchemaKey ?? '—'}
              {row.formSchemaVersion ? ` · v${row.formSchemaVersion}` : ''}
            </p>
          </>
        ) : (
          <p className="text-[var(--fg-muted)]">Bez zadane forme</p>
        )}
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Zahtjeva završetka: {row.completionRequirementCount}
        </p>
      </TD>
      <TD>
        <Badge level={row.active ? 'success' : 'neutral'} dot>
          {row.active ? 'Aktivna' : 'Neaktivna'}
        </Badge>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">Redoslijed: {row.sortOrder}</p>
        <p className="text-xs text-[var(--fg-muted)]">Izmijenjeno: {formatDateTime(row.updatedAt)}</p>
      </TD>
      <TD align="right">
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Zahtjevi završetka vrste ${row.code}`}
            onClick={onRequirements}
          >
            {isViewingRequirements ? 'Zatvori zahtjeve' : 'Zahtjevi'}
          </Button>
          {canUpdate && (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              {isEditing ? 'Zatvori' : 'Uredi'}
            </Button>
          )}
          {canArchive && (
            <Button
              size="sm"
              variant="danger"
              disabled={isArchiving}
              loading={isArchiving}
              aria-label={`Arhiviraj vrstu ${row.code}`}
              onClick={onArchive}
            >
              Arhiviraj
            </Button>
          )}
        </div>
      </TD>
    </TR>
  );
}
