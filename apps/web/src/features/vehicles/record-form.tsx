/**
 * Unos registracije / osiguranja s profila vozila (W05/W06, docs/07 §2.6).
 *
 * Isti obrazac kao unos vozila i vozača: kolone koje nose pretrage i rokove
 * (`validFrom`, `validUntil`, brojevi, iznosi) su statične kontrole, a ostatak
 * zapisa dolazi iz dinamičke forme (`REGISTRATION` / `INSURANCE`) kroz
 * `FormFields`. Forma se ne duplira u kodu: polja koja su već statična se
 * skrivaju (`hiddenKeys`).
 *
 * Server je autoritet za preklapanje perioda (B-10): `409 PERIOD_OVERLAP` se
 * prikazuje kao poruka s brojem postojećeg zapisa, a ne kao generička greška.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ActiveFormSchema } from '@vfm/shared/schemas';
import { parseDefinition } from '@vfm/form-engine';
import type { RenderModel } from '@vfm/form-renderer';
import { buildRenderModel } from '@vfm/form-renderer';
import { Button, Card, CardContent, CardHeader } from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { CoreFields, FormFields, type CoreFieldSpec } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { defaultPeriod, isPeriodOverlap, moneyToFeninzi } from './records-model.js';

export type RecordKind = 'REGISTRATION' | 'INSURANCE';

interface FieldSpec extends CoreFieldSpec {
  /** Polje je iznos u KM koje se u API šalje u feningama. */
  readonly money?: boolean;
}

const COMMON_FIELDS: readonly FieldSpec[] = [
  { key: 'validFrom', label: 'Važi od', kind: 'DATE', required: true },
  { key: 'validUntil', label: 'Važi do', kind: 'DATE', required: true, hint: 'Uključivo.' },
  { key: 'notes', label: 'Napomena', kind: 'MULTILINE' },
];

const FIELDS: Readonly<Record<RecordKind, readonly FieldSpec[]>> = {
  REGISTRATION: [
    { key: 'registrationNumber', label: 'Registarski broj', kind: 'TEXT', required: true },
    ...COMMON_FIELDS,
    { key: 'issuedBy', label: 'Izdavao', kind: 'TEXT' },
    { key: 'costAmount', label: 'Trošak (KM)', kind: 'TEXT', money: true },
  ],
  INSURANCE: [
    { key: 'policyNumber', label: 'Broj police', kind: 'TEXT' },
    { key: 'insuranceCompany', label: 'Osiguravajuća kuća', kind: 'TEXT' },
    { key: 'type', label: 'Vrsta pokrića', kind: 'TEXT', hint: 'npr. KASKO, ODGOVORNOST' },
    ...COMMON_FIELDS,
    { key: 'premiumAmount', label: 'Premija (KM)', kind: 'TEXT', money: true },
    { key: 'deductibleAmount', label: 'Franšiza (KM)', kind: 'TEXT', money: true },
  ],
};

const ENDPOINT: Readonly<Record<RecordKind, string>> = {
  REGISTRATION: '/registrations',
  INSURANCE: '/insurances',
};

/** Vrijednosti iz forme jesu stringovi; prazna polja se ne šalju. */
function buildPayload(
  kind: RecordKind,
  vehicleId: string,
  core: Readonly<Record<string, string>>,
  formData: Readonly<Record<string, unknown>>,
  formSchemaVersionId: string,
): Record<string, unknown> {
  const fields = FIELDS[kind];
  const payload: Record<string, unknown> = { vehicleId, formData, formSchemaVersionId };
  for (const field of fields) {
    const raw = (core[field.key] ?? '').trim();
    if (field.money) {
      const amount = moneyToFeninzi(raw);
      if (amount !== null) payload[field.key] = amount;
      continue;
    }
    if (raw !== '') payload[field.key] = raw;
  }
  return payload;
}

export function VehicleRecordForm({
  kind,
  vehicleId,
  onCreated,
}: {
  kind: RecordKind;
  vehicleId: string;
  onCreated: () => Promise<void> | void;
}) {
  const today = useMemo(() => sarajevoToday(), []);
  const period = useMemo(() => defaultPeriod(today), [today]);
  const [core, setCore] = useState<Record<string, string>>(() => ({
    validFrom: period.validFrom,
    validUntil: period.validUntil,
  }));
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<string | null>(null);

  const form = useQuery({
    queryKey: ['form-active', kind],
    queryFn: () => api.get<ActiveFormSchema>(`/form-schemas/active?subject=${kind}`),
    retry: false,
  });

  const parsed = useMemo(() => (form.data ? parseDefinition(form.data.definition) : null), [form.data]);

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
      api.post<unknown>(
        ENDPOINT[kind],
        buildPayload(kind, vehicleId, core, values, form.data!.formSchemaVersionId),
      ),
    onSuccess: async () => {
      setCore({ validFrom: period.validFrom, validUntil: period.validUntil });
      setValues({});
      setErrors({});
      setMessage(null);
      setOverlap(null);
      await onCreated();
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        setMessage('Greška pri snimanju evidencije.');
        return;
      }
      if (isPeriodOverlap(error.code)) {
        setOverlap(error.message);
        return;
      }
      setOverlap(null);
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

  const label = kind === 'REGISTRATION' ? 'Nova registracija' : 'Novo osiguranje';

  if (form.error instanceof ApiError) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--warning)]">
            Nema aktivne forme „{label}“: {form.error.message} Bez objavljene verzije zapis ne može nastati
            (P10).
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!model) return <p className="text-sm text-[var(--fg-muted)]">Učitavanje forme…</p>;

  return (
    <Card>
      <CardHeader
        title={label}
        description={`Verzija forme v${form.data!.version} · podrazumijevani period ${period.validFrom} – ${period.validUntil}`}
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});
            setMessage(null);
            setOverlap(null);
            submit.mutate();
          }}
        >
          <CoreFields
            fields={FIELDS[kind]}
            values={core}
            errors={errors}
            idPrefix={`${kind.toLowerCase()}-`}
            onChange={(key, value) => setCore((current) => ({ ...current, [key]: value }))}
          />
          <FormFields
            model={model}
            hiddenKeys={FIELDS[kind].map((field) => field.key)}
            errors={errors}
            idPrefix={kind.toLowerCase()}
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />

          {overlap && (
            <div role="alert" className="rounded-md border border-[var(--danger)] p-3">
              <p className="text-sm font-medium text-[var(--danger)]">Period se preklapa</p>
              <p className="text-xs text-[var(--fg-muted)]">
                {overlap} Zatvorite prethodnu evidenciju („Važi do“) prije nego što dodate novu.
              </p>
            </div>
          )}

          {message && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {message}
            </p>
          )}

          <Button type="submit" size="sm" loading={submit.isPending}>
            Sačuvaj
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
