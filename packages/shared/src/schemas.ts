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
import {
  ATTACHMENT_OWNER_TYPES,
  ATTACHMENT_STAGES,
  AUDIT_ACTIONS,
  AUDIT_SEVERITIES,
  NOTIFICATION_CHANNELS,
  REMINDER_KINDS,
  REMINDER_STATUSES,
  CLIENT_TYPES,
  DRIVER_STATUSES,
  FORM_SCHEMA_STATUSES,
  FORM_SUBJECTS,
  MIGRATION_JOB_STATUSES,
  MIGRATION_TARGET_ENTITIES,
  PERMISSION_SCOPES,
  RECORD_STATUSES,
  USER_STATUSES,
  FUEL_TYPES,
  ODOMETER_SOURCES,
  OWNERSHIP_TYPES,
  VEHICLE_STATUSES,
} from './enums.js';
import type { ClientType } from './enums.js';
import { isKnownPermission } from './permissions.js';

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

// -----------------------------------------------------------------------------
//  Odgovori /auth (login, refresh, me) — docs/07 §7
// -----------------------------------------------------------------------------

/**
 * Uloga korisnika u odgovoru `/auth/*` (bez internih detalja dozvola).
 *
 * Zašto zaseban tip (a ne puni `Role`): klijentu trebaju samo identifikatori
 * i čitljivo ime za prikaz u zaglavlju; dozvole idu kao lista kodova.
 */
export const authRoleSchema = z
  .object({
    id: uuidSchema,
    code: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

export type AuthRole = z.output<typeof authRoleSchema>;

/**
 * Profil + efektivna prava trenutno prijavljenog korisnika.
 *
 * `permissions` je **izračunata lista kodova** (union svih grantova važećih
 * uloga) — web je koristi u `usePermission()` da ne bi pogodio pravo iz koda
 * role. `permissionsVersion`/`tokenVersion` služe za P3 (revokacija ≤ 5 s).
 */
export const authUserSchema = z
  .object({
    id: uuidSchema,
    email: emailSchema,
    firstName: z.string(),
    lastName: z.string(),
    displayName: z.string().nullable(),
    status: z.enum(USER_STATUSES),
    roles: z.array(authRoleSchema),
    permissions: z.array(z.string()),
    permissionsVersion: z.number().int().nonnegative(),
    tokenVersion: z.number().int().nonnegative(),
    mustChangePassword: z.boolean(),
    isSuperAdmin: z.boolean(),
    allowedClientTypes: z.array(clientTypeSchema),
    /** Korisničke postavke prikaza (R-08: UTC u bazi, `Europe/Sarajevo` u UI). */
    timezone: z.string().min(1),
    locale: z.string().min(2),
    lastLoginAt: z.iso.datetime().nullable(),
  })
  .strict();

export type AuthUser = z.output<typeof authUserSchema>;

/**
 * Odgovor `POST /auth/login` i `POST /auth/refresh`.
 *
 * 🔴 `refreshToken` je u tijelu **samo za mobilne klijente** (`MOBILE_ANDROID`/
 * `MOBILE_IOS`), jer oni ne mogu čuvati httpOnly cookie. Za web se token vraća
 * isključivo kroz `Set-Cookie` (httpOnly + Secure + SameSite) i polja nema u
 * tijelu — tako XSS ne može doći do refresh tokena (docs/05 §5.2).
 */
export const authTokenResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().positive(),
    refreshExpiresIn: z.number().int().positive(),
    sessionId: uuidSchema,
    refreshToken: z.string().min(1).optional(),
    user: authUserSchema,
  })
  .strict();

export type AuthTokenResponse = z.output<typeof authTokenResponseSchema>;

// -----------------------------------------------------------------------------
//  Role i permisije (docs/07 §2.3, docs/05 §3–§4)
// -----------------------------------------------------------------------------

/** `POST /roles/:id/archive` i `GET/PATCH /roles/:id` — UUID identifikator. */
export const roleIdSchema = uuidSchema;

/**
 * Kod role: velika slova, cifre i donja crta (npr. `DISPECER`, `SERVISER`).
 *
 * Sistemski kodovi (`SUPER_ADMIN`, `ADMINISTRATOR`, `OBICNI_KORISNIK`, `CUSTOM`)
 * su rezervisani — API odbija kreiranje role s tim kodovima.
 */
export const roleCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/u, { message: 'Kod role mora biti VELIKA_SLOVA (npr. DISPECER).' });

/**
 * Kod permisije mora postojati u katalogu (`PERMISSION_CATALOG`).
 *
 * Zašto iz kataloga, a ne slobodan string: prava se evaluiraju u kodu
 * (`evaluateEffectivePermissions`), pa permisija koje nema u katalogu ne bi
 * imala nikakav efekat — greška bi bila tiha.
 */
export const permissionCodeSchema = z.string().trim().refine(isKnownPermission, {
  message: 'Permisija nije u katalogu (packages/shared → PERMISSION_CATALOG).',
});

export const permissionScopeSchema = z.enum(PERMISSION_SCOPES);

/**
 * Jedan grant (`RolePermission`) u ulazu za matricu prava.
 *
 * Pravila opsega (docs/05 §1):
 * - `VEHICLE_IDS` → `scopeVehicleIds` obavezan i neprazan,
 * - `DRIVER_IDS` → `scopeDriverIds` obavezan i neprazan,
 * - `ALL`/`OWN` → ID liste nisu dozvoljene (ne bi imale značenje).
 */
export const permissionGrantInputSchema = z
  .object({
    permission: permissionCodeSchema,
    scope: permissionScopeSchema,
    scopeVehicleIds: z.array(uuidSchema).max(500).optional(),
    scopeDriverIds: z.array(uuidSchema).max(500).optional(),
    /** Dodatna pravila (whitelist evaluator) — samo jednostavne JSON vrijednosti. */
    conditions: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]),
      )
      .optional(),
  })
  .strict()
  .superRefine((grant, ctx) => {
    if (grant.scope === 'VEHICLE_IDS') {
      if (!grant.scopeVehicleIds || grant.scopeVehicleIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['scopeVehicleIds'],
          message: 'Opseg VEHICLE_IDS traži neprazan spisak vozila.',
        });
      }
      if (grant.scopeDriverIds && grant.scopeDriverIds.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['scopeDriverIds'],
          message: 'Uz opseg VEHICLE_IDS nije dozvoljen spisak vozača.',
        });
      }
      return;
    }

    if (grant.scope === 'DRIVER_IDS') {
      if (!grant.scopeDriverIds || grant.scopeDriverIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['scopeDriverIds'],
          message: 'Opseg DRIVER_IDS traži neprazan spisak vozača.',
        });
      }
      if (grant.scopeVehicleIds && grant.scopeVehicleIds.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['scopeVehicleIds'],
          message: 'Uz opseg DRIVER_IDS nije dozvoljen spisak vozila.',
        });
      }
      return;
    }

    if (grant.scopeVehicleIds && grant.scopeVehicleIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopeVehicleIds'],
        message: `Opseg ${grant.scope} ne koristi spisak vozila.`,
      });
    }
    if (grant.scopeDriverIds && grant.scopeDriverIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopeDriverIds'],
        message: `Opseg ${grant.scope} ne koristi spisak vozača.`,
      });
    }
  });

export type PermissionGrantInput = z.output<typeof permissionGrantInputSchema>;

/** `POST /roles` — nova rola (kod je unique, `isSystem` se ne može postaviti). */
export const createRoleSchema = z
  .object({
    code: roleCodeSchema,
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullish(),
    /** Default: `ROLE_ALLOWED_CLIENT_TYPES.CUSTOM` (WEB + MOBILE_ANDROID). */
    allowedClientTypes: z.array(clientTypeSchema).min(1).max(4).optional(),
    priority: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type CreateRoleInput = z.output<typeof createRoleSchema>;

/** `PATCH /roles/:id` — kod i `isSystem` se ne mijenjaju (audit trag ostaje jasan). */
export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).nullish(),
    allowedClientTypes: z.array(clientTypeSchema).min(1).max(4).optional(),
    priority: z.number().int().min(1).max(1000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Barem jedno polje za izmjenu je obavezno.',
  });

export type UpdateRoleInput = z.output<typeof updateRoleSchema>;

/** `POST /roles/:id/archive` — razlog je opcion, ali ide u audit. */
export const archiveRoleSchema = z
  .object({
    reason: z.string().trim().min(3).max(300).optional(),
  })
  .strict();

export type ArchiveRoleInput = z.output<typeof archiveRoleSchema>;

/**
 * `PUT /roles/matrix` — bulk izmjena matrice prava (P2).
 *
 * Cijela izmjena ide u **jednoj transakciji**: grantovi se zamjenjuju po roli,
 * `Role.permissionsVersion` raste, a nakon commit-a se invalidira Redis keš
 * (`vfm:perm:*` + `vfm:permver:role:{id}`) → korisnici bez ponovne prijave
 * dobijaju 403 u ≤ 5 s (P3).
 */
export const roleMatrixUpdateSchema = z
  .object({
    roles: z
      .array(
        z
          .object({
            roleId: roleIdSchema,
            /** Puna lista grantova za rolu (prazna lista = sva prava ukinuta). */
            grants: z.array(permissionGrantInputSchema).max(400),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type RoleMatrixUpdateInput = z.output<typeof roleMatrixUpdateSchema>;

// --- Odgovori (web ih parsira ovim šemama) ---

/** Jedan red matrice: koja rola ima koju permisiju i s kojim opsegom. */
export const roleMatrixGrantSchema = z
  .object({
    roleId: roleIdSchema,
    permission: permissionCodeSchema,
    scope: permissionScopeSchema,
    scopeVehicleIds: z.array(uuidSchema),
    scopeDriverIds: z.array(uuidSchema),
    conditions: z.record(z.string(), z.unknown()).nullable(),
    grantedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type RoleMatrixGrant = z.output<typeof roleMatrixGrantSchema>;

/** Rola u listi (s brojem aktivnih korisnika — prikaz u UI-u). */
export const roleSummarySchema = z
  .object({
    id: roleIdSchema,
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    allowedClientTypes: z.array(clientTypeSchema),
    permissionsVersion: z.number().int().nonnegative(),
    priority: z.number().int(),
    activeUserCount: z.number().int().nonnegative(),
    grantedCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type RoleSummary = z.output<typeof roleSummarySchema>;

/** Rola s grantovima (`GET /roles/:id`). */
export const roleDetailSchema = roleSummarySchema.extend({ grants: z.array(roleMatrixGrantSchema) }).strict();

export type RoleDetail = z.output<typeof roleDetailSchema>;

/** Grupa kataloga (`GET /permissions`). */
export const permissionCatalogGroupSchema = z
  .object({
    module: z.string(),
    permissions: z.array(
      z
        .object({
          code: z.string(),
          action: z.string(),
          description: z.string().nullable(),
          isSensitive: z.boolean(),
          /** Da li permisija postoji u bazi (sync status za deploy provjeru). */
          inDatabase: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export type PermissionCatalogGroup = z.output<typeof permissionCatalogGroupSchema>;

/** `GET /roles/matrix` — sve što editor matrice treba u jednom odgovoru. */
export const permissionMatrixResponseSchema = z
  .object({
    modules: z.array(permissionCatalogGroupSchema),
    roles: z.array(roleSummarySchema),
    grants: z.array(roleMatrixGrantSchema),
    generatedAt: z.iso.datetime(),
  })
  .strict();

export type PermissionMatrixResponse = z.output<typeof permissionMatrixResponseSchema>;

/** Rezultat `PUT /roles/matrix` (broj izmjena po kategoriji — audit i toast u UI). */
export const roleMatrixUpdateResultSchema = z
  .object({
    affectedRoles: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    scopeChanged: z.number().int().nonnegative(),
    changed: z.array(
      z
        .object({
          roleId: roleIdSchema,
          roleCode: z.string(),
          permission: z.string(),
          before: permissionScopeSchema.nullable(),
          after: permissionScopeSchema.nullable(),
        })
        .strict(),
    ),
    permissionsVersion: z.record(roleIdSchema, z.number().int().nonnegative()),
  })
  .strict();

export type RoleMatrixUpdateResult = z.output<typeof roleMatrixUpdateResultSchema>;

/** Rezultat `POST /permissions/sync` (deploy korak). */
export const permissionSyncResultSchema = z
  .object({
    total: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  })
  .strict();

export type PermissionSyncResult = z.output<typeof permissionSyncResultSchema>;

// -----------------------------------------------------------------------------
//  Korisnici (docs/07 §2.2, docs/05 §8.2)
// -----------------------------------------------------------------------------

/** `GET /users` — paginacija + filteri. Query string dolazi kao tekst → `coerce`. */
export const userListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    /** Pretraga po e-mailu, imenu i prezimenu (case-insensitive). */
    q: z.string().trim().max(120).optional(),
    status: z.enum(USER_STATUSES).optional(),
    roleId: uuidSchema.optional(),
  })
  .strict();

export type UserListQuery = z.output<typeof userListQuerySchema>;

/** `POST /users` — lozinku generiše server (nikad se ne prima iz forme). */
export const createUserSchema = z
  .object({
    email: emailSchema,
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().min(2).max(60),
    displayName: z.string().trim().max(120).nullish(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()/-]{6,32}$/u, { message: 'Telefon nije u ispravnom formatu.' })
      .nullish(),
    timezone: z.string().trim().max(64).optional(),
    locale: z.string().trim().max(10).optional(),
    /**
     * Uloge koje korisnik dobija. Barem jedna — korisnik bez role ne može se
     * prijaviti (nema `allowedClientTypes`, pa ga `ClientTypeGuard` odbija).
     */
    roleIds: z.array(uuidSchema).min(1).max(10),
    /** Default `true`: admin ne zna lozinku korisnika, pa je mijenja pri prijavi. */
    mustChangePassword: z.boolean().optional(),
  })
  .strict();

export type CreateUserInput = z.output<typeof createUserSchema>;

/** `PATCH /users/:id` — e-mail se ne mijenja (identitet + audit trag). */
export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(2).max(60).optional(),
    lastName: z.string().trim().min(2).max(60).optional(),
    displayName: z.string().trim().max(120).nullish(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()/-]{6,32}$/u, { message: 'Telefon nije u ispravnom formatu.' })
      .nullish(),
    timezone: z.string().trim().max(64).optional(),
    locale: z.string().trim().max(10).optional(),
    /**
     * Dozvoljene tranzicije: `ACTIVE` ⇄ `SUSPENDED` ⇄ `DEACTIVATED`.
     * `PENDING_PASSWORD_CHANGE` postavlja isključivo reset lozinke.
     */
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Barem jedno polje za izmjenu je obavezno.',
  });

export type UpdateUserInput = z.output<typeof updateUserSchema>;

/** `POST /users/:id/archive` i `DELETE /users/:id` — razlog ide u audit. */
export const archiveUserSchema = z
  .object({
    reason: z.string().trim().min(3).max(300).optional(),
  })
  .strict();

export type ArchiveUserInput = z.output<typeof archiveUserSchema>;

/** `POST /users/:id/roles`. */
export const assignUserRoleSchema = z
  .object({
    roleId: uuidSchema,
    validFrom: z.iso.datetime().optional(),
    validUntil: z.iso.datetime().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export type AssignUserRoleInput = z.output<typeof assignUserRoleSchema>;

/**
 * `POST /users/:id/reset-password` — koliko token važi.
 *
 * Default 30 min (docs/05 §7); kraće je dozvoljeno (npr. 10 min za osjetljive
 * naloge), duže od 2 h nije — token putuje e-mailom/porukom.
 */
export const issuePasswordResetSchema = z
  .object({
    expiresInMinutes: z.number().int().min(5).max(120).default(30),
  })
  .strict();

export type IssuePasswordResetInput = z.output<typeof issuePasswordResetSchema>;

/** `POST /auth/reset-password` — javna ruta koja troši token. */
export const consumePasswordResetSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
    /** Politiku lozinke provjerava server (`PasswordService.assertPolicy`). */
    newPassword: z.string().min(8).max(200),
  })
  .strict();

export type ConsumePasswordResetInput = z.output<typeof consumePasswordResetSchema>;

// --- Odgovori ---

/** Korisnik u listi (PII redigovan ako akter nema `user:view_pii`). */
export const userSummarySchema = z
  .object({
    id: uuidSchema,
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    displayName: z.string().nullable(),
    phone: z.string().nullable(),
    status: z.enum(USER_STATUSES),
    mustChangePassword: z.boolean(),
    roles: z.array(authRoleSchema),
    lastLoginAt: z.iso.datetime().nullable(),
    lockedUntil: z.iso.datetime().nullable(),
    /** `true` kad su `email`/`phone` maskirani (nema `user:view_pii`). */
    piiRedacted: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type UserSummary = z.output<typeof userSummarySchema>;

export const userListResponseSchema = z
  .object({
    items: z.array(userSummarySchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();

export type UserListResponse = z.output<typeof userListResponseSchema>;

/** Detalj korisnika (`GET /users/:id`). */
export const userDetailSchema = userSummarySchema
  .extend({
    timezone: z.string(),
    locale: z.string(),
    tokenVersion: z.number().int().nonnegative(),
    activeSessions: z.number().int().nonnegative(),
  })
  .strict();

export type UserDetail = z.output<typeof userDetailSchema>;

/** `POST /users` — lozinka se prikazuje **samo** u ovom odgovoru. */
export const createUserResultSchema = z
  .object({
    user: userDetailSchema,
    temporaryPassword: z.string(),
    /** `true` = korisnik mora promijeniti lozinku pri prvoj prijavi. */
    mustChangePassword: z.boolean(),
  })
  .strict();

export type CreateUserResult = z.output<typeof createUserResultSchema>;

/** `POST /users/:id/reset-password` — token admin predaje korisniku (Faza 1). */
export const passwordResetIssuedSchema = z
  .object({
    userId: uuidSchema,
    email: z.string(),
    token: z.string(),
    expiresAt: z.iso.datetime(),
    /** U Fazi 5 token ide na e-mail (outbox) i više se ne vraća u odgovoru. */
    deliveredBy: z.literal('ADMIN'),
  })
  .strict();

export type PasswordResetIssued = z.output<typeof passwordResetIssuedSchema>;

// -----------------------------------------------------------------------------
//  Audit log (docs/07 §7, docs/05 §9)
// -----------------------------------------------------------------------------

/** Filteri za `GET /audit-logs` (`audit:view`). */
export const auditLogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    actorId: uuidSchema.optional(),
    action: z.enum(AUDIT_ACTIONS).optional(),
    entityType: z.string().trim().max(60).optional(),
    entityId: uuidSchema.optional(),
    severity: z.enum(AUDIT_SEVERITIES).optional(),
    /** ISO datum/vrijeme — uključivo (`createdAt >= from`). */
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
    message: '`from` ne smije biti poslije `to`.',
  });

export type AuditLogQuery = z.output<typeof auditLogQuerySchema>;

/** Jedan red u listi (bez `before`/`after` — preteško za tabelu). */
export const auditLogSummarySchema = z
  .object({
    /** `AuditLog.id` je BIGINT u bazi; u JSON-u je **string** (bez gubitka preciznosti). */
    id: z.string(),
    action: z.enum(AUDIT_ACTIONS),
    severity: z.enum(AUDIT_SEVERITIES),
    actorId: uuidSchema.nullable(),
    actorEmail: z.string().nullable(),
    actorRoles: z.array(z.string()),
    entityType: z.string().nullable(),
    entityId: uuidSchema.nullable(),
    changedFields: z.array(z.string()),
    reason: z.string().nullable(),
    requestId: z.string().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    clientType: z.enum(CLIENT_TYPES).nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type AuditLogSummary = z.output<typeof auditLogSummarySchema>;

export const auditLogListResponseSchema = z
  .object({
    items: z.array(auditLogSummarySchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    /** `true` kad su SECURITY redovi sakriveni (nema `audit:view_security`). */
    securityHidden: z.boolean(),
  })
  .strict();

export type AuditLogListResponse = z.output<typeof auditLogListResponseSchema>;

/** Detalj: `before`/`after` diff (za modal „šta se promijenilo"). */
export const auditLogDetailSchema = auditLogSummarySchema
  .extend({
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

export type AuditLogDetail = z.output<typeof auditLogDetailSchema>;

// -----------------------------------------------------------------------------
//  Forme (docs/04 §12, docs/07 §2.9)
// -----------------------------------------------------------------------------

/**
 * Definicija forme (`FormSchemaVersion.definition`) stiže kao JSON i validira se
 * u `@vfm/form-engine` (`parseDefinition`) — ovdje se ne duplira meta-shema, da
 * ne postoje dva izvora istine. Oblik je uvijek objekat.
 */
export const formDefinitionBodySchema = z.record(z.string(), z.unknown());

/** `FormSchema.key` — stabilan identifikator forme (mijenja se nikad). */
export const formSchemaKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{2,48}$/u, 'Ključ forme mora biti ^[a-z][a-z0-9_]{2,48}$.');

const formNameSchema = z.string().trim().min(3).max(120);
const changeNoteSchema = z
  .string()
  .trim()
  .min(5, 'Bilješka o promjeni je obavezna (najmanje 5 znakova).')
  .max(500);

export const createFormSchemaSchema = z
  .object({
    key: formSchemaKeySchema,
    name: formNameSchema,
    subject: z.enum(FORM_SUBJECTS),
    taskTypeId: uuidSchema.nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    ownerModule: z.string().trim().max(60).nullable().optional(),
    /** Prva verzija se kreira kao `DRAFT` s ovom definicijom. */
    definition: formDefinitionBodySchema,
  })
  .strict();
export type CreateFormSchemaInput = z.output<typeof createFormSchemaSchema>;

export const updateFormSchemaSchema = z
  .object({
    name: formNameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    taskTypeId: uuidSchema.nullable().optional(),
    ownerModule: z.string().trim().max(60).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nema šta mijenjati.' });
export type UpdateFormSchemaInput = z.output<typeof updateFormSchemaSchema>;

export const createFormVersionSchema = z
  .object({
    /** Ako je zadato, nova verzija kopira definiciju te verzije iste forme. */
    copyFromVersionId: uuidSchema.optional(),
    definition: formDefinitionBodySchema.optional(),
  })
  .strict()
  .refine((value) => (value.copyFromVersionId === undefined) !== (value.definition === undefined), {
    message: 'Zadaj ili `copyFromVersionId` ili `definition` (ne oba).',
  });
export type CreateFormVersionInput = z.output<typeof createFormVersionSchema>;

export const updateFormVersionSchema = z.object({ definition: formDefinitionBodySchema }).strict();
export type UpdateFormVersionInput = z.output<typeof updateFormVersionSchema>;

export const publishFormVersionSchema = z
  .object({
    changeNote: changeNoteSchema,
    /** Objava forme s poljem bez mobilne kontrole (docs/04 §8/7). */
    allowWebOnly: z.boolean().optional(),
    /** Potvrda da se mapirano polje smije ukloniti bez migracije zapisa. */
    confirmNormalizedRemoval: z.boolean().optional(),
  })
  .strict();
export type PublishFormVersionInput = z.output<typeof publishFormVersionSchema>;

export const retireFormVersionSchema = z.object({ changeNote: changeNoteSchema }).strict();
export type RetireFormVersionInput = z.output<typeof retireFormVersionSchema>;

export const formSchemaListQuerySchema = z
  .object({
    subject: z.enum(FORM_SUBJECTS).optional(),
    status: z.enum(FORM_SCHEMA_STATUSES).optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict();
export type FormSchemaListQuery = z.output<typeof formSchemaListQuerySchema>;

export const activeFormSchemaQuerySchema = z
  .object({
    subject: z.enum(FORM_SUBJECTS),
    taskTypeId: uuidSchema.optional(),
  })
  .strict();
export type ActiveFormSchemaQuery = z.output<typeof activeFormSchemaQuerySchema>;

export const validateFormValuesSchema = z
  .object({
    values: z.record(z.string(), z.unknown()),
    isNew: z.boolean().default(true),
  })
  .strict();
export type ValidateFormValuesInput = z.output<typeof validateFormValuesSchema>;

// --- Odgovori ---------------------------------------------------------------

export const formVersionSummarySchema = z
  .object({
    id: uuidSchema,
    version: z.number().int().positive(),
    status: z.enum(FORM_SCHEMA_STATUSES),
    changeNote: z.string().nullable(),
    contentHash: z.string().nullable(),
    mobileCompatible: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    publishedById: uuidSchema.nullable(),
    retiredAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    /** Broj zapisa koji koriste ovu verziju (za upozorenje pri povlačenju). */
    recordCount: z.number().int().nonnegative(),
  })
  .strict();
export type FormVersionSummary = z.output<typeof formVersionSummarySchema>;

export const formSchemaSummarySchema = z
  .object({
    id: uuidSchema,
    key: z.string(),
    name: z.string(),
    subject: z.enum(FORM_SUBJECTS),
    taskTypeId: uuidSchema.nullable(),
    description: z.string().nullable(),
    ownerModule: z.string().nullable(),
    status: z.enum(FORM_SCHEMA_STATUSES),
    currentPublishedVersionId: uuidSchema.nullable(),
    currentPublishedVersion: z.number().int().positive().nullable(),
    versionCount: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type FormSchemaSummary = z.output<typeof formSchemaSummarySchema>;

export const formSchemaDetailSchema = formSchemaSummarySchema
  .extend({
    versions: z.array(formVersionSummarySchema),
  })
  .strict();
export type FormSchemaDetail = z.output<typeof formSchemaDetailSchema>;

export const formVersionDetailSchema = formVersionSummarySchema
  .extend({
    formSchemaId: uuidSchema,
    definition: formDefinitionBodySchema,
    normalizedName: z.array(z.record(z.string(), z.unknown())).nullable(),
  })
  .strict();
export type FormVersionDetail = z.output<typeof formVersionDetailSchema>;

export const formFieldErrorSchema = z
  .object({
    key: z.string(),
    code: z.string(),
    message: z.string(),
  })
  .strict();
export type FormFieldError = z.output<typeof formFieldErrorSchema>;

export const formValidationResponseSchema = z
  .object({
    ok: z.boolean(),
    formSchemaVersionId: uuidSchema,
    formSchemaVersion: z.number().int().positive(),
    /** `FORM_VERSION_NOT_PUBLISHED` kad verzija ne prima zapise. */
    versionError: z.string().nullable(),
    values: z.record(z.string(), z.unknown()),
    computed: z.record(z.string(), z.unknown()),
    normalized: z.record(z.string(), z.unknown()),
    errors: z.array(formFieldErrorSchema),
    warnings: z.array(formFieldErrorSchema),
  })
  .strict();
export type FormValidationResponse = z.output<typeof formValidationResponseSchema>;

export const formVersionRefSchema = z
  .object({ id: uuidSchema, version: z.number().int().positive() })
  .strict();
export type FormVersionRef = z.output<typeof formVersionRefSchema>;

export const formVersionDiffSchema = z
  .object({
    from: formVersionRefSchema,
    to: formVersionRefSchema,
    meta: z.array(z.object({ path: z.string(), before: z.unknown(), after: z.unknown() }).strict()),
    addedFields: z.array(z.string()),
    removedFields: z.array(z.string()),
    changedFields: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          changes: z.array(z.object({ path: z.string(), before: z.unknown(), after: z.unknown() }).strict()),
        })
        .strict(),
    ),
    addedSections: z.array(z.string()),
    removedSections: z.array(z.string()),
    normalizationChanged: z.boolean(),
    empty: z.boolean(),
  })
  .strict();
export type FormVersionDiff = z.output<typeof formVersionDiffSchema>;

export const activeFormSchemaSchema = z
  .object({
    formSchemaId: uuidSchema,
    key: z.string(),
    name: z.string(),
    subject: z.enum(FORM_SUBJECTS),
    formSchemaVersionId: uuidSchema,
    version: z.number().int().positive(),
    /** Vrijednost `ETag` zaglavlja (SHA-256 kanonskog JSON-a definicije). */
    contentHash: z.string(),
    mobileCompatible: z.boolean(),
    definition: formDefinitionBodySchema,
  })
  .strict();
export type ActiveFormSchema = z.output<typeof activeFormSchemaSchema>;

// --- Migracija zapisa (P12, docs/04 §10) -------------------------------------

export const createFormMigrationSchema = z
  .object({
    formSchemaId: uuidSchema,
    fromVersionId: uuidSchema,
    toVersionId: uuidSchema,
    targetEntityType: z.enum(MIGRATION_TARGET_ENTITIES),
    /** Eksplicitan izbor zapisa; prazno = svi zapisi na `fromVersionId`. */
    entityIds: z.array(uuidSchema).max(10_000).optional(),
    /** Dodatni filter (samo `createdFrom`/`createdTo`, ISO datum). */
    filter: z
      .object({
        createdFrom: z.iso.datetime().optional(),
        createdTo: z.iso.datetime().optional(),
      })
      .strict()
      .optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => value.fromVersionId !== value.toVersionId, {
    message: 'Verzija izvora i cilja ne mogu biti iste.',
  });
export type CreateFormMigrationInput = z.output<typeof createFormMigrationSchema>;

export const runFormMigrationSchema = z.object({ changeNote: changeNoteSchema }).strict();
export type RunFormMigrationInput = z.output<typeof runFormMigrationSchema>;

export const rollbackFormMigrationSchema = z
  .object({
    changeNote: changeNoteSchema,
    /** Rollback samo označenih zapisa; prazno = svi primijenjeni. */
    entityIds: z.array(uuidSchema).max(10_000).optional(),
  })
  .strict();
export type RollbackFormMigrationInput = z.output<typeof rollbackFormMigrationSchema>;

export const migrationSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    ok: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .strict();
export type MigrationSummary = z.output<typeof migrationSummarySchema>;

export const migrationItemPreviewSchema = z
  .object({
    entityId: uuidSchema,
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    status: z.string(),
    errors: z.array(formFieldErrorSchema),
  })
  .strict();
export type MigrationItemPreview = z.output<typeof migrationItemPreviewSchema>;

export const formMigrationJobSchema = z
  .object({
    id: uuidSchema,
    formSchemaId: uuidSchema,
    fromVersionId: uuidSchema,
    toVersionId: uuidSchema,
    targetEntityType: z.enum(MIGRATION_TARGET_ENTITIES),
    status: z.enum(MIGRATION_JOB_STATUSES),
    summary: migrationSummarySchema.nullable(),
    notes: z.string().nullable(),
    requestedById: uuidSchema.nullable(),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type FormMigrationJob = z.output<typeof formMigrationJobSchema>;

export const formMigrationPreviewSchema = formMigrationJobSchema
  .extend({
    summary: migrationSummarySchema,
    /** Uzorak prvih 50 zapisa (diff po polju). */
    items: z.array(migrationItemPreviewSchema),
  })
  .strict();
export type FormMigrationPreview = z.output<typeof formMigrationPreviewSchema>;

// -----------------------------------------------------------------------------
//  Vozila (docs/07 §2.5, docs/03 §3.3)
// -----------------------------------------------------------------------------

export const vehicleStatusSchema = z.enum(VEHICLE_STATUSES);
export const fuelTypeSchema = z.enum(FUEL_TYPES);
export const ownershipTypeSchema = z.enum(OWNERSHIP_TYPES);

/**
 * Query parametri su uvijek stringovi; `z.coerce.boolean()` bi `"false"` pretvorio
 * u `true`, pa se `true`/`false` čita eksplicitno.
 */
const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Meta podaci vozila koji ne dolaze iz dinamičke forme. */
const vehicleMetaShape = {
  notes: z.string().trim().max(2000).nullable().optional(),
  costCenter: z.string().trim().max(60).nullable().optional(),
  ownershipType: ownershipTypeSchema.optional(),
  acquisitionDate: z.iso.date().nullable().optional(),
  acquisitionPrice: z.number().int().nonnegative().nullable().optional(),
};

/**
 * Strukturirani (identitet) dio vozila — **ne** dolazi iz forme: `internalNo`,
 * `make`, `model` i `fuelType` su obavezne kolone tabele, a forma popunjava samo
 * kolone iz `NORMALIZATION_COLUMNS.VEHICLE` (docs/04 §7).
 */
const vehicleCoreShape = {
  internalNo: z.string().trim().min(1).max(20),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  /** VIN je 17 znakova; `null` = nije poznat. */
  vin: z.string().trim().length(17).nullable().optional(),
  fuelType: fuelTypeSchema,
};

export const createVehicleSchema = z
  .object({
    ...vehicleCoreShape,
    /** Vrijednosti dinamičke forme — validiraju se prema tačnoj verziji (P11). */
    formData: z.record(z.string(), z.unknown()).default({}),
    /** Bez ovoga se koristi aktivna objavljena `VEHICLE` forma. */
    formSchemaVersionId: uuidSchema.optional(),
    ...vehicleMetaShape,
  })
  .strict();
export type CreateVehicleInput = z.output<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    /** Optimističko zaključavanje (`Vehicle.version`). */
    version: z.number().int().nonnegative(),
    internalNo: vehicleCoreShape.internalNo.optional(),
    make: vehicleCoreShape.make.optional(),
    model: vehicleCoreShape.model.optional(),
    year: vehicleCoreShape.year,
    vin: vehicleCoreShape.vin,
    fuelType: vehicleCoreShape.fuelType.optional(),
    formData: z.record(z.string(), z.unknown()).optional(),
    status: vehicleStatusSchema.optional(),
    ...vehicleMetaShape,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: 'Nema šta mijenjati.' });
export type UpdateVehicleInput = z.output<typeof updateVehicleSchema>;

export const archiveVehicleSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export type ArchiveVehicleInput = z.output<typeof archiveVehicleSchema>;

export const vehicleListQuerySchema = paginationQuerySchema
  .extend({
    status: vehicleStatusSchema.optional(),
    fuelType: fuelTypeSchema.optional(),
    /** Arhivirana vozila se ne prikazuju osim kad se izričito traže. */
    includeArchived: queryBoolean.default(false),
    /** Vozila kojima registracija ili osiguranje ističe u narednih N dana. */
    expiringInDays: z.coerce.number().int().min(0).max(365).optional(),
  })
  .strict();
export type VehicleListQuery = z.output<typeof vehicleListQuerySchema>;

export const vehicleSummarySchema = z
  .object({
    id: uuidSchema,
    internalNo: z.string(),
    make: z.string(),
    model: z.string(),
    year: z.number().int().nullable(),
    plateNumber: z.string().nullable(),
    fuelType: fuelTypeSchema,
    status: vehicleStatusSchema,
    odometerKm: z.number().int().nonnegative(),
    odometerUpdatedAt: z.iso.datetime().nullable(),
    registrationExpiresAt: z.iso.date().nullable(),
    insuranceExpiresAt: z.iso.date().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    version: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type VehicleSummary = z.output<typeof vehicleSummarySchema>;

export const vehicleDetailSchema = vehicleSummarySchema
  .extend({
    vin: z.string().nullable(),
    transmission: z.string().nullable(),
    color: z.string().nullable(),
    bodyType: z.string().nullable(),
    engineCcm: z.number().int().nullable(),
    enginePowerKw: z.number().int().nullable(),
    seats: z.number().int().nullable(),
    ownershipType: z.string(),
    acquisitionDate: z.iso.date().nullable(),
    acquisitionPrice: z.number().int().nullable(),
    costCenter: z.string().nullable(),
    nextServiceDueDate: z.iso.date().nullable(),
    nextServiceDueKm: z.number().int().nullable(),
    notes: z.string().nullable(),
    photoAttachmentId: uuidSchema.nullable(),
    formSchemaId: uuidSchema,
    /** Verzija forme kojom je zapis nastao (P10) — nikad se ne prepisuje „u mjesto". */
    formSchemaVersionId: uuidSchema,
    formData: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type VehicleDetail = z.output<typeof vehicleDetailSchema>;

export const vehicleListResponseSchema = z
  .object({
    items: z.array(vehicleSummarySchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type VehicleListResponse = z.output<typeof vehicleListResponseSchema>;

// -----------------------------------------------------------------------------
//  Kilometraža (docs/07 §2.5, docs/03 §3.3)
// -----------------------------------------------------------------------------

export const odometerSourceSchema = z.enum(ODOMETER_SOURCES);

/** `POST /vehicles/:id/odometer` — nova vrijednost ne smije biti manja od zatečene. */
export const createOdometerReadingSchema = z
  .object({
    valueKm: z.number().int().min(0).max(5_000_000),
    source: odometerSourceSchema.default('MANUAL'),
    /** Vrijeme očitanja; bez njega je „sada" (server). */
    readingAt: z.iso.datetime().optional(),
    /** Veza na zapis koji je izvor (zadatak, servis…). */
    referenceType: z.string().trim().max(40).optional(),
    referenceId: uuidSchema.optional(),
  })
  .strict();
export type CreateOdometerReadingInput = z.output<typeof createOdometerReadingSchema>;

/** `POST /vehicles/:id/odometer/correct` — niža vrijednost samo s razlogom. */
export const correctOdometerReadingSchema = createOdometerReadingSchema
  .extend({
    correctionReason: z.string().trim().min(5, 'Razlog korekcije je obavezan.').max(500),
  })
  .strict();
export type CorrectOdometerReadingInput = z.output<typeof correctOdometerReadingSchema>;

export const odometerReadingSchema = z
  .object({
    id: uuidSchema,
    vehicleId: uuidSchema,
    valueKm: z.number().int().nonnegative(),
    source: odometerSourceSchema,
    readingAt: z.iso.datetime(),
    isCorrection: z.boolean(),
    correctionReason: z.string().nullable(),
    previousValueKm: z.number().int().nullable(),
    recordedById: uuidSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type OdometerReading = z.output<typeof odometerReadingSchema>;

export const odometerListResponseSchema = z
  .object({
    items: z.array(odometerReadingSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type OdometerListResponse = z.output<typeof odometerListResponseSchema>;

// -----------------------------------------------------------------------------
//  Vozači (docs/07 §2.4, docs/03 §3.3)
// -----------------------------------------------------------------------------

export const driverStatusSchema = z.enum(DRIVER_STATUSES);

/**
 * Strukturirani dio vozača — **ne** dolazi iz forme.
 *
 * Forma (`DRIVER`) nosi dodatna polja (napomene, dokumenti…), ali identitet i
 * PII su kolone tabele: bez njih lista, pretraga i rokovi dozvole ne rade, a
 * `NORMALIZATION_COLUMNS.DRIVER` ne postoji (docs/04 §7) — forma ne smije
 * puniti kolone vozača.
 */
const driverCoreShape = {
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  employeeNumber: z.string().trim().max(40).nullable().optional(),
  /** Šifra iz šifarnika `DRIVER_EMPLOYMENT_STATUS` (U-21). */
  employmentStatus: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};

/** PII polja (B-20) — vraćaju se samo uz `driver:view_pii`; upis traži `driver:update`. */
const driverPiiShape = {
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.email().max(200).nullable().optional(),
  dateOfBirth: z.iso.date().nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  licenseNumber: z.string().trim().max(40).nullable().optional(),
};

const driverLicenseShape = {
  licenseIssuedAt: z.iso.date().nullable().optional(),
  licenseExpiresAt: z.iso.date().nullable().optional(),
  licenseIssuingAuthority: z.string().trim().max(120).nullable().optional(),
  restrictions: z.string().trim().max(500).nullable().optional(),
};

export const createDriverSchema = z
  .object({
    ...driverCoreShape,
    ...driverPiiShape,
    ...driverLicenseShape,
    /** Vrijednosti dinamičke forme — validiraju se prema tačnoj verziji (P11). */
    formData: z.record(z.string(), z.unknown()).default({}),
    /** Bez ovoga se koristi aktivna objavljena `DRIVER` forma. */
    formSchemaVersionId: uuidSchema.optional(),
  })
  .strict();
export type CreateDriverInput = z.output<typeof createDriverSchema>;

export const updateDriverSchema = z
  .object({
    /** Optimističko zaključavanje (`Driver.version`). */
    version: z.number().int().nonnegative(),
    firstName: driverCoreShape.firstName.optional(),
    lastName: driverCoreShape.lastName.optional(),
    employeeNumber: driverCoreShape.employeeNumber,
    employmentStatus: driverCoreShape.employmentStatus,
    notes: driverCoreShape.notes,
    phone: driverPiiShape.phone,
    email: driverPiiShape.email,
    dateOfBirth: driverPiiShape.dateOfBirth,
    address: driverPiiShape.address,
    licenseNumber: driverPiiShape.licenseNumber,
    licenseIssuedAt: driverLicenseShape.licenseIssuedAt,
    licenseExpiresAt: driverLicenseShape.licenseExpiresAt,
    licenseIssuingAuthority: driverLicenseShape.licenseIssuingAuthority,
    restrictions: driverLicenseShape.restrictions,
    formData: z.record(z.string(), z.unknown()).optional(),
    status: driverStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: 'Nema šta mijenjati.' });
export type UpdateDriverInput = z.output<typeof updateDriverSchema>;

export const archiveDriverSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export type ArchiveDriverInput = z.output<typeof archiveDriverSchema>;

export const driverListQuerySchema = paginationQuerySchema
  .extend({
    status: driverStatusSchema.optional(),
    /** Arhivirani vozači se ne prikazuju osim kad se izričito traže. */
    includeArchived: queryBoolean.default(false),
    /** Vozači kojima vozačka dozvola ističe u narednih N dana. */
    expiringInDays: z.coerce.number().int().min(0).max(365).optional(),
    /** Vozači s datom kategorijom (npr. `C`, `CE`). */
    licenseCategory: z.string().trim().min(1).max(5).optional(),
  })
  .strict();
export type DriverListQuery = z.output<typeof driverListQuerySchema>;

export const driverLicenseCategorySchema = z
  .object({
    id: uuidSchema,
    category: z.string(),
    issuedAt: z.iso.date().nullable(),
    expiresAt: z.iso.date().nullable(),
    restrictions: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .strict();
export type DriverLicenseCategory = z.output<typeof driverLicenseCategorySchema>;

/** `GET /drivers/:id/license-categories` — kratka lista, bez paginacije. */
export const driverLicenseCategoryListSchema = z
  .object({ items: z.array(driverLicenseCategorySchema) })
  .strict();
export type DriverLicenseCategoryList = z.output<typeof driverLicenseCategoryListSchema>;

/** Vozač u listi — PII redigovan ako akter nema `driver:view_pii` (docs/05 §8.2). */
export const driverSummarySchema = z
  .object({
    id: uuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    employeeNumber: z.string().nullable(),
    employmentStatus: z.string().nullable(),
    status: driverStatusSchema,
    /** Datum isteka dozvole **nije** PII — nosi ga rok/podsjetnik. */
    licenseExpiresAt: z.iso.date().nullable(),
    categories: z.array(z.string()),
    /** Broj dana do isteka dozvole; negativan = istekla (računa server). */
    licenseDaysLeft: z.number().int().nullable(),
    version: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type DriverSummary = z.output<typeof driverSummarySchema>;

export const driverDetailSchema = driverSummarySchema
  .extend({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    dateOfBirth: z.iso.date().nullable(),
    address: z.string().nullable(),
    licenseNumber: z.string().nullable(),
    licenseIssuedAt: z.iso.date().nullable(),
    licenseIssuingAuthority: z.string().nullable(),
    restrictions: z.string().nullable(),
    notes: z.string().nullable(),
    photoAttachmentId: uuidSchema.nullable(),
    formSchemaId: uuidSchema,
    formSchemaVersionId: uuidSchema,
    formData: z.record(z.string(), z.unknown()),
    /** `true` kad su PII polja maskirana/izostavljena (nema `driver:view_pii`). */
    piiRedacted: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DriverDetail = z.output<typeof driverDetailSchema>;

export const driverListResponseSchema = z
  .object({
    items: z.array(driverSummarySchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type DriverListResponse = z.output<typeof driverListResponseSchema>;

/** `POST /drivers/:id/license-categories`. */
export const createDriverLicenseCategorySchema = z
  .object({
    category: z.string().trim().min(1).max(5),
    issuedAt: z.iso.date().nullable().optional(),
    expiresAt: z.iso.date().nullable().optional(),
    restrictions: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((value) => !value.issuedAt || !value.expiresAt || value.expiresAt >= value.issuedAt, {
    message: 'Datum isteka ne može biti prije datuma izdavanja.',
    path: ['expiresAt'],
  });
export type CreateDriverLicenseCategoryInput = z.output<typeof createDriverLicenseCategorySchema>;

/** `PATCH /drivers/:id/license-categories/:catId` — kategorija se ne mijenja (briše se i dodaje). */
export const updateDriverLicenseCategorySchema = z
  .object({
    issuedAt: z.iso.date().nullable().optional(),
    expiresAt: z.iso.date().nullable().optional(),
    restrictions: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
export type UpdateDriverLicenseCategoryInput = z.output<typeof updateDriverLicenseCategorySchema>;

// -----------------------------------------------------------------------------
//  Registracije i osiguranje (docs/07 §2.6, docs/03 §3.3)
// -----------------------------------------------------------------------------

export const recordStatusSchema = z.enum(RECORD_STATUSES);

/**
 * Zajednička pravila perioda (B-10).
 *
 * Preklapanje se provjerava u servisu (prijateljska `409 PERIOD_OVERLAP` s
 * `conflictingId`), a baza ga čuva `EXCLUDE USING gist` constraintom — servis
 * mapira i sirovu grešku baze na isti kod, jer dvije paralelne prijave mogu
 * proći provjeru u isto vrijeme.
 */
const periodShape = {
  validFrom: z.iso.date(),
  validUntil: z.iso.date(),
};

const periodRefine = (value: { validFrom?: string; validUntil?: string }) =>
  !value.validFrom || !value.validUntil || value.validUntil >= value.validFrom;

const periodRefineOptions = {
  message: 'Datum isteka ne može biti prije datuma početka.',
  path: ['validUntil'],
};

// --- Registracije -----------------------------------------------------------

export const createRegistrationSchema = z
  .object({
    vehicleId: uuidSchema,
    registrationNumber: z.string().trim().min(1).max(40),
    ...periodShape,
    issuedBy: z.string().trim().max(120).nullable().optional(),
    /** Trošak u feningama (BAM × 100) — novac se nikad ne šalje kao decimala. */
    costAmount: z.number().int().nonnegative().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    attachmentIds: z.array(uuidSchema).max(20).optional(),
    formData: z.record(z.string(), z.unknown()).default({}),
    formSchemaVersionId: uuidSchema.optional(),
  })
  .strict()
  .refine(periodRefine, periodRefineOptions);
export type CreateRegistrationInput = z.output<typeof createRegistrationSchema>;

export const updateRegistrationSchema = z
  .object({
    version: z.number().int().nonnegative(),
    registrationNumber: z.string().trim().min(1).max(40).optional(),
    validFrom: periodShape.validFrom.optional(),
    validUntil: periodShape.validUntil.optional(),
    issuedBy: z.string().trim().max(120).nullable().optional(),
    costAmount: z.number().int().nonnegative().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    attachmentIds: z.array(uuidSchema).max(20).optional(),
    status: recordStatusSchema.optional(),
    formData: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(periodRefine, periodRefineOptions)
  .refine((value) => Object.keys(value).length > 1, { message: 'Nema šta mijenjati.' });
export type UpdateRegistrationInput = z.output<typeof updateRegistrationSchema>;

export const registrationListQuerySchema = paginationQuerySchema
  .extend({
    vehicleId: uuidSchema.optional(),
    status: recordStatusSchema.optional(),
    /** Aktivne registracije kojima `validUntil` pada u narednih N dana. */
    expiringInDays: z.coerce.number().int().min(0).max(365).optional(),
  })
  .strict();
export type RegistrationListQuery = z.output<typeof registrationListQuerySchema>;

export const registrationRecordSchema = z
  .object({
    id: uuidSchema,
    vehicleId: uuidSchema,
    registrationNumber: z.string(),
    validFrom: z.iso.date(),
    validUntil: z.iso.date(),
    issuedBy: z.string().nullable(),
    costAmount: z.number().int().nullable(),
    currency: z.string(),
    status: recordStatusSchema,
    notes: z.string().nullable(),
    attachmentIds: z.array(uuidSchema),
    /** Broj dana do isteka; negativan = istekla (računa server). */
    daysLeft: z.number().int().nullable(),
    formSchemaId: uuidSchema,
    formSchemaVersionId: uuidSchema,
    formData: z.record(z.string(), z.unknown()),
    version: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type RegistrationRecord = z.output<typeof registrationRecordSchema>;

export const registrationListResponseSchema = z
  .object({
    items: z.array(registrationRecordSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type RegistrationListResponse = z.output<typeof registrationListResponseSchema>;

// --- Osiguranje -------------------------------------------------------------

export const createInsuranceSchema = z
  .object({
    vehicleId: uuidSchema,
    policyNumber: z.string().trim().max(60).nullable().optional(),
    insuranceCompany: z.string().trim().max(120).nullable().optional(),
    /** Vrsta pokrića (`KASKO`, `ODGOVORNOST`, `PUTNIKO`, …). */
    type: z.string().trim().max(40).nullable().optional(),
    ...periodShape,
    premiumAmount: z.number().int().nonnegative().nullable().optional(),
    deductibleAmount: z.number().int().nonnegative().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    attachmentIds: z.array(uuidSchema).max(20).optional(),
    formData: z.record(z.string(), z.unknown()).default({}),
    formSchemaVersionId: uuidSchema.optional(),
  })
  .strict()
  .refine(periodRefine, periodRefineOptions);
export type CreateInsuranceInput = z.output<typeof createInsuranceSchema>;

export const updateInsuranceSchema = z
  .object({
    version: z.number().int().nonnegative(),
    policyNumber: z.string().trim().max(60).nullable().optional(),
    insuranceCompany: z.string().trim().max(120).nullable().optional(),
    type: z.string().trim().max(40).nullable().optional(),
    validFrom: periodShape.validFrom.optional(),
    validUntil: periodShape.validUntil.optional(),
    premiumAmount: z.number().int().nonnegative().nullable().optional(),
    deductibleAmount: z.number().int().nonnegative().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    attachmentIds: z.array(uuidSchema).max(20).optional(),
    status: recordStatusSchema.optional(),
    formData: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(periodRefine, periodRefineOptions)
  .refine((value) => Object.keys(value).length > 1, { message: 'Nema šta mijenjati.' });
export type UpdateInsuranceInput = z.output<typeof updateInsuranceSchema>;

export const insuranceListQuerySchema = paginationQuerySchema
  .extend({
    vehicleId: uuidSchema.optional(),
    status: recordStatusSchema.optional(),
    type: z.string().trim().max(40).optional(),
    expiringInDays: z.coerce.number().int().min(0).max(365).optional(),
  })
  .strict();
export type InsuranceListQuery = z.output<typeof insuranceListQuerySchema>;

export const insuranceRecordSchema = z
  .object({
    id: uuidSchema,
    vehicleId: uuidSchema,
    policyNumber: z.string().nullable(),
    insuranceCompany: z.string().nullable(),
    type: z.string().nullable(),
    validFrom: z.iso.date(),
    validUntil: z.iso.date(),
    premiumAmount: z.number().int().nullable(),
    deductibleAmount: z.number().int().nullable(),
    currency: z.string(),
    status: recordStatusSchema,
    notes: z.string().nullable(),
    attachmentIds: z.array(uuidSchema),
    daysLeft: z.number().int().nullable(),
    formSchemaId: uuidSchema,
    formSchemaVersionId: uuidSchema,
    formData: z.record(z.string(), z.unknown()),
    version: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type InsuranceRecord = z.output<typeof insuranceRecordSchema>;

export const insuranceListResponseSchema = z
  .object({
    items: z.array(insuranceRecordSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type InsuranceListResponse = z.output<typeof insuranceListResponseSchema>;

// -----------------------------------------------------------------------------
//  Podsjetnici (docs/07 §2.14, docs/03 §3.8, P-07)
// -----------------------------------------------------------------------------

export const reminderKindSchema = z.enum(REMINDER_KINDS);
export const reminderStatusSchema = z.enum(REMINDER_STATUSES);

/**
 * Politika podsjetnika — jedan red po vrsti (`kind` je unique).
 *
 * Default prag je **5 dana** (zahtjev Faze 3); `thresholdsKm` je prazan jer se
 * kilometraža koristi samo za `SERVICE_KM`.
 */
export const updateReminderPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    thresholdsDays: z.array(z.number().int().min(0).max(365)).max(10).optional(),
    thresholdsKm: z.array(z.number().int().min(0).max(100_000)).max(10).optional(),
    channels: z.array(z.enum(NOTIFICATION_CHANNELS)).max(4).optional(),
    escalate: z.boolean().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nema šta mijenjati.' });
export type UpdateReminderPolicyInput = z.output<typeof updateReminderPolicySchema>;

export const reminderPolicySchema = z
  .object({
    id: uuidSchema,
    kind: reminderKindSchema,
    enabled: z.boolean(),
    thresholdsDays: z.array(z.number().int()),
    thresholdsKm: z.array(z.number().int()),
    channels: z.array(z.string()),
    escalate: z.boolean(),
    notes: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ReminderPolicy = z.output<typeof reminderPolicySchema>;

export const reminderPolicyListSchema = z.object({ items: z.array(reminderPolicySchema) }).strict();
export type ReminderPolicyList = z.output<typeof reminderPolicyListSchema>;

export const reminderListQuerySchema = paginationQuerySchema
  .extend({
    kind: reminderKindSchema.optional(),
    status: reminderStatusSchema.optional(),
    entityType: z.string().trim().max(40).optional(),
    entityId: uuidSchema.optional(),
    /** Podsjetnici koji padaju u narednih N dana (`fireAt <= now + N`). */
    dueWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  })
  .strict();
export type ReminderListQuery = z.output<typeof reminderListQuerySchema>;

export const scheduledReminderSchema = z
  .object({
    id: uuidSchema,
    kind: reminderKindSchema,
    entityType: z.string(),
    entityId: z.string(),
    dueDate: z.iso.date().nullable(),
    dueKm: z.number().int().nullable(),
    thresholdDays: z.number().int().nullable(),
    thresholdKm: z.number().int().nullable(),
    fireAt: z.iso.datetime(),
    status: reminderStatusSchema,
    sentAt: z.iso.datetime().nullable(),
    acknowledgedAt: z.iso.datetime().nullable(),
    /** `true` kad je `fireAt` već prošao, a podsjetnik još nije poslan. */
    due: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ScheduledReminder = z.output<typeof scheduledReminderSchema>;

export const reminderListResponseSchema = z
  .object({
    items: z.array(scheduledReminderSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type ReminderListResponse = z.output<typeof reminderListResponseSchema>;

/** `POST /reminders/:id/snooze` — odgađanje u danima (1–90). */
export const snoozeReminderSchema = z.object({ days: z.number().int().min(1).max(90) }).strict();
export type SnoozeReminderInput = z.output<typeof snoozeReminderSchema>;

/** Rezultat skenera — koliko je kandidata nađeno i koliko je stvarno upisano. */
export const reminderScanResultSchema = z
  .object({
    candidates: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    scannedAt: z.iso.datetime(),
  })
  .strict();
export type ReminderScanResult = z.output<typeof reminderScanResultSchema>;

// -----------------------------------------------------------------------------
//  20) Prilozi (docs/07 §2.12)
// -----------------------------------------------------------------------------

/** Vlasnik priloga — entitet na koji je fajl vezan (`complete` korak). */
export const attachmentOwnerTypeSchema = z.enum(ATTACHMENT_OWNER_TYPES);
export const attachmentStageSchema = z.enum(ATTACHMENT_STAGES);

/** Metapodaci priloga (nikad bajtovi — sadržaj ide kroz `/content`). */
export const attachmentSchema = z
  .object({
    id: uuidSchema,
    ownerType: attachmentOwnerTypeSchema,
    ownerId: uuidSchema,
    stage: attachmentStageSchema,
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    ext: z.string().min(1),
    /** `BigInt` u bazi, u API-ju `number` (limit je 5 × `MAX_FILE_SIZE_BYTES`). */
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().length(64),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    exifStripped: z.boolean(),
    uploadedById: uuidSchema,
    taskId: uuidSchema.nullable(),
    formFieldKey: z.string().nullable(),
    createdAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type Attachment = z.output<typeof attachmentSchema>;

/** Odgovor `POST /attachments` — dovoljno za `complete` i za optimistic UI. */
export const attachmentUploadResultSchema = z
  .object({
    id: uuidSchema,
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    ext: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().length(64),
  })
  .strict();
export type AttachmentUploadResult = z.output<typeof attachmentUploadResultSchema>;

/** `POST /attachments/complete` — vezivanje upload-a na vlasnika. */
export const completeAttachmentSchema = z
  .object({
    /** ID upload-a kojem se dodaje vlasnik. */
    id: uuidSchema,
    ownerType: attachmentOwnerTypeSchema,
    ownerId: uuidSchema,
    stage: attachmentStageSchema.default('GENERAL'),
    taskId: uuidSchema.optional(),
    formFieldKey: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export type CompleteAttachmentInput = z.output<typeof completeAttachmentSchema>;

/** `GET /attachments?ownerType=&ownerId=` — prilozi jednog zapisa. */
export const attachmentListQuerySchema = paginationQuerySchema
  .extend({
    ownerType: attachmentOwnerTypeSchema,
    ownerId: uuidSchema,
  })
  .strict();
export type AttachmentListQuery = z.output<typeof attachmentListQuerySchema>;

export const attachmentListResponseSchema = z
  .object({
    items: z.array(attachmentSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type AttachmentListResponse = z.output<typeof attachmentListResponseSchema>;

/** `GET /attachments/:id/url` — potpisani URL (TTL `FILE_SIGNED_URL_TTL_SECONDS`). */
export const attachmentSignedUrlSchema = z
  .object({
    url: z.string().min(1),
    expiresAt: z.iso.datetime(),
    token: z.string().min(1),
  })
  .strict();
export type AttachmentSignedUrl = z.output<typeof attachmentSignedUrlSchema>;

/** Faza 4 — pregled servisnih evidencija. Iznosi su u feningama. */
export const serviceListQuerySchema = paginationQuerySchema
  .extend({
    vehicleId: uuidSchema.optional(),
    status: recordStatusSchema.optional(),
    serviceType: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type ServiceListQuery = z.output<typeof serviceListQuerySchema>;
export const serviceRecordSchema = z
  .object({
    id: uuidSchema,
    vehicleId: uuidSchema,
    serviceDate: z.iso.date(),
    serviceType: z.string(),
    workshopName: z.string().nullable(),
    description: z.string().nullable(),
    odometerKm: z.number().int().nullable(),
    totalCost: z.number().int(),
    currency: z.string(),
    nextServiceDueDate: z.iso.date().nullable(),
    nextServiceDueKm: z.number().int().nullable(),
    status: recordStatusSchema,
    formSchemaId: uuidSchema,
    formSchemaVersionId: uuidSchema,
    version: z.number().int(),
  })
  .strict();
export type ServiceRecord = z.output<typeof serviceRecordSchema>;
export const serviceListResponseSchema = z
  .object({
    items: z.array(serviceRecordSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .strict();
export type ServiceListResponse = z.output<typeof serviceListResponseSchema>;

/** Unos servisa: novac je cijeli broj feninga, km ne smije nazad. */
export const createServiceSchema = z
  .object({
    vehicleId: uuidSchema,
    serviceDate: z.iso.date(),
    serviceType: z.string().trim().min(1).max(120),
    workshopName: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    odometerKm: z.number().int().min(0).max(2147483647).optional(),
    totalCost: z.number().int().min(0).max(2147483647),
    nextServiceDueDate: z.iso.date().nullable().optional(),
    nextServiceDueKm: z.number().int().min(0).max(2147483647).nullable().optional(),
    formSchemaVersionId: uuidSchema.optional(),
    formData: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .refine((v) => !v.nextServiceDueDate || v.nextServiceDueDate >= v.serviceDate, {
    path: ['nextServiceDueDate'],
    message: 'Sljedeći servis ne može prethoditi ovom servisu.',
  })
  .refine(
    (v) => v.odometerKm === undefined || v.nextServiceDueKm == null || v.nextServiceDueKm >= v.odometerKm,
    { path: ['nextServiceDueKm'], message: 'Sljedeći servis ne može biti na manjoj kilometraži.' },
  );
export type CreateServiceInput = z.output<typeof createServiceSchema>;
