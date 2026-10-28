/** Izmjena kompleta zapisnom verzijom forme i optimistic-lock verzijom zapisa. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { parseDefinition } from '@vfm/form-engine/definition';
import { buildRenderModel } from '@vfm/form-renderer';
import { statusLabel } from '@vfm/shared';
import type { FormVersionDetail, TireSetDetail } from '@vfm/shared/schemas';
import { Button, Card, CardContent, CardHeader, Field, inputClassName } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { CoreFields, FormFields } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { TIRE_SET_CORE_FIELDS } from './tire-set-create-form.js';
import { buildTireSetUpdatePayload, tireSetCoreValues, tireSetStatusOptions } from './tire-sets-model.js';

export function TireSetEditPanel({
  tireSetId,
  onClose,
  onSaved,
}: {
  tireSetId: string;
  onClose: () => void;
  onSaved: (updated: TireSetDetail) => Promise<void>;
}) {
  const detailQuery = useQuery({
    queryKey: ['tire-set', tireSetId],
    queryFn: () => api.get<TireSetDetail>(`/tire-sets/${tireSetId}`),
    retry: false,
  });

  const detail = detailQuery.data;
  const needsVersion = Boolean(detail?.formSchemaId && detail?.formSchemaVersionId);
  const versionQuery = useQuery({
    queryKey: ['form-version', detail?.formSchemaId, detail?.formSchemaVersionId],
    queryFn: () =>
      api.get<FormVersionDetail>(
        `/form-schemas/${detail!.formSchemaId}/versions/${detail!.formSchemaVersionId}`,
      ),
    enabled: needsVersion,
    retry: false,
  });

  if (detailQuery.isPending || (needsVersion && versionQuery.isPending)) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--fg-muted)]">Učitavanje kompleta…</p>
        </CardContent>
      </Card>
    );
  }

  if (detailQuery.error || !detail) {
    return (
      <Card>
        <CardHeader title="Izmjena kompleta guma" />
        <CardContent>
          <div className="space-y-3">
            <p role="alert" className="text-sm text-[var(--danger)]">
              {detailQuery.error instanceof ApiError
                ? detailQuery.error.message
                : 'Komplet nije moguće učitati.'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void detailQuery.refetch()}>
                Pokušaj ponovo
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Zatvori
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TireSetEditForm
      key={detail.id}
      detail={detail}
      version={versionQuery.data ?? null}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function TireSetEditForm({
  detail,
  version,
  onClose,
  onSaved,
}: {
  detail: TireSetDetail;
  version: FormVersionDetail | null;
  onClose: () => void;
  onSaved: (updated: TireSetDetail) => Promise<void>;
}) {
  // Snapshot je namjeran: pozadinsko osvježavanje ne smije tiho podići verziju
  // niti prepisati korisnikov unos nakon konflikta.
  const [original] = useState(detail);
  const [core, setCore] = useState<Record<string, string>>(() => tireSetCoreValues(original));
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...original.formData }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const today = useMemo(() => sarajevoToday(), []);

  const model = useMemo(() => {
    if (!version) return null;
    const parsed = parseDefinition(version.definition as unknown);
    if (!parsed.ok) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      today,
      version: version.version,
      formSchemaVersionId: version.id,
    });
  }, [today, values, version]);

  const statusOptions = tireSetStatusOptions(original);
  const statusLocked = Boolean(original.mountedVehicleId) || statusOptions.length === 1;
  const statusHint = original.mountedVehicleId
    ? 'Komplet je montiran; status se mijenja demontažom ili zamjenom.'
    : original.status === 'MOUNTED'
      ? 'Nema aktivne montaže, pa se nekonzistentan status može ispraviti ručno.'
      : original.status === 'SCRAPPED'
        ? 'Otpisan komplet je terminalan; status se više ne mijenja.'
        : 'Status „Montirane“ postavlja isključivo transakcijska montaža.';

  const save = useMutation({
    mutationFn: () =>
      api.patch<TireSetDetail>(
        `/tire-sets/${original.id}`,
        buildTireSetUpdatePayload(original, core, model ? values : undefined),
      ),
    onSuccess: onSaved,
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        setMessage(
          'Komplet je izmijenjen u međuvremenu. Vaš unos je ostao u formi; zatvorite je i ponovo otvorite komplet da učitate novu verziju.',
        );
        return;
      }
      if (error instanceof ApiError) {
        const nextErrors: Record<string, string> = {};
        for (const item of error.details ?? []) {
          const path = item.path.join('.');
          nextErrors[path.startsWith('formData.') ? path.slice('formData.'.length) : path] = item.message;
        }
        setErrors(nextErrors);
      }
      setMessage(error instanceof Error ? error.message : 'Snimanje nije uspjelo.');
    },
  });

  const changeCore = (key: string, value: string) => {
    setCore((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  return (
    <Card>
      <CardHeader
        title={`Izmjena kompleta ${original.code}`}
        description={`Verzija zapisa ${original.version}${
          version ? ` · zapisna forma v${version.version}` : ''
        }. Izmjena ne prevodi zapis na noviju formu.`}
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});
            setMessage('');
            save.mutate();
          }}
        >
          {original.mountedVehicleId && (
            <p className="text-sm text-[var(--fg-muted)]">
              Komplet je trenutno montiran na vozilo{' '}
              <Link className="font-medium hover:underline" to={`/vozila/${original.mountedVehicleId}`}>
                {original.mountedVehicleInternalNo ?? 'otvori vozilo'}
              </Link>
              . Opisne podatke možete ispraviti, ali status i brisanje ostaju zaključani do demontaže.
            </p>
          )}

          {original.formSchemaVersionId && !model && (
            <p role="alert" className="text-sm text-[var(--warning)]">
              Definicija zapisne forme nije dostupna. Strukturirana polja možete mijenjati; dodatna polja se
              neće slati niti mijenjati.
            </p>
          )}
          {!original.formSchemaVersionId && (
            <p className="text-sm text-[var(--fg-muted)]">
              Komplet nema zapisnu verziju forme, pa su dostupna samo strukturirana polja.
            </p>
          )}

          <fieldset disabled={save.isPending} className="space-y-4">
            <CoreFields
              fields={TIRE_SET_CORE_FIELDS}
              values={core}
              errors={errors}
              idPrefix="komplet-guma-izmjena"
              disabled={save.isPending}
              onChange={changeCore}
            />

            <section className="rounded-md border border-[var(--border)] p-3">
              <Field
                label="Status kompleta"
                htmlFor="komplet-guma-izmjena-status"
                hint={statusHint}
                error={errors.status ?? null}
              >
                <select
                  id="komplet-guma-izmjena-status"
                  className={inputClassName}
                  value={core.status ?? original.status}
                  disabled={statusLocked}
                  aria-invalid={errors.status ? true : undefined}
                  onChange={(event) => changeCore('status', event.target.value)}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status, 'tireStatus')}
                    </option>
                  ))}
                </select>
              </Field>
            </section>

            {model && (
              <FormFields
                model={model}
                hiddenKeys={[...TIRE_SET_CORE_FIELDS.map((field) => field.key), 'status']}
                errors={errors}
                idPrefix="komplet-guma-izmjena-dodatno"
                onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
              />
            )}
          </fieldset>

          {message && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {message}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={save.isPending}>
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
