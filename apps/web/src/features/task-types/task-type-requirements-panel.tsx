/** Zahtjevi završetka po vrsti zadatka — atomska PUT zamjena cijelog skupa. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { inputFields, parseDefinition } from '@vfm/form-engine/definition';
import { ATTACHMENT_STAGES, statusLabel } from '@vfm/shared';
import type {
  FormSchemaSummary,
  FormVersionDetail,
  TaskCompletionRequirementsResponse,
  TaskTypeView,
} from '@vfm/shared/schemas';
import { Button, Card, CardContent, CardHeader, Field, inputClassName } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import {
  buildRequirementsPayload,
  effectiveTaskForm,
  emptyRequirementDraft,
  requirementDrafts,
  type TaskCompletionRequirementDraft,
} from './task-types-model.js';

export function TaskTypeRequirementsPanel({
  taskType,
  canUpdate,
  onClose,
  onSaved,
}: {
  taskType: TaskTypeView;
  canUpdate: boolean;
  onClose: () => void;
  onSaved: (saved: TaskCompletionRequirementsResponse) => Promise<void>;
}) {
  const requirementsQuery = useQuery({
    queryKey: ['task-type-requirements', taskType.id],
    queryFn: () =>
      api.get<TaskCompletionRequirementsResponse>(`/task-types/${taskType.id}/completion-requirements`),
    retry: false,
  });

  if (requirementsQuery.isPending) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--fg-muted)]" role="status">Učitavanje zahtjeva završetka…</p>
        </CardContent>
      </Card>
    );
  }

  if (requirementsQuery.error || !requirementsQuery.data) {
    return (
      <Card>
        <CardHeader title={`Zahtjevi završetka — ${taskType.code}`} />
        <CardContent>
          <div className="space-y-3">
            <p role="alert" className="text-sm text-[var(--danger)]">
              {requirementsQuery.error instanceof ApiError
                ? requirementsQuery.error.message
                : 'Zahtjeve završetka nije moguće učitati.'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void requirementsQuery.refetch()}>
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
    <TaskTypeRequirementsForm
      key={taskType.id}
      taskType={taskType}
      initial={requirementsQuery.data}
      canUpdate={canUpdate}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function TaskTypeRequirementsForm({
  taskType,
  initial,
  canUpdate,
  onClose,
  onSaved,
}: {
  taskType: TaskTypeView;
  initial: TaskCompletionRequirementsResponse;
  canUpdate: boolean;
  onClose: () => void;
  onSaved: (saved: TaskCompletionRequirementsResponse) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<TaskCompletionRequirementDraft[]>(() =>
    requirementDrafts(initial.requirements),
  );
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');

  const formsQuery = useQuery({
    queryKey: ['form-schemas', 'TASK', 'PUBLISHED'],
    queryFn: () => api.get<FormSchemaSummary[]>('/form-schemas?subject=TASK&status=PUBLISHED'),
    retry: false,
  });
  const effectiveForm = useMemo(
    () => effectiveTaskForm(formsQuery.data ?? [], taskType),
    [formsQuery.data, taskType],
  );
  const versionQuery = useQuery({
    queryKey: ['form-version', effectiveForm?.id, effectiveForm?.currentPublishedVersionId],
    queryFn: () =>
      api.get<FormVersionDetail>(
        `/form-schemas/${effectiveForm!.id}/versions/${effectiveForm!.currentPublishedVersionId}`,
      ),
    enabled: Boolean(effectiveForm?.currentPublishedVersionId),
    retry: false,
  });
  const effectiveFormLoading = formsQuery.isPending || (Boolean(effectiveForm) && versionQuery.isPending);

  const fields = useMemo(() => {
    if (!versionQuery.data) return [];
    const parsed = parseDefinition(versionQuery.data.definition);
    if (!parsed.ok) return [];
    return inputFields(parsed.definition).map(({ field }) => ({
      key: field.key,
      label: field.label,
      type: field.type,
    }));
  }, [versionQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<TaskCompletionRequirementsResponse>(
        `/task-types/${taskType.id}/completion-requirements`,
        buildRequirementsPayload(drafts),
      ),
    onSuccess: async (saved) => {
      setDrafts(requirementDrafts(saved.requirements));
      setMessage('');
      setSuccess('Zahtjevi završetka su sačuvani.');
      await onSaved(saved);
    },
    onError: (error) => {
      setSuccess('');
      setMessage(error instanceof Error ? error.message : 'Snimanje zahtjeva nije uspjelo.');
    },
  });

  const changeDraft = (index: number, key: keyof TaskCompletionRequirementDraft, value: string | boolean) => {
    setDrafts((current) =>
      current.map((draft, itemIndex) => (itemIndex === index ? { ...draft, [key]: value } : draft)),
    );
    setSuccess('');
  };

  return (
    <Card>
      <CardHeader
        title={`Zahtjevi završetka — ${taskType.code}`}
        description="Cijeli skup se snima jednim atomski zamijenjenim zahtjevom; ključevi moraju odgovarati objavljenoj TASK formi."
        actions={
          <Button size="sm" variant="ghost" onClick={onClose}>
            Zatvori
          </Button>
        }
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage('');
            setSuccess('');
            save.mutate();
          }}
        >
          {effectiveForm && versionQuery.data ? (
            <p className="text-sm text-[var(--fg-muted)]">
              Efektivna forma: <span className="font-medium text-[var(--fg)]">{effectiveForm.name}</span> (
              {effectiveForm.key}, v{versionQuery.data.version}). Ključ se bira iz njenih polja za unos.
            </p>
          ) : effectiveFormLoading ? (
            <p className="text-sm text-[var(--fg-muted)]">Učitavanje efektivne TASK forme…</p>
          ) : (
            <p className="text-sm text-[var(--warning)]">
              Efektivna objavljena TASK forma nije učitana. Ključ možete unijeti ručno; API ostaje konačna
              provjera.
            </p>
          )}

          {!canUpdate && (
            <p className="text-sm text-[var(--fg-muted)]">
              Imate pravo pregleda. Za izmjenu zahtjeva potrebna je permisija{' '}
              <span className="font-mono">task_type:update</span>.
            </p>
          )}

          <fieldset disabled={!canUpdate || save.isPending} className="space-y-3">
            {drafts.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--fg-muted)]">
                Nema posebnih zahtjeva. Završetak će se kasnije provjeravati samo prema pravilima same forme i
                vrste.
              </p>
            ) : (
              drafts.map((draft, index) => {
                const fieldKnown = fields.some((field) => field.key === draft.fieldKey);
                const idPrefix = `zahtjev-zavrs-${index}`;
                return (
                  <section key={index} className="rounded-md border border-[var(--border)] p-3">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_150px_auto] lg:items-end">
                      <Field
                        label={`Polje forme ${index + 1}`}
                        htmlFor={`${idPrefix}-field`}
                        hint={
                          fields.length
                            ? 'PHOTO polje je jedino koje smije imati minimalan broj fotografija veći od 0.'
                            : 'Tehnički ključ iz definicije, npr. photosAfter.'
                        }
                      >
                        {fields.length ? (
                          <select
                            id={`${idPrefix}-field`}
                            className={inputClassName}
                            value={draft.fieldKey}
                            onChange={(event) => changeDraft(index, 'fieldKey', event.target.value)}
                          >
                            <option value="">Odaberite polje</option>
                            {draft.fieldKey && !fieldKnown ? (
                              <option value={draft.fieldKey}>
                                {draft.fieldKey} (nije u trenutnoj formi)
                              </option>
                            ) : null}
                            {fields.map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.label} · {field.key} · {field.type}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={`${idPrefix}-field`}
                            className={`${inputClassName} font-mono`}
                            autoComplete="off"
                            value={draft.fieldKey}
                            onChange={(event) => changeDraft(index, 'fieldKey', event.target.value)}
                          />
                        )}
                      </Field>

                      <Field label="Faza priloga" htmlFor={`${idPrefix}-stage`}>
                        <select
                          id={`${idPrefix}-stage`}
                          className={inputClassName}
                          value={draft.stage}
                          onChange={(event) => changeDraft(index, 'stage', event.target.value)}
                        >
                          {ATTACHMENT_STAGES.map((stage) => (
                            <option key={stage} value={stage}>
                              {statusLabel(stage, 'attachmentStage')}
                            </option>
                          ))}
                        </select>
                      </Field>

                      <Field label="Min. fotografija" htmlFor={`${idPrefix}-photos`}>
                        <input
                          id={`${idPrefix}-photos`}
                          className={inputClassName}
                          inputMode="numeric"
                          autoComplete="off"
                          value={draft.minPhotos}
                          onChange={(event) => changeDraft(index, 'minPhotos', event.target.value)}
                        />
                      </Field>

                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        aria-label={`Ukloni zahtjev ${index + 1}`}
                        onClick={() =>
                          setDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))
                        }
                      >
                        Ukloni
                      </Button>
                    </div>

                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.required}
                        onChange={(event) => changeDraft(index, 'required', event.target.checked)}
                      />
                      Obavezan zahtjev za završetak
                    </label>
                  </section>
                );
              })
            )}

            {canUpdate && drafts.length < 50 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setDrafts((current) => [...current, emptyRequirementDraft()])}
              >
                Dodaj zahtjev
              </Button>
            )}
          </fieldset>

          {message && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {message}
            </p>
          )}
          {success && <p className="text-sm text-[var(--success)]">{success}</p>}

          <div className="flex flex-wrap gap-2">
            {canUpdate && (
              <Button type="submit" variant="primary" loading={save.isPending}>
                Sačuvaj zahtjeve
              </Button>
            )}
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={onClose}>
              Zatvori
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
