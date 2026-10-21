/** Potpuna izmjena osnovnih podataka servisa; trošak ostaje u stavkama računa. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ServiceRecord } from '@vfm/shared/schemas';
import { Button, Card, CardContent, CardHeader } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { CoreFields, type CoreFieldSpec } from '../forms/form-fields.js';
import { buildServiceUpdatePayload, initialServiceEditValues } from './service-edit-model.js';
const FIELDS: readonly CoreFieldSpec[] = [
  { key: 'serviceDate', label: 'Datum servisa', kind: 'DATE', required: true },
  { key: 'serviceType', label: 'Vrsta servisa', kind: 'TEXT', required: true },
  { key: 'workshopName', label: 'Radionica', kind: 'TEXT' },
  { key: 'description', label: 'Opis', kind: 'MULTILINE' },
  {
    key: 'odometerKm',
    label: 'Kilometraža servisa (km)',
    kind: 'INTEGER',
    hint: 'Manja od trenutne km vozila zahtijeva zasebnu korekciju kilometraže.',
  },
  { key: 'nextServiceDueDate', label: 'Sljedeći servis — datum', kind: 'DATE' },
  { key: 'nextServiceDueKm', label: 'Sljedeći servis — km', kind: 'INTEGER' },
];
export function ServiceEditForm({ record, onClose }: { record: ServiceRecord; onClose: () => void }) {
  const client = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() => initialServiceEditValues(record));
  const [message, setMessage] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/services/${record.id}`, buildServiceUpdatePayload(record, values)),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['services'] }),
        client.invalidateQueries({ queryKey: ['service-items', record.id] }),
        client.invalidateQueries({ queryKey: ['vehicle', record.vehicleId] }),
        client.invalidateQueries({ queryKey: ['vehicles'] }),
        client.invalidateQueries({ queryKey: ['odometer', record.vehicleId] }),
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
        description={`Verzija zapisa ${record.version}. Trošak se mijenja kroz stavke računa; rokovi vozila se ponovo računaju nakon snimanja.`}
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
