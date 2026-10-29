/** Unos kompleta kroz aktivnu objavljenu TIRE_SET formu; zapis pamti njenu verziju. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { parseDefinition } from '@vfm/form-engine/definition';
import { buildRenderModel } from '@vfm/form-renderer';
import { TIRE_SEASONS, statusLabel } from '@vfm/shared';
import type { ActiveFormSchema, TireSetView } from '@vfm/shared/schemas';
import { Button } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { CoreFields, FormFields, type CoreFieldSpec } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { buildTireSetPayload } from './tire-sets-model.js';

export const TIRE_SET_CORE_FIELDS: readonly CoreFieldSpec[] = [
  {
    key: 'code',
    label: 'Kod kompleta',
    kind: 'TEXT',
    required: true,
    hint: 'Jedinstvena interna oznaka, npr. G-Z-001.',
  },
  {
    key: 'season',
    label: 'Sezona',
    kind: 'SELECT',
    required: true,
    options: TIRE_SEASONS.map((season) => ({
      value: season,
      label: statusLabel(season, 'tireSeason'),
    })),
  },
  { key: 'brand', label: 'Proizvođač', kind: 'TEXT' },
  { key: 'model', label: 'Model', kind: 'TEXT' },
  {
    key: 'size',
    label: 'Dimenzija',
    kind: 'TEXT',
    hint: 'Npr. 205/55 R16 91V.',
  },
  { key: 'tireCount', label: 'Broj guma u kompletu', kind: 'INTEGER', required: true },
  { key: 'purchaseDate', label: 'Datum nabavke', kind: 'DATE' },
  { key: 'purchasePrice', label: 'Nabavna cijena kompleta (KM)', kind: 'TEXT' },
  { key: 'currentLocation', label: 'Trenutna lokacija / skladište', kind: 'TEXT' },
  { key: 'notes', label: 'Napomena', kind: 'MULTILINE' },
];

export function TireSetCreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const today = sarajevoToday();
  const [core, setCore] = useState<Record<string, string>>({ tireCount: '4' });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState('');

  const form = useQuery({
    queryKey: ['form-active', 'TIRE_SET'],
    queryFn: () => api.get<ActiveFormSchema>('/form-schemas/active?subject=TIRE_SET'),
    retry: false,
  });

  const parsed = useMemo(
    () => (form.data ? parseDefinition(form.data.definition) : null),
    [form.data],
  );
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
    mutationFn: () => {
      if (!form.data) throw new Error('Objavljena forma kompleta nije učitana.');
      return api.post<TireSetView>(
        '/tire-sets',
        buildTireSetPayload(core, values, form.data.formSchemaVersionId),
      );
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
      {form.isPending ? (
        <p role="status" className="text-sm text-[var(--fg-muted)]">Učitavanje forme…</p>
      ) : form.isError ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {form.error instanceof ApiError
            ? `Nema dostupne aktivne forme TIRE_SET: ${form.error.message}`
            : 'Greška pri učitavanju forme TIRE_SET. Provjerite vezu i pokušajte ponovo.'}
        </p>
      ) : parsed && !parsed.ok ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          Definicija forme TIRE_SET nije ispravna: {parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}
        </p>
      ) : !model ? (
        <p role="status" className="text-sm text-[var(--fg-muted)]">Učitavanje forme…</p>
      ) : (
        <>
          <CoreFields
            fields={TIRE_SET_CORE_FIELDS}
            values={core}
            errors={{}}
            idPrefix="komplet-guma"
            disabled={save.isPending}
            onChange={(key, value) => setCore((current) => ({ ...current, [key]: value }))}
          />
          <FormFields
            model={model}
            hiddenKeys={TIRE_SET_CORE_FIELDS.map((field) => field.key)}
            errors={{}}
            idPrefix="komplet-guma-dodatno"
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />
          <p className="text-xs text-[var(--fg-muted)]">
            Novi komplet se evidentira kao „Na skladištu“. Montaža na vozilo je zaseban, transakcijski korak.
          </p>
        </>
      )}

      {message && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!model} loading={save.isPending}>
          Sačuvaj komplet
        </Button>
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>
          Odustani
        </Button>
      </div>
    </form>
  );
}
