/** Samo opisni podaci: stavke i kilometraža se ne prepisuju ovom formom. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ServiceRecord } from '@vfm/shared/schemas';
import { Button, Card, CardContent, CardHeader } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { CoreFields, type CoreFieldSpec } from '../forms/form-fields.js';
const FIELDS: readonly CoreFieldSpec[] = [
  { key: 'serviceType', label: 'Vrsta servisa', kind: 'TEXT', required: true },
  { key: 'workshopName', label: 'Radionica', kind: 'TEXT' },
  { key: 'description', label: 'Opis', kind: 'MULTILINE' },
];
export function ServiceEditForm({ record, onClose }: { record: ServiceRecord; onClose: () => void }) {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({
    serviceType: record.serviceType,
    workshopName: record.workshopName ?? '',
    description: record.description ?? '',
  });
  const [message, setMessage] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/services/${record.id}`, {
        version: record.version,
        serviceType: (values.serviceType ?? '').trim(),
        workshopName: (values.workshopName ?? '').trim() || null,
        description: (values.description ?? '').trim() || null,
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['services'] }),
        client.invalidateQueries({ queryKey: ['service-items', record.id] }),
      ]);
      onClose();
    },
    onError: (error) =>
      setMessage(
        error instanceof ApiError && error.code === 'VERSION_CONFLICT'
          ? 'Servis je izmijenjen u međuvremenu. Unos je sačuvan u formi; zatvorite je i ponovo otvorite za novu verziju.'
          : error instanceof Error
            ? error.message
            : 'Snimanje nije uspjelo.',
      ),
  });
  return (
    <Card>
      <CardHeader
        title="Izmjena servisa"
        description={`Verzija zapisa ${record.version}. Datum, kilometraža, rokovi i trošak se ovdje ne mijenjaju.`}
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage('');
            save.mutate();
          }}
        >
          <fieldset disabled={save.isPending}>
            <CoreFields
              fields={FIELDS}
              values={values}
              errors={{}}
              idPrefix="servis-izmjena-"
              onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
            />
          </fieldset>
          {message && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {message}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
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
