/** Kreiranje i izmjena vrste zadatka kroz stroge `task_type:*` ugovore. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TASK_ASSIGN_MODES, TASK_PRIORITIES, statusLabel } from '@vfm/shared';
import type { FormSchemaSummary, TaskTypeDetail } from '@vfm/shared/schemas';
import { Button, Card, CardContent, CardHeader, Field, inputClassName } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import {
  DEFAULT_TASK_TYPE_FORM_VALUES,
  availableTaskForms,
  buildTaskTypeCreatePayload,
  buildTaskTypeUpdatePayload,
  taskTypeFormValues,
  type TaskTypeFormValues,
} from './task-types-model.js';

function ApiErrorDetails(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const errors: Record<string, string> = {};
  for (const detail of error.details ?? []) {
    const path = detail.path.join('.');
    if (path) errors[path] = detail.message;
  }
  return errors;
}

function useTaskForms(taskTypeId?: string) {
  const query = useQuery({
    queryKey: ['form-schemas', 'TASK', 'PUBLISHED'],
    queryFn: () => api.get<FormSchemaSummary[]>('/form-schemas?subject=TASK&status=PUBLISHED'),
    retry: false,
  });
  const forms = useMemo(() => availableTaskForms(query.data ?? [], taskTypeId), [query.data, taskTypeId]);
  return { query, forms };
}

function TaskTypeFields({
  values,
  detail,
  forms,
  formSelectionAvailable,
  formSelectionHint,
  errors,
  disabled,
  idPrefix,
  onChange,
}: {
  values: TaskTypeFormValues;
  detail?: TaskTypeDetail;
  forms: readonly FormSchemaSummary[];
  formSelectionAvailable: boolean;
  formSelectionHint: string;
  errors: Record<string, string>;
  disabled: boolean;
  idPrefix: string;
  onChange: (key: keyof TaskTypeFormValues, value: string | boolean) => void;
}) {
  const currentFormInOptions = forms.some((form) => form.id === values.formSchemaId);
  const colorValid = /^#[0-9A-Fa-f]{6}$/u.test(values.colorHex.trim());
  const textProps = (key: keyof TaskTypeFormValues) => ({
    value: String(values[key]),
    disabled,
    'aria-invalid': errors[key] ? (true as const) : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange(key, event.target.value),
  });
  const checkProps = (key: keyof TaskTypeFormValues) => ({
    checked: Boolean(values[key]),
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(key, event.target.checked),
  });

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field
          label="Kod vrste"
          htmlFor={`${idPrefix}-code`}
          hint={
            detail
              ? 'Kod je nepromjenjiv nakon kreiranja.'
              : 'Npr. FUEL_REFILL; samo velika slova, brojevi i _.'
          }
          error={errors.code ?? null}
        >
          <input
            id={`${idPrefix}-code`}
            className={`${inputClassName} font-mono uppercase`}
            autoComplete="off"
            readOnly={Boolean(detail)}
            {...textProps('code')}
          />
        </Field>

        <Field label="Naziv vrste" htmlFor={`${idPrefix}-name`} error={errors.name ?? null}>
          <input
            id={`${idPrefix}-name`}
            className={inputClassName}
            autoComplete="off"
            {...textProps('name')}
          />
        </Field>

        <Field
          label="Zadana objavljena TASK forma"
          htmlFor={`${idPrefix}-form`}
          hint={formSelectionHint}
          error={errors.formSchemaId ?? null}
        >
          <select
            id={`${idPrefix}-form`}
            className={inputClassName}
            disabled={disabled || !formSelectionAvailable}
            value={values.formSchemaId}
            aria-invalid={errors.formSchemaId ? true : undefined}
            onChange={(event) => onChange('formSchemaId', event.target.value)}
          >
            <option value="">Bez zadane forme</option>
            {detail?.formSchemaId && !currentFormInOptions ? (
              <option value={detail.formSchemaId}>
                {detail.formSchemaName ?? detail.formSchemaKey ?? 'Trenutna forma'} (trenutna)
              </option>
            ) : null}
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.name} · {form.key}
                {form.currentPublishedVersion ? ` · v${form.currentPublishedVersion}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Ikona (ključ)"
          htmlFor={`${idPrefix}-icon`}
          hint="Interni naziv ikone za web i mobilnu aplikaciju."
          error={errors.iconName ?? null}
        >
          <input
            id={`${idPrefix}-icon`}
            className={inputClassName}
            autoComplete="off"
            {...textProps('iconName')}
          />
        </Field>

        <Field
          label="Boja"
          htmlFor={`${idPrefix}-color`}
          hint="Format #RRGGBB; prazno znači bez boje."
          error={errors.colorHex ?? null}
        >
          <div className="flex gap-2">
            <input
              id={`${idPrefix}-color`}
              className={`${inputClassName} font-mono uppercase`}
              autoComplete="off"
              {...textProps('colorHex')}
            />
            <input
              aria-label="Odaberi boju vrste zadatka"
              type="color"
              className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] p-1"
              value={
                colorValid
                  ? values.colorHex.trim()
                  : getComputedStyle(document.documentElement).getPropertyValue('--neutral').trim()
              }
              disabled={disabled}
              onChange={(event) => onChange('colorHex', event.target.value.toUpperCase())}
            />
          </div>
        </Field>

        <Field label="Redoslijed prikaza" htmlFor={`${idPrefix}-sort`} error={errors.sortOrder ?? null}>
          <input
            id={`${idPrefix}-sort`}
            className={inputClassName}
            inputMode="numeric"
            autoComplete="off"
            {...textProps('sortOrder')}
          />
        </Field>
      </div>

      <Field label="Opis" htmlFor={`${idPrefix}-description`} error={errors.description ?? null}>
        <textarea
          id={`${idPrefix}-description`}
          className={`${inputClassName} h-auto min-h-20 py-2`}
          rows={3}
          value={values.description}
          aria-invalid={errors.description ? true : undefined}
          onChange={(event) => onChange('description', event.target.value)}
        />
      </Field>

      <section className="rounded-md border border-[var(--border)] p-3">
        <h3 className="mb-3 text-sm font-medium">Zadane postavke zadatka</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field
            label="Zadani prioritet"
            htmlFor={`${idPrefix}-priority`}
            error={errors.defaultPriority ?? null}
          >
            <select id={`${idPrefix}-priority`} className={inputClassName} {...textProps('defaultPriority')}>
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {statusLabel(priority, 'taskPriority')}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Zadani način dodjele"
            htmlFor={`${idPrefix}-assign-mode`}
            error={errors.defaultAssignMode ?? null}
          >
            <select
              id={`${idPrefix}-assign-mode`}
              className={inputClassName}
              {...textProps('defaultAssignMode')}
            >
              {TASK_ASSIGN_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {statusLabel(mode, 'taskAssignMode')}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Rok od kreiranja (sati)"
            htmlFor={`${idPrefix}-due`}
            hint="Prazno znači da vrsta ne postavlja zadani rok."
            error={errors.dueOffsetHours ?? null}
          >
            <input
              id={`${idPrefix}-due`}
              className={inputClassName}
              inputMode="numeric"
              autoComplete="off"
              {...textProps('dueOffsetHours')}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <label className="flex items-start gap-2 rounded-md bg-[var(--surface-muted)] p-2.5">
            <input className="mt-0.5" type="checkbox" {...checkProps('requiresVehicle')} />
            <span>
              <span className="font-medium">Zahtijeva vozilo</span>
              <span className="block text-xs text-[var(--fg-muted)]">
                Zadatak ove vrste mora imati odabrano vozilo.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md bg-[var(--surface-muted)] p-2.5">
            <input className="mt-0.5" type="checkbox" {...checkProps('requiresOdometer')} />
            <span>
              <span className="font-medium">Zahtijeva kilometražu</span>
              <span className="block text-xs text-[var(--fg-muted)]">
                Moguće samo kad vrsta zahtijeva vozilo.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md bg-[var(--surface-muted)] p-2.5">
            <input className="mt-0.5" type="checkbox" {...checkProps('requiresPhotos')} />
            <span>
              <span className="font-medium">Zahtijeva fotografije</span>
              <span className="block text-xs text-[var(--fg-muted)]">
                Globalni uslov vrste; detalji su u zahtjevima završetka.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md bg-[var(--surface-muted)] p-2.5">
            <input className="mt-0.5" type="checkbox" {...checkProps('allowMultipleClaimants')} />
            <span>
              <span className="font-medium">Dozvoli više izvršilaca</span>
              <span className="block text-xs text-[var(--fg-muted)]">
                Poštuje se kad zadaci počnu koristiti preuzimanje.
              </span>
            </span>
          </label>
        </div>
      </section>
    </fieldset>
  );
}

export function TaskTypeCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (created: TaskTypeDetail) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<TaskTypeFormValues>(DEFAULT_TASK_TYPE_FORM_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const { query: formsQuery, forms } = useTaskForms();
  const formSelectionAvailable = formsQuery.isSuccess;

  const save = useMutation({
    mutationFn: () =>
      api.post<TaskTypeDetail>('/task-types', buildTaskTypeCreatePayload(values, formSelectionAvailable)),
    onSuccess: onCreated,
    onError: (error) => {
      setErrors(ApiErrorDetails(error));
      setMessage(error instanceof Error ? error.message : 'Snimanje nije uspjelo.');
    },
  });

  const change = (key: keyof TaskTypeFormValues, value: string | boolean) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        setMessage('');
        save.mutate();
      }}
    >
      <TaskTypeFields
        values={values}
        forms={forms}
        formSelectionAvailable={formSelectionAvailable}
        formSelectionHint={
          formsQuery.isPending
            ? 'Učitavanje objavljenih TASK formi…'
            : formsQuery.isError
              ? 'Lista formi nije dostupna; vrsta će se kreirati bez zadane forme.'
              : 'Generička ili forma vezana za ovu vrstu; API provjerava objavljenu verziju.'
        }
        errors={errors}
        disabled={save.isPending}
        idPrefix="vrsta-zadatka-nova"
        onChange={change}
      />

      {message && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Sačuvaj vrstu
        </Button>
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>
          Odustani
        </Button>
      </div>
    </form>
  );
}

export function TaskTypeEditPanel({
  taskTypeId,
  onClose,
  onSaved,
}: {
  taskTypeId: string;
  onClose: () => void;
  onSaved: (updated: TaskTypeDetail) => Promise<void>;
}) {
  const detailQuery = useQuery({
    queryKey: ['task-type', taskTypeId],
    queryFn: () => api.get<TaskTypeDetail>(`/task-types/${taskTypeId}`),
    retry: false,
  });

  if (detailQuery.isPending) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--fg-muted)]" role="status">Učitavanje vrste zadatka…</p>
        </CardContent>
      </Card>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <Card>
        <CardHeader title="Izmjena vrste zadatka" />
        <CardContent>
          <div className="space-y-3">
            <p role="alert" className="text-sm text-[var(--danger)]">
              {detailQuery.error instanceof ApiError
                ? detailQuery.error.message
                : 'Vrstu zadatka nije moguće učitati.'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void detailQuery.refetch()}>
                Pokušaj ponovo
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Zatvori
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TaskTypeEditForm
      key={detailQuery.data.id}
      detail={detailQuery.data}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function TaskTypeEditForm({
  detail,
  onClose,
  onSaved,
}: {
  detail: TaskTypeDetail;
  onClose: () => void;
  onSaved: (updated: TaskTypeDetail) => Promise<void>;
}) {
  // Snapshot sprečava da pozadinsko osvježavanje tiho prepiše korisnikov unos.
  const [original] = useState(detail);
  const [values, setValues] = useState<TaskTypeFormValues>(() => taskTypeFormValues(original));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const { query: formsQuery, forms } = useTaskForms(original.id);
  const formSelectionAvailable = formsQuery.isSuccess;

  const save = useMutation({
    mutationFn: () =>
      api.patch<TaskTypeDetail>(
        `/task-types/${original.id}`,
        buildTaskTypeUpdatePayload(original, values, formSelectionAvailable),
      ),
    onSuccess: onSaved,
    onError: (error) => {
      setErrors(ApiErrorDetails(error));
      setMessage(error instanceof Error ? error.message : 'Snimanje nije uspjelo.');
    },
  });

  const change = (key: keyof TaskTypeFormValues, value: string | boolean) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  return (
    <Card>
      <CardHeader
        title={`Izmjena vrste ${original.code}`}
        description="Kod i historija postojećih zadataka se ne mijenjaju. Zahtjevi završetka uređuju se zasebno."
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});
            setMessage('');
            save.mutate();
          }}
        >
          <TaskTypeFields
            values={values}
            detail={original}
            forms={forms}
            formSelectionAvailable={formSelectionAvailable}
            formSelectionHint={
              formsQuery.isPending
                ? 'Učitavanje objavljenih TASK formi…'
                : formsQuery.isError
                  ? 'Lista formi nije dostupna; trenutna veza ostaje nepromijenjena.'
                  : 'Promjena forme mora ostati kompatibilna s postojećim zahtjevima završetka.'
            }
            errors={errors}
            disabled={save.isPending}
            idPrefix="vrsta-zadatka-izmjena"
            onChange={change}
          />

          {message && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={save.isPending}>
              Sačuvaj izmjene
            </Button>
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
              Odustani
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
