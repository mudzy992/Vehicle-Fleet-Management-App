import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttachmentUploadResult, FormVersionDetail, TaskDetail } from '@vfm/shared/schemas';
import { parseDefinition } from '@vfm/form-engine/definition';
import type { RenderModel } from '@vfm/form-renderer';
import { buildRenderModel } from '@vfm/form-renderer';
import { Button, Card, CardContent, CardHeader, Field, inputClassName } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { FormFields } from '../forms/form-fields.js';
import { useSession } from '../auth/session.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';

export function TaskCompletionForm({ task, onCompleted }: { task: TaskDetail; onCompleted?: () => void }) {
  const queryClient = useQueryClient();
  const { hasPermission } = useSession();
  const canUpload = hasPermission('attachment:upload');
  const [values, setValues] = useState<Record<string, unknown>>(task.formData);
  const [comment, setComment] = useState('');
  const [odometerKm, setOdometerKm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const today = useMemo(() => sarajevoToday(), []);
  const versionQuery = useQuery({
    queryKey: ['form-version', task.formSchemaId, task.formSchemaVersionId],
    queryFn: () =>
      api.get<FormVersionDetail>(`/form-schemas/${task.formSchemaId}/versions/${task.formSchemaVersionId}`),
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
      formSchemaVersionId: task.formSchemaVersionId,
    });
  }, [parsed, versionQuery.data, values, today, task.formSchemaVersionId]);

  const attachmentFields = parsed?.ok
    ? parsed.definition.sections.flatMap((section) =>
        section.fields.filter((field) => field.type === 'PHOTO' || field.type === 'FILE'),
      )
    : [];

  const uploadFiles = async (fieldKey: string, files: FileList | null, maxFiles: number | undefined) => {
    if (!files?.length) return;
    if (!canUpload) {
      setUploadError('Fotografije i prilozi traže permisiju attachment:upload.');
      return;
    }
    const current = Array.isArray(values[fieldKey]) ? (values[fieldKey] as string[]) : [];
    if (maxFiles !== undefined && current.length + files.length > maxFiles) {
      setUploadError(`Polje prima najviše ${maxFiles} fajlova.`);
      return;
    }
    setUploadError(null);
    setUploadingField(fieldKey);
    try {
      const uploadedIds = [...current];
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append('file', file);
        const uploaded = await api.upload<AttachmentUploadResult>('/attachments', body);
        uploadedIds.push(uploaded.id);
        setValues((existing) => ({ ...existing, [fieldKey]: [...uploadedIds] }));
      }
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.message : 'Upload priloga nije uspio.');
    } finally {
      setUploadingField(null);
    }
  };

  const complete = useMutation({
    mutationFn: () =>
      api.post<TaskDetail>(`/tasks/${task.id}/complete`, {
      version: task.version,
      formData: values,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...(odometerKm.trim() ? { odometerKm: Number(odometerKm) } : {}),
    }),
    onSuccess: async () => {
      setMessage('Zadatak je završen.');
      onCompleted?.();
      setErrors({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['task', task.id] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    },
    onError: (error) => {
      setMessage(
        error instanceof ApiError ? error.message : 'Završetak zadatka nije uspio. Pokušajte ponovo.',
      );
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
            setMessage(null);
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
          {attachmentFields.length > 0 && (
            <section className="space-y-3 rounded-md border border-border p-3">
              <h3 className="text-sm font-medium">Fotografije i prilozi</h3>
              {!canUpload && (
                <p className="text-xs text-warning">Za upload je potrebna permisija attachment:upload.</p>
              )}
              {attachmentFields.map((field) => {
                const ids = Array.isArray(values[field.key]) ? (values[field.key] as string[]) : [];
                const maxFiles =
                  typeof field.validation?.maxFiles === 'number' ? field.validation.maxFiles : undefined;
                return (
                  <Field
                    key={field.key}
                    label={`${field.label}${field.required ? ' *' : ''}`}
                    htmlFor={`task-complete-upload-${field.key}`}
                    hint={field.helpText ?? undefined}
                    error={errors[field.key] ?? null}
                  >
                    <input
                      id={`task-complete-upload-${field.key}`}
                      className={inputClassName}
                      type="file"
                      accept={field.type === 'PHOTO' ? 'image/*' : undefined}
                      multiple
                      disabled={!canUpload || uploadingField !== null || complete.isPending}
                      onChange={(event) => {
                        void uploadFiles(field.key, event.currentTarget.files, maxFiles);
                        event.currentTarget.value = '';
                      }}
                    />
                    <p className="mt-1 text-xs text-fg-muted">
                      Dodano fajlova: {ids.length}
                      {uploadingField === field.key ? ' · Upload u toku…' : ''}
                    </p>
                  </Field>
                );
              })}
              {uploadError && (
                <p role="alert" className="text-sm text-danger">
                  {uploadError}
                </p>
              )}
            </section>
          )}
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
          {message && (
            <p role={complete.isError ? 'alert' : 'status'} className="text-sm">
              {message}
            </p>
          )}
          <Button type="submit" loading={complete.isPending}>
            Završi zadatak
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
