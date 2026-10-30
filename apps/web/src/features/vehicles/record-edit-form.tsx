/**
 * Izmjena i brisanje registracije / osiguranja (W05/W06, docs/07 §2.6).
 *
 * Pravila koja ekran poštuje:
 * - **`version`** ide uz svaki `PATCH`; paralelna izmjena daje
 *   `409 VERSION_CONFLICT` i poruku da se osvježi stranica (bez gubljenja unosa).
 * - **period** se ne smije preklopiti s drugim zapisom istog vozila — servis i
 *   `EXCLUDE` constraint vraćaju `409 PERIOD_OVERLAP`; ekran to prikaže kao
 *   poruku, ne kao „nešto je puklo".
 * - **brisanje** je soft-delete (`DELETE` je `CRITICAL` u audit logu): zapis
 *   nestaje iz liste, ali trag ostaje. Zato traži potvrdu.
 * - **status** se mijenja samo kroz dozvoljene prelaze (`RECORD_STATUS_TRANSITIONS`);
 *   nedozvoljen prelaz vraća `VALIDATION_ERROR` s listom dozvoljenih.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { RECORD_STATUSES, statusLabel } from '@vfm/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  ConfirmModal,
  Field,
  inputClassName,
} from '../../components/ui/index.js';
import { ApiError, api } from '../../lib/api.js';
import { useSession } from '../auth/session.js';
import { CoreFields } from '../forms/form-fields.js';
import { isPeriodOverlap } from './records-model.js';
import {
  RECORD_ENDPOINT,
  RECORD_FIELDS,
  buildUpdatePayload,
  recordToCoreValues,
  type RecordKind,
} from './records-fields.js';

export interface EditableRecord {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly [key: string]: unknown;
}

export function VehicleRecordEditForm({
  kind,
  record,
  onDone,
  onCancel,
}: {
  kind: RecordKind;
  record: EditableRecord;
  onDone: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const { hasPermission } = useSession();
  const canDelete = hasPermission(kind === 'REGISTRATION' ? 'registration:delete' : 'insurance:delete');
  const [core, setCore] = useState<Record<string, string>>(() => recordToCoreValues(kind, record));
  const [status, setStatus] = useState(record.status);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.patch<unknown>(
        `${RECORD_ENDPOINT[kind]}/${record.id}`,
        buildUpdatePayload(kind, record, core, status),
      ),
    onSuccess: () => onDone(),
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        setMessage('Greška pri snimanju evidencije.');
        return;
      }
      if (isPeriodOverlap(error.code)) {
        setOverlap(error.message);
        setMessage(null);
        return;
      }
      setOverlap(null);
      const fieldErrors: Record<string, string> = {};
      for (const detail of error.details ?? []) fieldErrors[detail.path.join('.')] = detail.message;
      setErrors(fieldErrors);
      setMessage(
        error.code === 'VERSION_CONFLICT'
          ? 'Evidencija je izmijenjena u međuvremenu — osvježite stranicu pa ponovite izmjenu.'
          : error.message,
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete<null>(`${RECORD_ENDPOINT[kind]}/${record.id}`),
    onSuccess: () => onDone(),
    onError: (error) =>
      setMessage(error instanceof ApiError ? error.message : 'Greška pri brisanju evidencije.'),
  });

  const label = kind === 'REGISTRATION' ? 'registraciju' : 'osiguranje';

  return (
    <>
    <Card>
      <CardHeader
        title={kind === 'REGISTRATION' ? 'Izmjena registracije' : 'Izmjena osiguranja'}
        description={`Verzija zapisa ${record.version}. Period ne smije preklopiti drugi zapis istog vozila.`}
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});
            setMessage(null);
            setOverlap(null);
            save.mutate();
          }}
        >
          <CoreFields
            fields={RECORD_FIELDS[kind]}
            values={core}
            errors={errors}
            idPrefix={`${kind.toLowerCase()}-izmjena-`}
            onChange={(key, value) => setCore((current) => ({ ...current, [key]: value }))}
          />

          <Field label="Status" htmlFor={`${kind}-status`} hint="Samo dozvoljeni prelazi.">
            <select
              id={`${kind}-status`}
              className={inputClassName}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {RECORD_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value, 'record')}
                </option>
              ))}
            </select>
          </Field>

          {overlap && (
              <div role="alert" className="rounded-md border border-danger p-3">
                <p className="text-sm font-medium text-danger">Period se preklapa</p>
                <p className="text-xs text-fg-muted">{overlap}</p>
            </div>
          )}

          {message && (
              <p role="alert" className="text-sm text-danger">
              {message}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              Sačuvaj izmjene
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Odustani
            </Button>
            {canDelete && (
              <Button
                type="button"
                size="sm"
                variant="danger"
                loading={remove.isPending}
                  onClick={() => setDeleteConfirmOpen(true)}
              >
                Obriši
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
      <ConfirmModal
        open={deleteConfirmOpen}
        title={`Obrisati ${label}?`}
        description="Zapis se soft-briše iz aktivne evidencije, a ostaje sačuvan u historiji i audit tragu."
        confirmLabel="Obriši zapis"
        busy={remove.isPending}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
