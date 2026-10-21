/** Čista logika liste i unosa kompleta guma; server ostaje autoritet. */
import { TIRE_SEASONS } from '@vfm/shared';
import { moneyToFeninzi } from '../vehicles/records-model.js';

export interface TireSetFilters {
  readonly q: string;
  readonly season: string;
  readonly status: string;
  readonly availableOnly: boolean;
  readonly sortBy: string;
  readonly sortOrder: 'asc' | 'desc';
}

export const DEFAULT_TIRE_SET_FILTERS: TireSetFilters = {
  q: '',
  season: '',
  status: '',
  availableOnly: false,
  sortBy: 'code',
  sortOrder: 'asc',
};

export function buildTireSetQuery(
  filters: TireSetFilters,
  page: number,
  pageSize: number,
): Record<string, string | number> {
  const query: Record<string, string | number> = {
    page,
    pageSize,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  };
  if (filters.q.trim()) query.q = filters.q.trim();
  if (filters.season) query.season = filters.season;
  if (filters.status) query.status = filters.status;
  if (filters.availableOnly) query.availableOnly = 'true';
  return query;
}

function addText(
  payload: Record<string, unknown>,
  core: Readonly<Record<string, string>>,
  key: string,
): void {
  const value = (core[key] ?? '').trim();
  if (value) payload[key] = value;
}

/** Strukturirana polja forme → DTO; cijena iz KM ide u feninge kao cijeli broj. */
export function buildTireSetPayload(
  core: Readonly<Record<string, string>>,
  formData: Readonly<Record<string, unknown>>,
  formSchemaVersionId: string,
): Record<string, unknown> {
  const code = (core.code ?? '').trim();
  if (!code) throw new Error('Kod kompleta je obavezan.');

  const season = (core.season ?? '').trim();
  if (!TIRE_SEASONS.includes(season as (typeof TIRE_SEASONS)[number])) {
    throw new Error('Odaberite sezonu kompleta.');
  }

  const tireCountRaw = (core.tireCount ?? '').trim() || '4';
  if (!/^\d+$/u.test(tireCountRaw)) throw new Error('Broj guma mora biti cijeli broj od 1 do 8.');
  const tireCount = Number(tireCountRaw);
  if (tireCount < 1 || tireCount > 8) throw new Error('Broj guma mora biti cijeli broj od 1 do 8.');

  const payload: Record<string, unknown> = {
    code,
    season,
    tireCount,
    formData,
    formSchemaVersionId,
  };
  for (const key of ['brand', 'model', 'size', 'purchaseDate', 'currentLocation', 'notes']) {
    addText(payload, core, key);
  }

  const priceRaw = (core.purchasePrice ?? '').trim();
  if (priceRaw) {
    const purchasePrice = moneyToFeninzi(priceRaw);
    if (purchasePrice === null || purchasePrice > 2147483647) {
      throw new Error('Unesite ispravnu nenegativnu nabavnu cijenu u KM.');
    }
    payload.purchasePrice = purchasePrice;
  }

  return payload;
}
