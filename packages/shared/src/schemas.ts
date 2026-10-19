/**
 * VFM — Zod šeme API ugovora (DTO) + čista logika politike lozinke.
 *
 * Jedinstven izvor istine za API, web i mobilnu aplikaciju
 * (`docs/07-API_SPECIFIKACIJA.md` §7: „Zod DTO iz `@vfm/shared` — nema inline šema").
 *
 * ⚠️ Ovaj ulaz (`@vfm/shared/schemas`) smije u browser bundle: sadrži samo `zod`
 *    i konstante, bez ENV šeme i bez Node API-ja. ENV šema je i dalje u
 *    `@vfm/shared/env` (server-only).
 *
 * Pravila (docs/05-RBAC_PERMISIJE_SIGURNOST.md):
 * - **T-11 (mass assignment):** DTO šeme su `.strict()` → nepoznato polje je greška
 *   (`UNKNOWN_FIELD`), nikad se ne ignoriše tiho.
 * - **R-05:** 2FA se NE implementira → nema `2fa` polja ni šema.
 * - Politika lozinke (§7): min 12 znakova, min 3 od 4 klase, bez najčešćih lozinki,
 *   bez ličnih podataka (e-mail, ime) i bez trivijalnih sekvenci.
 */
import { z } from 'zod';
import { MAX_PAGE_SIZE } from './constants.js';
import { CLIENT_TYPES } from './enums.js';
import type { ClientType } from './enums.js';

// -----------------------------------------------------------------------------
//  Zajedničke šeme (koriste ih API, web i mobilna)
// -----------------------------------------------------------------------------

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Pagination query: `page`, `pageSize`, `sortBy`, `sortOrder`, `q`. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  sortBy: z.string().min(1).max(64).optional(),
  sortOrder: z.enum(SORT_ORDERS).default('asc'),
  q: z.string().max(200).optional(),
});

export type PaginationQuery = z.output<typeof paginationQuerySchema>;

/** UUID (baza koristi UUID v7, ali prihvata i v4 iz klijenata). */
export const uuidSchema = z.uuid();

/** Registracija vozila (BIH format: slova/brojevi/crtica). */
export const plateSchema = z
  .string()
  .trim()
  .min(5)
  .max(12)
  .regex(/^[A-Z0-9][A-Z0-9-]{3,10}[A-Z0-9]$/u, 'Neispravan format registarske oznake');

/** E-mail (baza koristi `citext`, pa se ne oslanjamo na case-sensitivity). */
export const emailSchema = z.email().toLowerCase();

/** Geo koordinate (opciono za lokaciju servisa/vozila). */
export const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

/** `X-Request-Id` — UUID ili kratki alfanumerički ID (Traefik). */
export const requestIdSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u, 'Neispravan format request ID-a');

// -----------------------------------------------------------------------------
//  Politika lozinke (docs/05 §7) — čista logika, bez I/O
// -----------------------------------------------------------------------------

/** Minimalna dužina lozinke (zadatak: bez fiksnih lozinki, min 12). */
export const PASSWORD_MIN_LENGTH = 12;
/** Maksimalna dužina (argon2id i DB kolona `text`; ograničava DoS). */
export const PASSWORD_MAX_LENGTH = 128;
/** Koliko klasa znakova mora biti zastupljeno (od ukupno 4). */
export const PASSWORD_MIN_CHARACTER_CLASSES = 3;

/**
 * Ugrađena lista najčešćih lozinki (javno poznate liste + regionalne varijante).
 *
 * ⚠️ **Ograničenje (Faza 1):** docs/05 §7 traži provjeru protiv liste od ~100 000
 * lozinki. Ovdje je kompaktna ugrađena lista; puna lista se ubacuje kroz
 * `PasswordService` (konstruktor prima `blocklist`), npr. montirana datoteka u
 * kontejneru — bez promjene ENV ugovora.
 */
export const COMMON_PASSWORDS: readonly string[] = [
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '123456789a',
  'a123456789',
  'abc123',
  'abc123456',
  '111111',
  '000000',
  '121212',
  '123123',
  '112233',
  '654321',
  '666666',
  '696969',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'pass123',
  'p@ssw0rd',
  'admin',
  'administrator',
  'admin123',
  'root',
  'toor',
  'letmein',
  'welcome',
  'welcome1',
  'welcome123',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'qazwsx',
  'zaq12wsx',
  '1qaz2wsx',
  '1q2w3e4r',
  '1q2w3e4r5t',
  '1q2w3e',
  'q1w2e3r4',
  'q1w2e3r4t5',
  'asdfgh',
  'asdfghjkl',
  'zxcvbnm',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'starwars',
  'superman',
  'batman',
  'trustno1',
  'whatever',
  'master',
  'master123',
  'shadow',
  'hunter',
  'ranger',
  'harley',
  'ginger',
  'secret',
  'freedom',
  'football',
  'baseball',
  'basketball',
  'michael',
  'jennifer',
  'jordan23',
  'charlie',
  'donald',
  'hello123',
  'changeme',
  'test',
  'test123',
  'test1234',
  'demo',
  'demo123',
  'guest',
  'guest123',
  'user',
  'user123',
  'sifra',
  'sifra123',
  'šifra',
  'šifra123',
  'lozinka',
  'lozinka123',
  'lozinka2024',
  'lozinka2025',
  'lozinka2026',
  'voznilpark',
  'voznipark',
  'voznipark123',
  'vfm123456',
  'sarajevo',
  'sarajevo123',
  'bosna123',
  'hercegovina',
  'bih123456',
  'ba123456',
  'tuzla123',
  'zenica123',
  'mostar123',
  'banjaluka',
] as const;

/** Identifikator kršenja politike lozinke (koristi se i u `details[]` odgovora). */
export type PasswordIssueCode =
  | 'too_short'
  | 'too_long'
  | 'insufficient_character_classes'
  | 'common_password'
  | 'contains_personal_data'
  | 'repetitive_sequence';

export interface PasswordPolicyIssue {
  readonly code: PasswordIssueCode;
  /** Poruka na bosanskom (spremna za `ApiErrorDetail.message`). */
  readonly message: string;
}

/** Lični podaci koji se ne smiju pojaviti u lozinki (docs/05 §7). */
export interface PasswordPolicyContext {
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly username?: string;
  /** Dodatna blocklista (npr. ugrađena + organizacijske lozinke). */
  readonly blocklist?: readonly string[];
  /**
   * Dodatni podstringovi koji se ne smiju naći u lozinki (docs/05 §7: npr.
   * registarska oznaka vozila koje korisnik vozi, naziv firme). Porede se
   * case-insensitively, minimalna dužina 3 znaka.
   */
  readonly forbiddenSubstrings?: readonly string[];
}

/**
 * Broj zastupljenih klasa znakova (0–4): mala slova, velika slova, cifre, simboli.
 */
export function passwordCharacterClassCount(password: string): number {
  let classes = 0;
  if (/[a-z]/u.test(password)) classes += 1;
  if (/[A-Z]/u.test(password)) classes += 1;
  if (/[0-9]/u.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/u.test(password)) classes += 1;
  return classes;
}

/**
 * Da li je lozinka „najčešća" (T-01): direktno u listi, ili je dobijena
 * dodavanjem cifara na čestu osnovu (npr. `lozinka2026` → `lozinka`).
 */
export function isCommonPassword(password: string, extra: readonly string[] = []): boolean {
  const normalized = password.trim().toLowerCase();
  const lists = [COMMON_PASSWORDS, extra];
  for (const list of lists) {
    if (list.includes(normalized)) return true;
  }
  // Bez cifara/razmaka — hvata varijante tipa "Password123", "admin2026".
  const lettersOnly = normalized.replace(/[^a-zšđžćč]/gu, '');
  if (lettersOnly.length >= 4) {
    for (const list of lists) {
      if (list.includes(lettersOnly)) return true;
    }
  }
  return false;
}

/**
 * Trivijalna sekvenca: ≥ 6 uzastopnih istih znakova (`aaaaaa`) ili ≥ 6 znakova
 * uzastopnog niza (`123456`, `abcdef`, opadajuće).
 */
export function hasRepetitiveSequence(password: string): boolean {
  const value = password.toLowerCase();
  if (/(.)\1{5,}/u.test(value)) return true;

  let ascending = 1;
  let descending = 1;
  for (let index = 1; index < value.length; index += 1) {
    const previous = value.codePointAt(index - 1) ?? 0;
    const current = value.codePointAt(index) ?? 0;
    ascending = current === previous + 1 ? ascending + 1 : 1;
    descending = current === previous - 1 ? descending + 1 : 1;
    if (ascending >= 6 || descending >= 6) return true;
  }
  return false;
}

/**
 * Puna provjera politike lozinke → lista kršenja (prazna = ispravna).
 *
 * Namjerno **bez** Zod-a: ista logika se koristi u `PasswordService` (API),
 * u `.superRefine` šemi i (opciono) u web formi za trenutne hintove.
 */
export function passwordPolicyIssues(
  password: string,
  context: PasswordPolicyContext = {},
): readonly PasswordPolicyIssue[] {
  const issues: PasswordPolicyIssue[] = [];
  const value = typeof password === 'string' ? password : '';

  if (value.length < PASSWORD_MIN_LENGTH) {
    issues.push({
      code: 'too_short',
      message: `Lozinka mora imati barem ${PASSWORD_MIN_LENGTH} znakova.`,
    });
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    issues.push({
      code: 'too_long',
      message: `Lozinka može imati najviše ${PASSWORD_MAX_LENGTH} znakova.`,
    });
  }
  if (passwordCharacterClassCount(value) < PASSWORD_MIN_CHARACTER_CLASSES) {
    issues.push({
      code: 'insufficient_character_classes',
      message:
        `Lozinka mora sadržavati barem ${PASSWORD_MIN_CHARACTER_CLASSES} od 4 klase znakova ` +
        '(mala slova, velika slova, cifre, simboli).',
    });
  }
  if (isCommonPassword(value, context.blocklist)) {
    issues.push({
      code: 'common_password',
      message: 'Lozinka je na listi najčešćih lozinki — izaberite drugu.',
    });
  }
  if (hasRepetitiveSequence(value)) {
    issues.push({
      code: 'repetitive_sequence',
      message: 'Lozinka ne smije sadržavati 6 ili više uzastopnih istih ili sekvencijalnih znakova.',
    });
  }

  const lowered = value.toLowerCase();
  const personal = [
    context.email,
    context.email?.split('@')[0],
    context.firstName,
    context.lastName,
    context.username,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length >= 3);

  let personalMatch = false;
  for (const part of personal) {
    const needle = part.trim().toLowerCase();
    if (needle.length >= 3 && lowered.includes(needle)) {
      issues.push({
        code: 'contains_personal_data',
        message: 'Lozinka ne smije sadržavati vaš e-mail, ime ili korisničko ime.',
      });
      personalMatch = true;
      break;
    }
  }

  if (!personalMatch) {
    const forbidden = (context.forbiddenSubstrings ?? []).filter(
      (part): part is string => typeof part === 'string' && part.trim().length >= 3,
    );
    for (const part of forbidden) {
      const needle = part.trim().toLowerCase();
      if (lowered.includes(needle)) {
        issues.push({
          code: 'contains_personal_data',
          message: 'Lozinka ne smije sadržavati prepoznatljive podatke (npr. registarsku oznaku vozila).',
        });
        break;
      }
    }
  }

  return issues;
}

/** Poruka kada je nova lozinka identična trenutnoj (koristi se i u `details[]`). */
export const CHANGE_PASSWORD_MIN_DIFFERENCE_MESSAGE = 'Nova lozinka mora biti različita od trenutne.';

/**
 * Lozinka uz punu politiku (dužina + klase + najčešće + sekvence).
 * Lični podaci (e-mail/ime) se provjeravaju u `PasswordService`, jer zahtijevaju
 * kontekst korisnika koji Zod šema nema.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Lozinka mora imati barem ${PASSWORD_MIN_LENGTH} znakova`)
  .max(PASSWORD_MAX_LENGTH, `Lozinka može imati najviše ${PASSWORD_MAX_LENGTH} znakova`)
  .superRefine((value, ctx) => {
    for (const issue of passwordPolicyIssues(value)) {
      if (issue.code === 'too_short' || issue.code === 'too_long') continue;
      ctx.addIssue({ code: 'custom', message: issue.message, params: { issueCode: issue.code } });
    }
  });

/** Lozinka pri **prijavi**: samo dužina (politika se ne primjenjuje retroaktivno). */
export const loginPasswordSchema = z
  .string()
  .min(1, 'Unesite lozinku')
  .max(PASSWORD_MAX_LENGTH, 'Lozinka je preduga');

// -----------------------------------------------------------------------------
//  Auth DTO (docs/07-API_SPECIFIKACIJA.md §2.1 i §3.1)
// -----------------------------------------------------------------------------

/** Tip klijenta (`X-Client-Type` / `clientType` u loginu). */
export const clientTypeSchema = z.enum(CLIENT_TYPES);
export type ClientTypeSchema = z.output<typeof clientTypeSchema>;

/** Podaci o uređaju (mobilna) — audit i pregled sesija. */
export const deviceInfoSchema = z
  .object({
    model: z.string().trim().max(120).optional(),
    osVersion: z.string().trim().max(60).optional(),
    appVersion: z.string().trim().max(40).optional(),
  })
  .strict();

export type DeviceInfo = z.output<typeof deviceInfoSchema>;

/**
 * `POST /auth/login`.
 *
 * 🔴 `clientType` je **obavezan podatak za autorizaciju** (N-05/P1): Super Admin
 * s mobilnog klijenta dobija `403 MOBILE_ACCESS_FORBIDDEN` — provjera je na serveru.
 */
export const loginSchema = z
  .object({
    email: emailSchema,
    password: loginPasswordSchema,
    clientType: clientTypeSchema.default('WEB'),
    deviceInfo: deviceInfoSchema.optional(),
  })
  .strict();

export type LoginInput = z.output<typeof loginSchema>;

/** `POST /auth/refresh` — web šalje cookie, mobilna `refreshToken` u tijelu. */
export const refreshSchema = z
  .object({
    refreshToken: z.string().min(32).max(512).optional(),
    clientType: clientTypeSchema.optional(),
  })
  .strict();

export type RefreshInput = z.output<typeof refreshSchema>;

/** `POST /auth/logout` — opciono eksplicitni token (mobilna). */
export const logoutSchema = z
  .object({
    refreshToken: z.string().min(32).max(512).optional(),
  })
  .strict();

export type LogoutInput = z.output<typeof logoutSchema>;

/** `POST /auth/change-password` (🔒 `auth:change_password`). */
export const changePasswordSchema = z
  .object({
    currentPassword: loginPasswordSchema,
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: CHANGE_PASSWORD_MIN_DIFFERENCE_MESSAGE,
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.output<typeof changePasswordSchema>;

/** `POST /auth/forgot-password` — uvijek isti odgovor (bez enumeracije korisnika). */
export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export type ForgotPasswordInput = z.output<typeof forgotPasswordSchema>;

/** `POST /auth/reset-password` — jednokratni token (30 min, docs/05 §7). */
export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(16).max(256),
    newPassword: passwordSchema,
  })
  .strict();

export type ResetPasswordInput = z.output<typeof resetPasswordSchema>;

/** `GET /auth/sessions` — revokacija jedne sesije (`DELETE /auth/sessions/:id`). */
export const sessionIdSchema = uuidSchema;

/**
 * Dozvoljeni tipovi klijenta za datu rolu (docs/05 §6): Super Admin je web-only.
 * Izvor istine za kodove rola je `permissions.ts` → `ROLE_ALLOWED_CLIENT_TYPES`.
 */
export function isClientTypeAllowed(
  clientType: ClientType | string,
  allowedClientTypes: readonly ClientType[],
): boolean {
  return allowedClientTypes.some((allowed) => allowed === clientType);
}
