/**
 * Novi vozač (W08, docs/06 §9.1; docs/07 §2.4).
 *
 * Isti obrazac kao unos vozila: strukturirane kolone (`CoreFields`) + dinamička
 * forma `DRIVER` (`FormFields`). PII polja se upisuju kroz API, a server ih
 * redaktuje u audit logu (docs/05 §8) — ekran zato ne prikazuje vrijednosti
 * nakon snimanja, već vodi na profil gdje važi `driver:view_pii`.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import type { ActiveFormSchema, DriverDetail } from '@vfm/shared/schemas';
import { parseDefinition } from '@vfm/form-engine/definition';
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

const CORE_FIELDS: readonly CoreFieldSpec[] = [
  { key: 'firstName', label: 'Ime', kind: 'TEXT', required: true },
  { key: 'lastName', label: 'Prezime', kind: 'TEXT', required: true },
  { key: 'employeeNumber', label: 'Broj zaposlenog', kind: 'TEXT' },
  {
    key: 'employmentStatus',
    label: 'Status zaposlenja',
    kind: 'TEXT',
    hint: 'Šifra iz šifarnika `DRIVER_EMPLOYMENT_STATUS` (npr. STALNI).',
  },
  { key: 'phone', label: 'Telefon', kind: 'TEXT', hint: 'PII — vidljivo uz `driver:view_pii`.' },
  { key: 'email', label: 'E-mail', kind: 'TEXT', hint: 'PII — vidljivo uz `driver:view_pii`.' },
  { key: 'dateOfBirth', label: 'Datum rođenja', kind: 'DATE' },
  { key: 'address', label: 'Adresa', kind: 'TEXT' },
  { key: 'licenseNumber', label: 'Broj vozačke dozvole', kind: 'TEXT' },
  { key: 'licenseIssuedAt', label: 'Dozvola izdana', kind: 'DATE' },
  { key: 'licenseExpiresAt', label: 'Dozvola ističe', kind: 'DATE', hint: 'Nosi podsjetnik i rok.' },
  { key: 'licenseIssuingAuthority', label: 'Izdavalac dozvole', kind: 'TEXT' },
  { key: 'restrictions', label: 'Ograničenja', kind: 'TEXT' },
  { key: 'notes', label: 'Napomena', kind: 'MULTILINE' },
];

const DATE_KEYS = ['dateOfBirth', 'licenseIssuedAt', 'licenseExpiresAt'] as const;

export function DriverCreatePage() {
  const navigate = useNavigate();
  const [core, setCore] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const today = useMemo(() => sarajevoToday(), []);

  const form = useQuery({
    queryKey: ['form-active', 'DRIVER'],
    queryFn: () => api.get<ActiveFormSchema>('/form-schemas/active?subject=DRIVER'),
    retry: false,
  });

  const parsed = useMemo(
    () => (form.data ? parseDefinition(form.data.definition as unknown) : null),
    [form.data],
  );

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
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        firstName: core.firstName?.trim(),
        lastName: core.lastName?.trim(),
        formData: values,
      };
      for (const key of DATE_KEYS) {
        if (core[key]) payload[key] = core[key];
      }
      for (const key of [
        'employeeNumber',
        'employmentStatus',
        'phone',
        'email',
        'address',
        'licenseNumber',
        'licenseIssuingAuthority',
        'restrictions',
        'notes',
      ] as const) {
        if (core[key]?.trim()) payload[key] = core[key]!.trim();
      }
      if (form.data) payload.formSchemaVersionId = form.data.formSchemaVersionId;
      return api.post<DriverDetail>('/drivers', payload);
    },
    onSuccess: (created) => navigate(`/vozaci/${created.id}`),
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        setMessage('Greška pri snimanju vozača.');
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
    <div className="vfm-module-page">
      <div>
        <Link className="text-xs text-fg-muted hover:underline" to="/vozaci">
          ← Vozači
        </Link>
        <h1 className="vfm-module-title">Novi vozač</h1>
      </div>

      {form.isError && (
        <Card>
          <CardContent>
            <div role="alert">
              <EmptyState
                title={
                  form.error instanceof ApiError
                    ? 'Nema aktivne forme „Vozač“'
                    : 'Greška pri učitavanju forme'
                }
                description={`${form.error instanceof ApiError ? form.error.message : 'Provjerite vezu i pokušajte ponovo.'} Forme se objavljuju u Konfiguracija → Forme; bez dostupne verzije zapis se ne može kreirati (P10).`}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {parsed && !parsed.ok && !form.error && (
        <Card>
          <CardContent>
            <div role="alert">
              <EmptyState
                title="Definicija forme nije ispravna"
                description={parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}
              />
            </div>
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
                  errors={errors}
                  idPrefix="vozac"
                  onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
                />
              </div>
            </CardContent>
          </Card>

          {message && (
            <p role="alert" className="text-sm text-danger">
              {message}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" loading={submit.isPending}>
              Sačuvaj vozača
            </Button>
            <Link className={buttonClassName('ghost', 'md')} to="/vozaci">
              Odustani
            </Link>
          </div>
        </form>
      )}

      {form.isPending && (
        <p role="status" className="text-sm text-fg-muted">
          Učitavanje forme…
        </p>
      )}
    </div>
  );
}
