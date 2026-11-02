import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormVersionDetail, TaskDetail } from '@vfm/shared/schemas';
import { parseDefinition } from '@vfm/form-engine/definition';
import type { RenderModel } from '@vfm/form-renderer';
import { buildRenderModel } from '@vfm/form-renderer';
import { Button, Card, CardContent, CardHeader, Field, inputClassName } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { FormFields } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { TaskCompletionAttachments } from './task-completion-attachments.js';

export function TaskCompletionForm({ task, onCompleted }: { task: TaskDetail; onCompleted?: () => void }) {
  const queryClient = useQueryClient();
  const realizationSchemaId = task.realizationFormSchemaId ?? task.formSchemaId;
  const realizationVersionId = task.realizationFormSchemaVersionId ?? task.formSchemaVersionId;
  const [values, setValues] = useState<Record<string, unknown>>(task.realizationFormData ?? {});
  const [comment, setComment] = useState('');
  const [odometerKm, setOdometerKm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const today = useMemo(() => sarajevoToday(), []);
  const versionQuery = useQuery({
    queryKey: ['form-version', realizationSchemaId, realizationVersionId],
    queryFn: () =>
      api.get<FormVersionDetail>(
        `/form-schemas/${realizationSchemaId}/versions/${realizationVersionId}`,
      ),
  });
  const parsed = useMemo(
    () => (versionQuery.data ? parseDefinition(versionQuery.data.definition) : null),
    [versionQuery.data],
  );
  const model = useMemo<RenderModel | null>(() => {
    if (!parsed?.ok || !versionQuery.data) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      today,
      version: versionQuery.data.version,
      formSchemaVersionId: realizationVersionId,
    });
  }, [parsed, versionQuery.data, values, today, realizationVersionId]);
  const attachmentFields = parsed?.ok
    ? parsed.definition.sections.flatMap((section) =>
        section.fields.filter((field) => field.type === 'PHOTO' || field.type === 'FILE'),
      )
    : [];
  const complete = useMutation({
    mutationFn: () =>
      api.post<TaskDetail>(`/tasks/${task.id}/complete`, {
      version: task.version,
      realizationFormData: values,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...(odometerKm.trim() ? { odometerKm: Number(odometerKm) } : {}),
    }),
    onSuccess: async () => {
      toast.success('Zadatak je završen.');
      onCompleted?.();
      setErrors({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task', task.id] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
    onError: (error) => {
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
  if (versionQuery.isPending) return <p className="text-sm text-fg-muted">Učitavanje forme za završetak…</p>;
  if (versionQuery.error || !model) {
    return (
      <p role="alert" className="text-sm text-danger">
        {versionQuery.error instanceof ApiError
          ? versionQuery.error.message
          : 'Snapshot forme nije moguće učitati ili nije ispravan.'}
      </p>
    );
  }
  const formError =
    complete.error && Object.keys(errors).length === 0
      ? complete.error instanceof ApiError
        ? complete.error.message
        : 'Završetak nije uspio.'
      : null;
  return (
    <Card>
      <CardHeader
        title="Završetak zadatka"
        description={`Obavezna polja se provjeravaju prema snapshotu forme v${versionQuery.data.version}.`}
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            complete.mutate();
          }}
        >
          <FormFields
            model={model}
            errors={errors}
            hiddenKeys={attachmentFields.map((field) => field.key)}
            idPrefix="task-complete"
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />
          <TaskCompletionAttachments
            fields={attachmentFields}
            values={values}
            errors={errors}
            disabled={complete.isPending}
            onValuesChange={setValues}
          />
          <Field label="Kilometraža (km), ako je primjenjivo" htmlFor="task-complete-odometer">
            <input
              id="task-complete-odometer"
              className={inputClassName}
              inputMode="numeric"
              value={odometerKm}
              onChange={(event) => setOdometerKm(event.target.value.replace(/[^0-9]/gu, ''))}
            />
          </Field>
          <Field label="Komentar uz završetak" htmlFor="task-complete-comment">
            <textarea
              id="task-complete-comment"
              className={`${inputClassName} min-h-20`}
              maxLength={2000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
          {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
          <Button type="submit" loading={complete.isPending}>
            Završi zadatak
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
