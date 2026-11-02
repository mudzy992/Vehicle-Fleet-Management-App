import { useState } from 'react';
import type { AttachmentUploadResult } from '@vfm/shared/schemas';
import { Field, inputClassName } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { useSession } from '../auth/session.js';
import { AttachmentGallery } from './attachment-gallery.js';

interface AttachmentField {
  readonly key: string;
  readonly label: string;
  readonly required?: boolean;
  readonly helpText?: string | null;
  readonly type: string;
  readonly validation?: { maxFiles?: number };
}

export function TaskCompletionAttachments({
  fields,
  values,
  errors,
  disabled,
  onValuesChange,
}: {
  fields: AttachmentField[];
  values: Record<string, unknown>;
  errors: Record<string, string>;
  disabled: boolean;
  onValuesChange: (next: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown>)) => void;
}) {
  const { hasPermission } = useSession();
  const canUpload = hasPermission('attachment:upload');
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  if (fields.length === 0) return null;
  const uploadFiles = async (fieldKey: string, files: FileList | null, maxFiles: number | undefined) => {
    if (!files?.length) return;
    if (!canUpload) {
      toast.warning('Fotografije i prilozi traže permisiju attachment:upload.');
      return;
    }
    const current = Array.isArray(values[fieldKey]) ? (values[fieldKey] as string[]) : [];
    if (maxFiles !== undefined && current.length + files.length > maxFiles) {
      toast.warning(`Polje prima najviše ${maxFiles} fajlova.`);
      return;
    }
    setUploadingField(fieldKey);
    try {
      const uploadedIds = [...current];
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append('file', file);
        const uploaded = await api.upload<AttachmentUploadResult>('/attachments', body);
        uploadedIds.push(uploaded.id);
        onValuesChange((existing) => ({ ...existing, [fieldKey]: [...uploadedIds] }));
      }
    } catch (error) {
      if (!(error instanceof ApiError)) toast.danger('Upload priloga nije uspio.');
    } finally {
      setUploadingField(null);
    }
  };
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h3 className="text-sm font-medium">Fotografije i prilozi</h3>
      {!canUpload && (
        <p className="text-xs text-warning">Za upload je potrebna permisija attachment:upload.</p>
      )}
      {fields.map((field) => {
        const ids = Array.isArray(values[field.key]) ? (values[field.key] as string[]) : [];
        const maxFiles = typeof field.validation?.maxFiles === 'number' ? field.validation.maxFiles : undefined;
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
              disabled={!canUpload || uploadingField !== null || disabled}
              onChange={(event) => {
                void uploadFiles(field.key, event.currentTarget.files, maxFiles);
                event.currentTarget.value = '';
              }}
            />
            <p className="mt-1 text-xs text-fg-muted">
              Dodano fajlova: {ids.length}
              {uploadingField === field.key ? ' · Upload u toku…' : ''}
            </p>
            <AttachmentGallery
              ids={ids}
              kind={field.type === 'FILE' ? 'FILE' : 'PHOTO'}
              onRemove={(id) =>
                onValuesChange((current) => ({
                  ...current,
                  [field.key]: ids.filter((item) => item !== id),
                }))
              }
            />
          </Field>
        );
      })}
    </section>
  );
}
