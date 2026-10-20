/**
 * Novo vozilo (W07, docs/06 §5.5; docs/07 §2.5).
 *
 * Ekran je **jedan** izvor za dvije vrste podataka:
 * 1. strukturirane kolone (interni broj, marka, model, godina, gorivo, VIN) —
 *    statične kontrole, jer identitet vozila nije dio dinamičke forme
 *    (docs/04 §7);
 * 2. ostatak zapisa — dinamička forma `VEHICLE` kroz `buildRenderModel`, pa se
 *    vidljivost/obaveznost/izračunata polja ne dupliraju u kodu ekrana.
 *
 * Server ponovo validira sve (P11) i vraća greške po polju (`details[].path`),
 * koje ekran prikazuje uz tačnu kontrolu — nema „nešto nije u redu" poruke.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { FUEL_TYPES, statusLabel } from '@vfm/shared';
import type { ActiveFormSchema, VehicleDetail } from '@vfm/shared/schemas';
import { parseDefinition } from '@vfm/form-engine';
import type { RenderModel } from '@vfm/form-renderer';
import { buildRenderModel } from '@vfm/form-renderer';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  buttonClassName,
} from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { CoreFields, FormFields, type CoreFieldSpec } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';

/** Kolone koje se unose statično (forma ih ne prikazuje ponovo). */
const CORE_FIELDS: readonly CoreFieldSpec[] = [
  {
    key: 'internalNo',
    label: 'Interni broj',
    kind: 'TEXT',
    required: true,
    hint: 'Jedinstven među aktivnim vozilima.',
  },
  { key: 'make', label: 'Marka', kind: 'TEXT', required: true },
  { key: 'model', label: 'Model', kind: 'TEXT', required: true },
  { key: 'year', label: 'Godina proizvodnje', kind: 'INTEGER', hint: '1900–2100' },
  { key: 'vin', label: 'VIN', kind: 'TEXT', hint: '17 znakova, ako je poznat.' },
  {
    key: 'fuelType',
    label: 'Gorivo',
    kind: 'SELECT',
    required: true,
    options: FUEL_TYPES.map((value) => ({ value, label: statusLabel(value, 'fuelType') })),
  },
];

const HIDDEN_FORM_KEYS = CORE_FIELDS.map((field) => field.key);

export function VehicleCreatePage() {
  const navigate = useNavigate();
  const [core, setCore] = useState<Record<string, string>>({ fuelType: 'DIESEL' });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const today = useMemo(() => sarajevoToday(), []);

  const form = useQuery({
    queryKey: ['form-active', 'VEHICLE'],
    queryFn: () => api.get<ActiveFormSchema>('/form-schemas/active?subject=VEHICLE'),
    retry: false,
  });

  const parsed = useMemo(() => {
    if (!form.data) return null;
    return parseDefinition(form.data.definition as unknown);
  }, [form.data]);

  const model = useMemo<RenderModel | null>(() => {
    if (!parsed?.ok || !form.data) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      today,
      version: form.data.version,
      formSchemaVersionId: form.data.formSchemaVersionId,
    });
  }, [parsed, form.data, values, today]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<VehicleDetail>('/vehicles', {
        internalNo: core.internalNo?.trim(),
        make: core.make?.trim(),
        model: core.model?.trim(),
        fuelType: core.fuelType,
        ...(core.year ? { year: Number(core.year) } : {}),
        ...(core.vin?.trim() ? { vin: core.vin.trim().toUpperCase() } : {}),
        formData: values,
        ...(form.data ? { formSchemaVersionId: form.data.formSchemaVersionId } : {}),
      }),
    onSuccess: (created) => navigate(`/vozila/${created.id}`),
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        setMessage('Greška pri snimanju vozila.');
        return;
      }
      const fieldErrors: Record<string, string> = {};
      for (const detail of error.details ?? []) {
        const path = detail.path.join('.');
        if (path.startsWith('formData.')) fieldErrors[path.slice('formData.'.length)] = detail.message;
        else fieldErrors[path] = detail.message;
      }
      setErrors(fieldErrors);
      setMessage(error.message);
    },
  });

  const blocked = form.isPending || !parsed?.ok || !model;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link className="text-xs text-[var(--fg-muted)] hover:underline" to="/vozila">
            ← Vozila
          </Link>
          <h1 className="text-xl font-semibold">Novo vozilo</h1>
        </div>
      </div>

      {form.error instanceof ApiError && (
        <Card>
          <CardContent>
            <EmptyState
              title="Nema aktivne forme „Vozilo“"
              description={`${form.error.message} Forme se objavljuju u Konfiguracija → Forme; bez objavljene verzije zapis se ne može kreirati (P10).`}
            />
          </CardContent>
        </Card>
      )}

      {parsed && !parsed.ok && !form.error && (
        <Card>
          <CardContent>
            <EmptyState
              title="Definicija forme nije ispravna"
              description={parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}
            />
          </CardContent>
        </Card>
      )}

      {!blocked && model && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});
            setMessage(null);
            submit.mutate();
          }}
        >
          <Card>
            <CardHeader
              title={model.title}
              description={
                form.data
                  ? `Verzija forme v${form.data.version} · ${model.progress.percent}% popunjeno`
                  : undefined
              }
            />
            <CardContent>
              <div className="space-y-4">
                <CoreFields
                  fields={CORE_FIELDS}
                  values={core}
                  errors={errors}
                  onChange={(key, value) => setCore((current) => ({ ...current, [key]: value }))}
                />
                <FormFields
                  model={model}
                  hiddenKeys={HIDDEN_FORM_KEYS}
                  errors={errors}
                  idPrefix="vozilo"
                  onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
                />
              </div>
            </CardContent>
          </Card>

          {message && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {message}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" loading={submit.isPending}>
              Sačuvaj vozilo
            </Button>
            <Link className={buttonClassName('ghost', 'md')} to="/vozila">
              Odustani
            </Link>
          </div>
        </form>
      )}

      {form.isPending && <p className="text-sm text-[var(--fg-muted)]">Učitavanje forme…</p>}
    </div>
  );
}
