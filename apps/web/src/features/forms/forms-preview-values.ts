/**
 * Pregled forme u Builder-u (W21) — prevodi render model u DOM kontrole.
 *
 * Zašto poseban modul za pretvaranje vrijednosti: isti render model koristi i
 * mobilna aplikacija, pa se konverzija „string iz `<input>`" → tip iz definicije
 * mora ponašati isto u pregledu i u stvarnom zapisu (Faza 3). Ovdje je
 * namjerno **bez React-a**, da se može testirati.
 */
import type { RenderWidget } from '@vfm/form-renderer';

/** Vrijednost iz modela → tekst u kontroli (prazno polje = ''). */
export function inputValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  return '';
}

/**
 * Tekst iz kontrole → vrijednost za model.
 *
 * - `NUMBER`/`MONEY`: broj ili `undefined` (prazno/neispravno) — validaciju i
 *   dalje radi engine, pa pregled ne baca grešku na svaki otkucani znak;
 * - `MONEY` se u modelu drži kao `{ amount, currency }` u **feninzima** (§7);
 * - ostali tipovi ostaju string (datum `YYYY-MM-DD`, datetime ISO).
 */
export function parseInputValue(widget: RenderWidget, raw: string, currency = 'BAM'): unknown {
  const text = raw.trim();
  if (text === '') return undefined;

  switch (widget) {
    case 'NUMBER': {
      const parsed = Number(text);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case 'MONEY': {
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) return undefined;
      return { amount: Math.round(parsed * 100), currency };
    }
    default:
      return text;
  }
}

/** Vrijednost za `MONEY` kontrolu (KM, dvije decimale) iz modela. */
export function moneyInputValue(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const amount = (value as { amount?: unknown }).amount;
  return typeof amount === 'number' ? (amount / 100).toFixed(2) : '';
}

/** Dodaje/uklanja kod u višestrukom izboru (redoslijed ostaje stabilan). */
export function toggleMulti(current: unknown, code: string): string[] {
  const list = Array.isArray(current)
    ? current.filter((item): item is string => typeof item === 'string')
    : [];
  return list.includes(code) ? list.filter((item) => item !== code) : [...list, code];
}

/**
 * Današnji datum u `Europe/Sarajevo` (`YYYY-MM-DD`) — server ga šalje uz
 * zapis; u pregledu ga računamo, ali uvijek u zoni korisnika (N-11).
 */
export function sarajevoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sarajevo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
