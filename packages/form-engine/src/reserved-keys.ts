/**
 * Rezervisani ključevi i format `fieldKey` (docs/04-FORM_ENGINE.md §5).
 *
 * Dinamička polja ne smiju prepisati sistemske kolone niti dotaknuti prototype
 * (B-17/U-05). Provjera se radi pri snimanju drafta **i** pri objavi.
 */

/** Sistemski ključevi koje dinamičko polje ne smije koristiti. */
export const RESERVED_FIELD_KEYS = [
  'id',
  'code',
  'status',
  'priority',
  'vehicleId',
  'taskTypeId',
  'createdById',
  'assigneeUserId',
  'claimedAt',
  'completedAt',
  'completedById',
  'cancelledAt',
  'cancelReason',
  'dueAt',
  'dueDate',
  'durationMinutes',
  'version',
  'formSchemaId',
  'formSchemaVersionId',
  'formData',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'roles',
  'permissions',
  '__proto__',
  'constructor',
  'prototype',
] as const;

export type ReservedFieldKey = (typeof RESERVED_FIELD_KEYS)[number];

/**
 * Donja granica uključuje prvi znak, gornja ukupnu dužinu (2–49):
 * `^[a-z][a-zA-Z0-9_]{1,48}$` — bez tačaka i razmaka (sigurno za JSON putanje
 * i SQL mapiranje).
 */
export const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{1,48}$/u;

/** Najkraći/dozvoljeni raspon dužine ključa (izvedeno iz {@link FIELD_KEY_PATTERN}). */
export const FIELD_KEY_MIN_LENGTH = 2;
export const FIELD_KEY_MAX_LENGTH = 49;

/** Kodovi greške meta-sheme za ključ polja (mapiraju se na `422`). */
export const FIELD_KEY_ISSUE_CODES = ['RESERVED_FIELD_KEY', 'INVALID_FIELD_KEY_FORMAT'] as const;
export type FieldKeyIssueCode = (typeof FIELD_KEY_ISSUE_CODES)[number];

const RESERVED_LOOKUP: ReadonlySet<string> = new Set(RESERVED_FIELD_KEYS.map((key) => key.toLowerCase()));

/**
 * Da li je ključ rezervisan? Poređenje je **case-insensitive** jer se JSONB
 * putanje i SQL kolone lako zbune (`Status` vs `status`), a zaštita mora držati.
 */
export function isReservedFieldKey(key: string): boolean {
  return RESERVED_LOOKUP.has(key.trim().toLowerCase());
}

/** Da li ključ zadovoljava format iz §5? */
export function isValidFieldKeyFormat(key: string): boolean {
  return FIELD_KEY_PATTERN.test(key);
}

export interface FieldKeyIssue {
  readonly code: FieldKeyIssueCode;
  readonly key: string;
  readonly message: string;
}

/**
 * Provjera jednog ključa: vraća `null` ako je ispravan, inače issue.
 * Rezervisani ključ ima prednost nad formatom (jasnija poruka).
 */
export function checkFieldKey(key: string): FieldKeyIssue | null {
  if (isReservedFieldKey(key)) {
    return {
      code: 'RESERVED_FIELD_KEY',
      key,
      message: `Ključ "${key}" je rezervisan (sistemska kolona) i ne može se koristiti kao fieldKey.`,
    };
  }
  if (!isValidFieldKeyFormat(key)) {
    return {
      code: 'INVALID_FIELD_KEY_FORMAT',
      key,
      message: `Ključ "${key}" nije u formatu ^[a-z][a-zA-Z0-9_]{1,48}$ (bez tačaka, razmaka i velikog početnog slova).`,
    };
  }
  return null;
}

/**
 * Provjera liste ključeva (sekcije + polja). Vraća sve probleme, ne samo prvi —
 * API ih vraća kao listu u `details.issues` (docs/04 §8).
 */
export function checkFieldKeys(keys: readonly string[]): readonly FieldKeyIssue[] {
  const issues: FieldKeyIssue[] = [];
  for (const key of keys) {
    const issue = checkFieldKey(key);
    if (issue) issues.push(issue);
  }
  return issues;
}
