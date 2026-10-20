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
import { CLIENT_TYPES, PERMISSION_SCOPES, USER_STATUSES } from './enums.js';
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
export const permissionCodeSchema = z
  .string()
  .trim()
  .refine(isKnownPermission, { message: 'Permisija nije u katalogu (packages/shared → PERMISSION_CATALOG).' });

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
