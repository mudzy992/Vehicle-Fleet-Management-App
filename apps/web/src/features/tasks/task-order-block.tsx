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

function linkedPath(task: TaskDetail): string | null {
  if (!task.linkedRecordId || !task.vehicleId) return task.vehicleId ? `/vozila/${task.vehicleId}` : null;
  if (task.linkedRecordType === 'SERVICE') return `/vozila/${task.vehicleId}`;
  if (task.linkedRecordType === 'REGISTRATION') return `/registracije`;
  return `/gume`;
}

export function TaskOrderBlock({ task }: { task: TaskDetail }) {
  const values = task.orderFormData ?? task.formData;
  const today = useMemo(() => sarajevoToday(), []);
  const versionQuery = useQuery({
    queryKey: ['form-version', task.formSchemaId, task.formSchemaVersionId],
    queryFn: () =>
      api.get<FormVersionDetail>(`/form-schemas/${task.formSchemaId}/versions/${task.formSchemaVersionId}`),
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
      formSchemaVersionId: task.formSchemaVersionId,
    });
  }, [parsed, versionQuery.data, values, today, task.formSchemaVersionId]);
  const linkedHref = linkedPath(task);

  return (
    <Card>
      <CardHeader title="Nalog" description={`${task.formSchemaName} v${task.formSchemaVersion}`} />
      <CardContent>
        {model ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            {model.sections.flatMap((section) =>
              section.fields.map((field) => (
                <div key={field.key} className="min-w-0">
                  <dt className="text-xs text-fg-muted">{field.label}</dt>
                  <dd className="mt-1 break-words text-sm">{formatFieldValue(field)}</dd>
                </div>
              )),
            )}
          </dl>
        ) : (
          <p className="text-sm text-fg-muted">
            {Object.keys(values).length === 0 ? 'Nalog nema unesenih polja.' : 'Učitavanje labele nalog polja…'}
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
