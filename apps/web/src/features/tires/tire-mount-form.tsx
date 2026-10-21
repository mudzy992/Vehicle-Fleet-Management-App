/** Montaža ili zamjena kompleta kroz aktivnu objavljenu TIRE_INSTALLATION formu. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { parseDefinition } from '@vfm/form-engine';
import { buildRenderModel } from '@vfm/form-renderer';
import { TIRE_DISMOUNT_REASONS, formatDate, statusLabel, type TirePosition } from '@vfm/shared';
import type {
  ActiveFormSchema,
  TireInstallationView,
  TireSetListResponse,
  TireSetView,
  TireSwapResponse,
} from '@vfm/shared/schemas';
import { Button, Field, inputClassName } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { FormFields } from '../forms/form-fields.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { toQueryString } from '../vehicles/vehicles-model.js';
import {
  TIRE_POSITION_ORDER,
  buildMountPayload,
  buildSwapPayload,
  defaultTirePositions,
  toggleTirePosition,
} from './tire-installation-model.js';
import { DEFAULT_TIRE_SET_FILTERS, buildTireSetQuery } from './tire-sets-model.js';

const HIDDEN_FORM_KEYS = [
  'mountedAt',
  'mountedOdometerKm',
  'positions',
  'dismountedAt',
  'dismountedOdometerKm',
  'kmDriven',
  'daysInUse',
] as const;

export function TireMountForm({
  vehicleId,
  vehicleOdometerKm,
  currentInstallation,
  onSaved,
  onCancel,
}: {
  vehicleId: string;
  vehicleOdometerKm: number;
  currentInstallation?: TireInstallationView;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const isSwap = currentInstallation !== undefined;
  const today = sarajevoToday();
  const [setSearch, setSetSearch] = useState('');
  const [selectedSet, setSelectedSet] = useState<TireSetView | null>(null);
  const [date, setDate] = useState(today);
  const [odometerKm, setOdometerKm] = useState(
    String(Math.max(vehicleOdometerKm, currentInstallation?.mountedOdometerKm ?? 0)),
  );
  const [positions, setPositions] = useState<TirePosition[]>(
    defaultTirePositions(4, currentInstallation?.positions ?? []),
  );
  const [reason, setReason] = useState('SEASONAL_SWAP');
  const [storageLocation, setStorageLocation] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState('');

  const setsQuery = useMemo(
    () =>
      buildTireSetQuery(
        { ...DEFAULT_TIRE_SET_FILTERS, q: setSearch, status: 'IN_STOCK', availableOnly: true },
        1,
        25,
      ),
    [setSearch],
  );
  const sets = useQuery({
    queryKey: ['tire-sets', 'available-for-mount', setsQuery],
    queryFn: () => api.get<TireSetListResponse>(`/tire-sets?${toQueryString(setsQuery)}`),
  });
  const form = useQuery({
    queryKey: ['form-active', 'TIRE_INSTALLATION'],
    queryFn: () => api.get<ActiveFormSchema>('/form-schemas/active?subject=TIRE_INSTALLATION'),
    retry: false,
  });

  const model = useMemo(() => {
    if (!form.data) return null;
    const parsed = parseDefinition(form.data.definition);
    if (!parsed.ok) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      today,
      version: form.data.version,
      formSchemaVersionId: form.data.formSchemaVersionId,
    });
  }, [form.data, today, values]);

  const options = useMemo(() => {
    const items = sets.data?.items ?? [];
    return selectedSet && !items.some((item) => item.id === selectedSet.id) ? [selectedSet, ...items] : items;
  }, [selectedSet, sets.data]);

  const save = useMutation<TireInstallationView | TireSwapResponse, unknown, void>({
    mutationFn: async () => {
      if (!form.data) throw new Error('Objavljena forma montaže nije učitana.');
      if (!selectedSet) throw new Error('Odaberite komplet.');
      if (currentInstallation) {
        return api.post<TireSwapResponse>(
          '/tire-installations/swap',
          buildSwapPayload({
            vehicleId,
            currentInstallationId: currentInstallation.id,
            currentVersion: currentInstallation.version,
            newSetId: selectedSet.id,
            date,
            odometerKm,
            positions,
            reason,
            storageLocation,
            formData: values,
            formSchemaVersionId: form.data.formSchemaVersionId,
          }),
        );
      }
      return api.post<TireInstallationView>(
        '/tire-installations',
        buildMountPayload({
          vehicleId,
          setId: selectedSet.id,
          date,
          odometerKm,
          positions,
          formData: values,
          formSchemaVersionId: form.data.formSchemaVersionId,
        }),
      );
    },
    onSuccess: onSaved,
    onError: (error) =>
      setMessage(
        error instanceof ApiError || error instanceof Error ? error.message : 'Snimanje nije uspjelo.',
      ),
  });

  const chooseSet = (setId: string) => {
    const next = options.find((item) => item.id === setId) ?? null;
    setSelectedSet(next);
    if (next) {
      setPositions(defaultTirePositions(next.tireCount, currentInstallation?.positions ?? []));
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage('');
        save.mutate();
      }}
    >
      {currentInstallation && (
        <p className="text-sm text-[var(--fg-muted)]">
          Trenutni komplet: <strong className="text-[var(--fg)]">{currentInstallation.setCode}</strong>{' '}
          montiran {formatDate(currentInstallation.mountedAt)} na{' '}
          {currentInstallation.mountedOdometerKm.toLocaleString('bs-BA')} km.
        </p>
      )}

      <section className="space-y-3 rounded-md border border-[var(--border)] p-3">
        <header>
          <h3 className="text-sm font-medium">{isSwap ? 'Novi komplet' : 'Komplet za montažu'}</h3>
          <p className="text-xs text-[var(--fg-muted)]">
            Prikazuju se samo kompleti na skladištu bez aktivne montaže. Server izbor ponovo provjerava pod
            zaključanim redovima.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pretraga kompleta" htmlFor="montaza-pretraga">
            <input
              id="montaza-pretraga"
              className={inputClassName}
              placeholder="Kod, marka, model ili dimenzija"
              value={setSearch}
              disabled={save.isPending}
              onChange={(event) => setSetSearch(event.target.value)}
            />
          </Field>
          <Field label="Komplet *" htmlFor="montaza-komplet">
            <select
              id="montaza-komplet"
              className={inputClassName}
              value={selectedSet?.id ?? ''}
              disabled={save.isPending || sets.isPending}
              onChange={(event) => chooseSet(event.target.value)}
            >
              <option value="">— Odaberite komplet —</option>
              {options.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.code} · {[set.brand, set.model, set.size].filter(Boolean).join(' ') || 'bez opisa'} ·{' '}
                  {statusLabel(set.season, 'tireSeason')}
                </option>
              ))}
            </select>
          </Field>
          <Field label={isSwap ? 'Datum zamjene *' : 'Datum montaže *'} htmlFor="montaza-datum">
            <input
              id="montaza-datum"
              className={inputClassName}
              type="date"
              value={date}
              max={today}
              disabled={save.isPending}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field
            label="Kilometraža vozila (km) *"
            htmlFor="montaza-km"
            hint={`Trenutna evidencija vozila: ${vehicleOdometerKm.toLocaleString('bs-BA')} km.`}
          >
            <input
              id="montaza-km"
              className={inputClassName}
              inputMode="numeric"
              value={odometerKm}
              disabled={save.isPending}
              onChange={(event) => setOdometerKm(event.target.value.replace(/[^0-9]/gu, ''))}
            />
          </Field>
          {currentInstallation && (
            <>
              <Field label="Razlog demontaže starog kompleta" htmlFor="zamjena-razlog">
                <select
                  id="zamjena-razlog"
                  className={inputClassName}
                  value={reason}
                  disabled={save.isPending}
                  onChange={(event) => setReason(event.target.value)}
                >
                  {TIRE_DISMOUNT_REASONS.map((item) => (
                    <option key={item} value={item}>
                      {statusLabel(item, 'tireDismountReason')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Skladište starog kompleta" htmlFor="zamjena-skladiste">
                <input
                  id="zamjena-skladiste"
                  className={inputClassName}
                  value={storageLocation}
                  disabled={save.isPending}
                  onChange={(event) => setStorageLocation(event.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        {sets.error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {sets.error instanceof ApiError ? sets.error.message : 'Dostupni kompleti se ne mogu učitati.'}
          </p>
        ) : sets.isPending ? (
          <p className="text-sm text-[var(--fg-muted)]">Učitavanje dostupnih kompleta…</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-[var(--fg-muted)]">Nema dostupnih kompleta za odabranu pretragu.</p>
        ) : selectedSet ? (
          <p className="text-xs text-[var(--fg-muted)]">
            Odabran komplet ima {selectedSet.tireCount} guma
            {selectedSet.currentLocation ? ` · lokacija: ${selectedSet.currentLocation}` : ''}.
          </p>
        ) : null}

        <fieldset>
          <legend className="text-xs font-medium text-[var(--fg-muted)]">Pozicije novog kompleta *</legend>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {TIRE_POSITION_ORDER.map((position) => (
              <label key={position} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={positions.includes(position)}
                  disabled={save.isPending}
                  onChange={(event) =>
                    setPositions((current) => toggleTirePosition(current, position, event.target.checked))
                  }
                />
                {statusLabel(position, 'tirePosition')}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      {form.isPending ? (
        <p className="text-sm text-[var(--fg-muted)]">Učitavanje forme montaže…</p>
      ) : !model ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          Nema ispravne objavljene forme TIRE_INSTALLATION. Pokrenite seed ili objavite formu u
          administraciji.
        </p>
      ) : (
        <FormFields
          model={model}
          hiddenKeys={HIDDEN_FORM_KEYS}
          errors={{}}
          idPrefix="montaza-dodatno"
          onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
        />
      )}

      {message && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!model || !selectedSet} loading={save.isPending}>
          {isSwap ? 'Potvrdi zamjenu' : 'Montiraj komplet'}
        </Button>
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>
          Odustani
        </Button>
      </div>
    </form>
  );
}
