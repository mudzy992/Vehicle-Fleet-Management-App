/**
 * Registracije i osiguranje — čista logika ekrana (W05/W06, docs/07 §2.6).
 *
 * Dva pravila koja moraju biti ista u unosu i u prikazu:
 * 1. **novac** se u API šalje u feningama (BAM × 100), nikad kao decimala —
 *    `0.1 + 0.2` u feningama je cijeli broj i poređenje je tačno (docs/04 §7);
 * 2. **period** podrazumijevano traje godinu dana od danas, uključujući oba
 *    dana (registracija od 20.10.2026 važi do 19.10.2027) — server to ne
 *    popunjava, pa ekran nudi ispravan default, a korisnik ga mijenja.
 */

/** `"45.50"` → `4550`; prazno/neispravno → `null` (polje ostaje neobavezno). */
export function moneyToFeninzi(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const parsed = Number(text.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** Feninge → `"45.50"` za `<input>` (i za prikaz u tabeli). */
export function feninziToInput(amount: number | null): string {
  return amount === null ? '' : (amount / 100).toFixed(2);
}

/** Dodaje dane `yyyy-MM-dd` datumu (bez vremenske zone). */
export function addDays(dateIso: string, days: number): string {
  const start = Date.parse(`${dateIso}T00:00:00.000Z`);
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Podrazumijevani period evidencije: od `todayIso` do istog datuma sljedeće
 * godine minus jedan dan. 29.02. → 28.02. (bez prestupnog dana).
 */
export function defaultPeriod(todayIso: string): { validFrom: string; validUntil: string } {
  const year = Number(todayIso.slice(0, 4));
  const monthDay = todayIso.slice(4); // `-MM-DD`
  const nextYear = `${year + 1}${monthDay}`;
  // Ako datum ne postoji u sljedećoj godini (29.02.), `Date.parse` ga prebaci
  // na 01.03. — tada uzimamo 28.02. te godine.
  const parsed = Date.parse(`${nextYear}T00:00:00.000Z`);
  const shifted = Number.isNaN(parsed) ? todayIso : new Date(parsed).toISOString().slice(0, 10);
  const candidate = shifted === nextYear ? nextYear : `${year + 1}-02-28`;
  return { validFrom: todayIso, validUntil: addDays(candidate, -1) };
}

/** Da li je greška preklapanja perioda (409) — ekran tada ne nudi „pokušaj ponovo". */
export function isPeriodOverlap(code: string | undefined): boolean {
  return code === 'PERIOD_OVERLAP';
}
