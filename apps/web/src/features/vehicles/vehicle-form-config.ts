/**
 * Strukturirane kolone vozila (W06/W07) — jedan izvor za unos i izmjenu.
 *
 * Vozilo ima **dva** sloja podataka (docs/04 §7):
 * 1. kolone tabele (interni broj, marka, model, godina, VIN, gorivo) — statične
 *    kontrole, jer identitet vozila ne dolazi iz dinamičke forme;
 * 2. ostatak zapisa — dinamička forma `VEHICLE`.
 *
 * `VEHICLE_HIDDEN_FORM_KEYS` sprječava da forma prikaže istu vrijednost drugi
 * put (seed forma ponavlja `internalNo`, `make`, `model`, `year`, `fuelType`,
 * `plateNumber`, `odometerKm`).
 */
import { FUEL_TYPES, statusLabel } from '@vfm/shared';
import type { CoreFieldSpec } from '../forms/form-fields.js';

export const VEHICLE_CORE_FIELDS: readonly CoreFieldSpec[] = [
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

/** Ključevi koje forma ne prikazuje ponovo (kolone se unose iznad). */
export const VEHICLE_HIDDEN_FORM_KEYS = VEHICLE_CORE_FIELDS.map((field) => field.key);
