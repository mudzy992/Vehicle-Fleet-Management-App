import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { statusLabel } from '@vfm/shared';
import type { FormVersionDetail, TaskDetail } from '@vfm/shared/schemas';
import { parseDefinition } from '@vfm/form-engine/definition';
import { buildRenderModel, formatFieldValue } from '@vfm/form-renderer';
import { Card, CardContent, CardHeader } from '../../components/ui/index.js';
import { api } from '../../lib/api.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { AttachmentGallery } from './attachment-gallery.js';

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function linkedPath(task: TaskDetail): string | null {
  if (!task.linkedRecordId || !task.vehicleId) return task.vehicleId ? `/vozila/${task.vehicleId}` : null;
  if (task.linkedRecordType === 'SERVICE') return `/vozila/${task.vehicleId}`;
  if (task.linkedRecordType === 'REGISTRATION') return `/registracije`;
  return `/gume`;
}

export function TaskOrderBlock({
  task,
  role = 'ORDER',
}: {
  task: TaskDetail;
  role?: 'ORDER' | 'REALIZATION';
}) {
  const isOrder = role === 'ORDER';
  const schemaId = isOrder ? task.formSchemaId : (task.realizationFormSchemaId ?? task.formSchemaId);
  const versionId = isOrder ? task.formSchemaVersionId : (task.realizationFormSchemaVersionId ?? task.formSchemaVersionId);
  const values = isOrder ? (task.orderFormData ?? task.formData) : (task.realizationFormData ?? {});
  const today = useMemo(() => sarajevoToday(), []);
  const versionQuery = useQuery({
    queryKey: ['form-version', schemaId, versionId],
    queryFn: () => api.get<FormVersionDetail>(`/form-schemas/${schemaId}/versions/${versionId}`),
    retry: false,
  });
  const parsed = useMemo(
    () => (versionQuery.data ? parseDefinition(versionQuery.data.definition) : null),
    [versionQuery.data],
  );
  const model = useMemo(() => {
    if (!parsed?.ok || !versionQuery.data) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      today,
      version: versionQuery.data.version,
      formSchemaVersionId: versionId,
    });
  }, [parsed, versionQuery.data, values, today, versionId]);
  const linkedHref = isOrder ? linkedPath(task) : null;

  return (
    <Card>
      <CardHeader
        title={isOrder ? 'Nalog' : 'Realizacija'}
        description={isOrder ? `${task.formSchemaName} v${task.formSchemaVersion}` : `Unos izvršioca · v${versionQuery.data?.version ?? '—'}`}
      />
      <CardContent>
        {model ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            {model.sections.flatMap((section) =>
              section.fields.map((field) => (
                <div key={field.key} className={field.widget === 'PHOTO' || field.widget === 'FILE' ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
                  <dt className="text-xs text-fg-muted">{field.label}</dt>
                  <dd className="mt-1 break-words text-sm">
                    {field.widget === 'PHOTO' || field.widget === 'FILE' ? (
                      <AttachmentGallery ids={stringIds(field.value)} kind={field.widget} />
                    ) : (
                      formatFieldValue(field)
                    )}
                  </dd>
                </div>
              )),
            )}
          </dl>
        ) : (
          <p className="text-sm text-fg-muted">
            {Object.keys(values).length === 0
              ? `${isOrder ? 'Nalog' : 'Realizacija'} nema unesenih polja.`
              : `Učitavanje labele ${isOrder ? 'nalog' : 'realizacija'} polja…`}
          </p>
        )}
        {task.linkedRecordId && linkedHref ? (
          <p className="mt-3 text-sm">
            Povezana evidencija:{' '}
            <Link className="text-primary underline" to={linkedHref}>
              {task.linkedRecordType ? statusLabel(task.linkedRecordType, 'linkedRecordType') : 'zapis'}
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
