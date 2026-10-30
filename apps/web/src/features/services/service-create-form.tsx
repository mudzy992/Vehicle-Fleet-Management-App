/** Unos servisa koristi aktivnu objavljenu formu; verzija se šalje serveru. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { parseDefinition } from '@vfm/form-engine/definition';
import { buildRenderModel } from '@vfm/form-renderer';
import type { ActiveFormSchema } from '@vfm/shared/schemas';
import { Button } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { CoreFields, FormFields, type CoreFieldSpec } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { moneyToFeninzi } from '../vehicles/records-model.js';

const FIELDS: readonly CoreFieldSpec[] = [
  { key: 'serviceDate', label: 'Datum servisa', kind: 'DATE', required: true },
  { key: 'serviceType', label: 'Vrsta servisa', kind: 'TEXT', required: true },
  { key: 'workshopName', label: 'Radionica', kind: 'TEXT' },
  { key: 'description', label: 'Opis', kind: 'MULTILINE' },
  { key: 'totalCost', label: 'Ukupni trošak (KM)', kind: 'TEXT', required: true },
  {
    key: 'odometerKm',
    label: 'Kilometraža (km)',
    kind: 'TEXT',
    hint: 'Manja vrijednost zahtijeva zasebnu auditovanu korekciju.',
  },
  { key: 'nextServiceDueDate', label: 'Sljedeći servis — datum', kind: 'DATE' },
  { key: 'nextServiceDueKm', label: 'Sljedeći servis — km', kind: 'TEXT' },
];
export function ServiceCreateForm({
  vehicleId,
  onCreated,
  onCancel,
}: {
  vehicleId: string;
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const today = sarajevoToday();
  const [core, setCore] = useState<Record<string, string>>({ serviceDate: today });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState('');
  const form = useQuery({
    queryKey: ['form-active', 'SERVICE'],
    queryFn: () => api.get<ActiveFormSchema>('/form-schemas/active?subject=SERVICE'),
    retry: false,
  });
  const parsed = useMemo(() => (form.data ? parseDefinition(form.data.definition) : null), [form.data]);
  const model = useMemo(() => {
    if (!parsed?.ok || !form.data) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      today,
      version: form.data.version,
      formSchemaVersionId: form.data.formSchemaVersionId,
    });
  }, [form.data, parsed, today, values]);
  const save = useMutation({
    mutationFn: async () => {
      const totalCost = moneyToFeninzi(core.totalCost ?? '');
      if (totalCost === null) throw new Error('Unesite ispravan nenegativan iznos u KM.');
      const payload: Record<string, unknown> = {
        vehicleId,
        formData: values,
        formSchemaVersionId: form.data!.formSchemaVersionId,
        totalCost,
      };
      for (const field of FIELDS) {
        if (field.key === 'totalCost') continue;
        const raw = (core[field.key] ?? '').trim();
        if (!raw) continue;
        if (field.key === 'odometerKm' || field.key === 'nextServiceDueKm') {
          if (!/^\d+$/.test(raw) || Number(raw) > 2147483647)
            throw new Error('Kilometraža mora biti nenegativan cijeli broj.');
          payload[field.key] = Number(raw);
        } else payload[field.key] = raw;
      }
      return api.post('/services', payload);
    },
    onSuccess: onCreated,
    onError: (error) =>
      setMessage(
        error instanceof ApiError || error instanceof Error ? error.message : 'Snimanje nije uspjelo.',
      ),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage('');
        save.mutate();
      }}
    >
      <h3 className="font-semibold">Novi servis</h3>
      {form.isPending ? (
        <p role="status" className="text-sm text-fg-muted">
          Učitavanje forme…
        </p>
      ) : form.isError ? (
        <p role="alert" className="text-sm text-danger">
          {form.error instanceof ApiError
            ? `Nije dostupna aktivna forma SERVICE: ${form.error.message}`
            : 'Greška pri učitavanju forme SERVICE. Provjerite vezu i pokušajte ponovo.'}
        </p>
      ) : parsed && !parsed.ok ? (
        <p role="alert" className="text-sm text-danger">
          Definicija forme SERVICE nije ispravna:{' '}
          {parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}
        </p>
      ) : !model ? (
        <p role="status" className="text-sm text-fg-muted">
          Učitavanje forme…
        </p>
      ) : (
        <>
          <CoreFields
            fields={FIELDS}
            values={core}
            errors={{}}
            idPrefix="servis-"
            onChange={(key, value) => setCore((current) => ({ ...current, [key]: value }))}
          />
          <FormFields
            model={model}
            hiddenKeys={FIELDS.map((f) => f.key)}
            errors={{}}
            idPrefix="servis-extra"
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />
        </>
      )}
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!model} loading={save.isPending}>
          Sačuvaj servis
        </Button>
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>
          Odustani
        </Button>
      </div>
    </form>
  );
}
