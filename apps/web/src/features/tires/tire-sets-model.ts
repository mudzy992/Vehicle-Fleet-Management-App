/** Čista logika liste, unosa i izmjene kompleta te pojedinačnih guma; server ostaje autoritet. */
import {
  TIRE_POSITIONS,
  TIRE_SEASONS,
  TIRE_SET_MANUAL_STATUS_TRANSITIONS,
  type TirePosition,
  type TireStatus,
} from '@vfm/shared';
import type { TireSetDetail, TireView } from '@vfm/shared/schemas';
import { feninziToInput, moneyToFeninzi } from '../vehicles/records-model.js';

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

function parseTireCount(raw: string | undefined, fallback = '4'): number {
  const text = (raw ?? '').trim() || fallback;
  if (!/^\d+$/u.test(text)) throw new Error('Broj guma mora biti cijeli broj od 1 do 8.');
  const tireCount = Number(text);
  if (tireCount < 1 || tireCount > 8) throw new Error('Broj guma mora biti cijeli broj od 1 do 8.');
  return tireCount;
}

function parsePurchasePrice(raw: string | undefined): number | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const purchasePrice = moneyToFeninzi(text);
  if (purchasePrice === null || purchasePrice > 2147483647) {
    throw new Error('Unesite ispravnu nenegativnu nabavnu cijenu u KM.');
  }
  return purchasePrice;
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

  const payload: Record<string, unknown> = {
    code,
    season,
    tireCount: parseTireCount(core.tireCount),
    formData,
    formSchemaVersionId,
  };
  for (const key of ['brand', 'model', 'size', 'purchaseDate', 'currentLocation', 'notes']) {
    addText(payload, core, key);
  }

  const purchasePrice = parsePurchasePrice(core.purchasePrice);
  if (purchasePrice !== null) payload.purchasePrice = purchasePrice;

  return payload;
}

const MANUAL_STATUSES: readonly TireStatus[] = ['IN_STOCK', 'IN_REPAIR', 'RETIRED', 'SCRAPPED'];

/**
 * Statusi koji se na ekranu smiju ponuditi ručno.
 *
 * Aktivna montaža zaključava status. Nekonzistentan `MOUNTED` bez aktivne
 * montaže ipak se mora moći ispraviti, pa se tada nude svi ručni statusi.
 */
export function tireSetStatusOptions(
  detail: Pick<TireSetDetail, 'status' | 'mountedVehicleId'>,
): readonly TireStatus[] {
  if (detail.mountedVehicleId) return ['MOUNTED'];
  if (detail.status === 'MOUNTED') return ['MOUNTED', ...MANUAL_STATUSES];
  return [detail.status, ...TIRE_SET_MANUAL_STATUS_TRANSITIONS[detail.status]];
}

/** Detalj kompleta → string vrijednosti statičnih kontrola izmjene. */
export function tireSetCoreValues(detail: TireSetDetail): Record<string, string> {
  return {
    code: detail.code,
    season: detail.season,
    brand: detail.brand ?? '',
    model: detail.model ?? '',
    size: detail.size ?? '',
    tireCount: String(detail.tireCount),
    purchaseDate: detail.purchaseDate ?? '',
    purchasePrice: feninziToInput(detail.purchasePrice),
    currentLocation: detail.currentLocation ?? '',
    notes: detail.notes ?? '',
    status: detail.status,
  };
}

/** Stabilno poređenje JSON vrijednosti bez zavisnosti od redoslijeda ključeva. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * PATCH payload sadrži obaveznu verziju i samo stvarne izmjene.
 *
 * Prazna opcionalna polja šalju se kao `null`, jer izostavljanje u PATCH-u
 * znači „ne mijenjaj“. `formData` se izostavlja kad dodatna polja nisu
 * mijenjana ili zapisna definicija nije dostupna ekranu; server tada i dalje
 * sam validira postojeći zapis zapisnom verzijom.
 */
export function buildTireSetUpdatePayload(
  detail: TireSetDetail,
  core: Readonly<Record<string, string>>,
  formData?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const code = (core.code ?? '').trim();
  if (!code) throw new Error('Kod kompleta je obavezan.');

  const season = (core.season ?? '').trim();
  if (!TIRE_SEASONS.includes(season as (typeof TIRE_SEASONS)[number])) {
    throw new Error('Odaberite sezonu kompleta.');
  }

  const tireCount = parseTireCount(core.tireCount, String(detail.tireCount));
  const purchasePrice = parsePurchasePrice(core.purchasePrice);
  const payload: Record<string, unknown> = { version: detail.version };

  if (code !== detail.code) payload.code = code;

  const optionalText = (key: 'brand' | 'model' | 'size' | 'currentLocation' | 'notes'): void => {
    const value = (core[key] ?? '').trim() || null;
    if (value !== detail[key]) payload[key] = value;
  };
  optionalText('brand');
  optionalText('model');
  optionalText('size');
  optionalText('currentLocation');
  optionalText('notes');

  if (season !== detail.season) payload.season = season;
  if (tireCount !== detail.tireCount) payload.tireCount = tireCount;

  const purchaseDate = (core.purchaseDate ?? '').trim() || null;
  if (purchaseDate !== detail.purchaseDate) payload.purchaseDate = purchaseDate;
  if (purchasePrice !== detail.purchasePrice) payload.purchasePrice = purchasePrice;

  const status = (core.status ?? '').trim();
  if (detail.mountedVehicleId) {
    if (status && status !== detail.status) {
      throw new Error('Status montiranog kompleta mijenja se demontažom.');
    }
  } else if (status && status !== detail.status) {
    if (!tireSetStatusOptions(detail).includes(status as TireStatus) || status === 'MOUNTED') {
      throw new Error('Odabrani prelaz statusa kompleta nije dozvoljen.');
    }
    payload.status = status;
  }

  if (formData !== undefined && stableJson(formData) !== stableJson(detail.formData)) {
    if (!detail.formSchemaVersionId) {
      throw new Error('Komplet nema zapisnu verziju forme; dodatna polja se ne mogu mijenjati.');
    }
    const cleaned: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(detail.formData), ...Object.keys(formData)]);
    for (const key of keys) cleaned[key] = formData[key] === undefined ? null : formData[key];
    payload.formData = cleaned;
  }

  if (Object.keys(payload).length === 1) throw new Error('Nema izmjena za snimanje.');
  return payload;
}

/** Pozicije koje u kompletu još nemaju evidentiranu pojedinačnu gumu. */
export function availableTirePositions(
  tires: readonly Pick<TireView, 'position'>[],
): readonly TirePosition[] {
  const occupied = new Set(tires.map((tire) => tire.position).filter(Boolean));
  return TIRE_POSITIONS.filter((position) => !occupied.has(position));
}

function parseOptionalInteger(
  raw: string | undefined,
  label: string,
  min: number,
  max: number,
): number | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (!/^\d+$/u.test(text)) throw new Error(`${label} mora biti cijeli broj od ${min} do ${max}.`);
  const value = Number(text);
  if (value < min || value > max) throw new Error(`${label} mora biti cijeli broj od ${min} do ${max}.`);
  return value;
}

function parseTreadDepthTenths(raw: string | undefined): number | null {
  const text = (raw ?? '').trim().replace(',', '.');
  if (!text) return null;
  if (!/^\d+(?:\.\d)?$/u.test(text)) {
    throw new Error('Dubina profila mora biti nenegativan broj s najviše jednom decimalom.');
  }
  const tenths = Math.round(Number(text) * 10);
  if (tenths > 9999) throw new Error('Dubina profila je izvan dozvoljenog opsega.');
  return tenths;
}

/** Desetinke milimetra iz API-ja → lokalizovan prikaz u milimetrima. */
export function formatTreadDepth(tenths: number | null): string {
  if (tenths === null) return '—';
  return `${new Intl.NumberFormat('bs-BA', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(tenths / 10)} mm`;
}

/**
 * Kontrole pojedinačne gume → strict API DTO.
 *
 * Prazna polja se izostavljaju, cijena ide u feninge, a dubina profila u
 * desetinke milimetra. Zauzete pozicije ekran odbija odmah, ali server istu
 * provjeru ponavlja pod zaključanim kompletom.
 */
export function buildTirePayload(
  values: Readonly<Record<string, string>>,
  occupiedPositions: readonly (TirePosition | null)[] = [],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const key of ['serialNumber', 'dot', 'purchaseDate', 'notes'] as const) {
    const value = (values[key] ?? '').trim();
    if (value) payload[key] = value;
  }

  const position = (values.position ?? '').trim();
  if (position) {
    if (!TIRE_POSITIONS.includes(position as TirePosition)) {
      throw new Error('Odaberite ispravnu poziciju gume.');
    }
    if (occupiedPositions.includes(position as TirePosition)) {
      throw new Error('Pozicija je već evidentirana u ovom kompletu.');
    }
    payload.position = position;
  }

  const productionWeek = parseOptionalInteger(values.productionWeek, 'Sedmica proizvodnje', 1, 53);
  if (productionWeek !== null) payload.productionWeek = productionWeek;

  const productionYear = parseOptionalInteger(values.productionYear, 'Godina proizvodnje', 1900, 2100);
  if (productionYear !== null) payload.productionYear = productionYear;

  const treadDepthTenthsMm = parseTreadDepthTenths(values.treadDepthMm);
  if (treadDepthTenthsMm !== null) payload.treadDepthTenthsMm = treadDepthTenthsMm;

  const purchasePrice = parsePurchasePrice(values.purchasePrice);
  if (purchasePrice !== null) payload.purchasePrice = purchasePrice;

  if (
    typeof payload.purchaseDate === 'string' &&
    productionYear !== null &&
    Number(payload.purchaseDate.slice(0, 4)) < productionYear
  ) {
    throw new Error('Datum nabavke ne može biti prije godine proizvodnje.');
  }

  if (Object.keys(payload).length === 0) throw new Error('Unesite bar jedan podatak o gumi.');
  return payload;
}
