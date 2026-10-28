/**
 * Izmjena vozila (W06, docs/06 §9.1; docs/07 §2.5).
 *
 * P10/P11: zapis se **ne** prevodi na novu verziju forme. Forma se učitava iz
 * `vehicle.formSchemaVersionId` (verzija kojom je zapis nastao), a ne iz
 * `GET /form-schemas/active` — objavljena verzija je nepromjenjiva, a zapis
 * ostaje čitljiv i kad forma dobije novu verziju.
 *
 * Optimističko zaključavanje: `PATCH` nosi `version`; ako je neko drugi
 * sačuvao izmjenu, server vraća `409 VERSION_CONFLICT` i ekran to kaže bez
 * gubljenja unosa.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import type { FormVersionDetail, VehicleDetail } from '@vfm/shared/schemas';
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
import { CoreFields, FormFields } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { VEHICLE_CORE_FIELDS, VEHICLE_HIDDEN_FORM_KEYS } from './vehicle-form-config.js';

export function VehicleEditPage() {
  const { vehicleId = '' } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);

  const vehicleQuery = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
    enabled: vehicleId !== '',
  });

  const versionQuery = useQuery({
    queryKey: ['form-version', vehicleQuery.data?.formSchemaId, vehicleQuery.data?.formSchemaVersionId],
    queryFn: () =>
      api.get<FormVersionDetail>(
        `/form-schemas/${vehicleQuery.data!.formSchemaId}/versions/${vehicleQuery.data!.formSchemaVersionId}`,
      ),
    enabled: Boolean(vehicleQuery.data?.formSchemaId && vehicleQuery.data?.formSchemaVersionId),
    retry: false,
  });

  if (vehicleQuery.isPending || versionQuery.isPending) {
    return <p className="text-sm text-[var(--fg-muted)]">Učitavanje…</p>;
  }

  if (vehicleQuery.error || !vehicleQuery.data) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--danger)]">
            {vehicleQuery.error instanceof ApiError ? vehicleQuery.error.message : 'Vozilo nije pronađeno.'}
          </p>
          <Link className="mt-2 inline-block text-sm hover:underline" to="/vozila">
            ← Natrag na listu
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (versionQuery.error || !versionQuery.data) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            title="Verzija forme nije dostupna"
            description="Zapis nosi verziju forme koja više ne postoji ili nemate pravo `form:view`. Izmjena bez definicije forme ne bi bila validna (P10)."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <VehicleEditForm
      vehicle={vehicleQuery.data}
      version={versionQuery.data}
      message={message}
      onMessage={setMessage}
      onSaved={(updated) => navigate(`/vozila/${updated.id}`)}
    />
  );
}

function VehicleEditForm({
  vehicle,
  version,
  message,
  onMessage,
  onSaved,
}: {
  vehicle: VehicleDetail;
  version: FormVersionDetail;
  message: string | null;
  onMessage: (value: string | null) => void;
  onSaved: (vehicle: VehicleDetail) => void;
}) {
  const [core, setCore] = useState<Record<string, string>>(() => ({
    internalNo: vehicle.internalNo,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year === null ? '' : String(vehicle.year),
    vin: vehicle.vin ?? '',
    fuelType: vehicle.fuelType,
  }));
  const [values, setValues] = useState<Record<string, unknown>>(
    () => (vehicle.formData ?? {}) as Record<string, unknown>,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const today = useMemo(() => sarajevoToday(), []);

  const parsed = useMemo(() => parseDefinition(version.definition as unknown), [version.definition]);

  const definitionError = useMemo(
    () => (parsed.ok ? null : parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')),
    [parsed],
  );

  const model = useMemo<RenderModel | null>(() => {
    if (!parsed.ok) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      today,
      version: version.version,
      formSchemaVersionId: version.id,
    });
  }, [parsed, values, today, version]);

  const text = (key: string): string => (core[key] ?? '').trim();

  const submit = useMutation({
    mutationFn: () =>
      api.patch<VehicleDetail>(`/vehicles/${vehicle.id}`, {
        version: vehicle.version,
        internalNo: text('internalNo'),
        make: text('make'),
        model: text('model'),
        // Prazna godina/VIN se šalju kao `null` — inače se „obriši" ne bi moglo.
        year: text('year') === '' ? null : Number(text('year')),
        vin: text('vin') === '' ? null : text('vin').toUpperCase(),
        fuelType: core.fuelType ?? 'DIESEL',
        formData: values,
      }),
    onSuccess: (updated) => onSaved(updated),
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        onMessage('Greška pri snimanju vozila.');
        return;
      }
      if (error.code === 'VERSION_CONFLICT') {
        onMessage('Vozilo je izmijenjeno u međuvremenu — osvježite stranicu pa ponovite izmjenu.');
        return;
      }
      const fieldErrors: Record<string, string> = {};
      for (const detail of error.details ?? []) {
        const path = detail.path.join('.');
        if (path.startsWith('formData.')) fieldErrors[path.slice('formData.'.length)] = detail.message;
        else fieldErrors[path] = detail.message;
      }
      setErrors(fieldErrors);
      onMessage(error.message);
    },
  });

  return (
    <div className="vfm-module-page">
      <div>
        <Link className="text-xs text-[var(--fg-muted)] hover:underline" to={`/vozila/${vehicle.id}`}>
          ← {vehicle.internalNo}
        </Link>
        <h1 className="vfm-module-title">Izmjena vozila</h1>
        <p className="text-sm text-[var(--fg-muted)]">
          Verzija forme v{version.version} · verzija zapisa {vehicle.version}
        </p>
      </div>

      {vehicle.status === 'ARCHIVED' && (
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--warning)]">
              Arhivirano vozilo se ne mijenja — prvo ga vratite iz arhive.
            </p>
          </CardContent>
        </Card>
      )}

      {model === null ? (
        <Card>
          <CardContent>
            <EmptyState title="Definicija forme nije ispravna" description={definitionError ?? ''} />
          </CardContent>
        </Card>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});
            onMessage(null);
            submit.mutate();
          }}
        >
          <Card>
            <CardHeader
              title={model.title}
              description={`Verzija forme v${version.version} · ${model.progress.percent}% popunjeno`}
            />
            <CardContent>
              <div className="space-y-4">
                <CoreFields
                  fields={VEHICLE_CORE_FIELDS}
                  values={core}
                  errors={errors}
                  onChange={(key, value) => setCore((current) => ({ ...current, [key]: value }))}
                />
                <FormFields
                  model={model}
                  hiddenKeys={VEHICLE_HIDDEN_FORM_KEYS}
                  errors={errors}
                  idPrefix="vozilo-izmjena"
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
              Sačuvaj izmjene
            </Button>
            <Link className={buttonClassName('ghost', 'md')} to={`/vozila/${vehicle.id}`}>
              Odustani
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
