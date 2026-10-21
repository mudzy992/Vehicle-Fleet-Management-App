/** Demontaža aktivnog kompleta; server računa snapshot km/dana iz zaključanog zapisa. */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TIRE_DISMOUNT_REASONS, formatDate, statusLabel } from '@vfm/shared';
import type { TireInstallationView } from '@vfm/shared/schemas';
import { Button, Field, inputClassName } from '../../components/ui/index.js';
import { api, ApiError } from '../../lib/api.js';
import { sarajevoToday } from '../forms/forms-preview-values.js';
import { buildDismountPayload } from './tire-installation-model.js';

export function TireDismountForm({
  installation,
  vehicleOdometerKm,
  onSaved,
  onCancel,
}: {
  installation: TireInstallationView;
  vehicleOdometerKm: number;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const today = sarajevoToday();
  const [date, setDate] = useState(today);
  const [odometerKm, setOdometerKm] = useState(
    String(Math.max(vehicleOdometerKm, installation.mountedOdometerKm)),
  );
  const [reason, setReason] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [message, setMessage] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.post<TireInstallationView>(
        `/tire-installations/${installation.id}/dismount`,
        buildDismountPayload({
          version: installation.version,
          date,
          odometerKm,
          reason,
          storageLocation,
        }),
      ),
    onSuccess: onSaved,
    onError: (error) =>
      setMessage(
        error instanceof ApiError || error instanceof Error ? error.message : 'Demontaža nije uspjela.',
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
      <p className="text-sm text-[var(--fg-muted)]">
        Komplet <strong className="text-[var(--fg)]">{installation.setCode}</strong> montiran je{' '}
        {formatDate(installation.mountedAt)} na {installation.mountedOdometerKm.toLocaleString('bs-BA')} km.
        Demontažom se trajno zaključava ovaj ciklus i računaju pređeni kilometri i dani.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Datum demontaže *" htmlFor="demontaza-datum">
          <input
            id="demontaza-datum"
            className={inputClassName}
            type="date"
            value={date}
            min={installation.mountedAt}
            max={today}
            disabled={save.isPending}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field
          label="Kilometraža vozila (km) *"
          htmlFor="demontaza-km"
          hint={`Trenutna evidencija vozila: ${vehicleOdometerKm.toLocaleString('bs-BA')} km.`}
        >
          <input
            id="demontaza-km"
            className={inputClassName}
            inputMode="numeric"
            value={odometerKm}
            disabled={save.isPending}
            onChange={(event) => setOdometerKm(event.target.value.replace(/[^0-9]/gu, ''))}
          />
        </Field>
        <Field label="Razlog" htmlFor="demontaza-razlog">
          <select
            id="demontaza-razlog"
            className={inputClassName}
            value={reason}
            disabled={save.isPending}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="">— Bez razloga —</option>
            {TIRE_DISMOUNT_REASONS.map((item) => (
              <option key={item} value={item}>
                {statusLabel(item, 'tireDismountReason')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Skladište nakon demontaže" htmlFor="demontaza-skladiste">
          <input
            id="demontaza-skladiste"
            className={inputClassName}
            value={storageLocation}
            disabled={save.isPending}
            onChange={(event) => setStorageLocation(event.target.value)}
          />
        </Field>
      </div>

      {message && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Demontiraj komplet
        </Button>
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>
          Odustani
        </Button>
      </div>
    </form>
  );
}
