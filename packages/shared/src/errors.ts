/**
 * VFM — katalog kodova grešaka i zajednički API omotač (envelope).
 *
 * Autoritativni spisak: `docs/07-API_SPECIFIKACIJA.md` §1.5.
 * Klijent (web/mobilni) **switch-uje po `code`**, nikad po HTTP statusu ili
 * tekstu poruke — poruke su lokalizovane (`bs`) i mogu se mijenjati.
 */

/** Kategorija greške po sloju sistema. */
export type ErrorCategory = 'AUTH' | 'VALIDATION' | 'DOMAIN' | 'SECURITY' | 'INFRA' | 'RATE_LIMIT';

export interface ErrorCodeMeta {
  readonly code: string;
  readonly httpStatus: number;
  readonly category: ErrorCategory;
  /** Da li se greška audituje kao sigurnosni događaj. */
  readonly securityRelevant: boolean;
  /** Preporučena korisnička poruka na bosanskom. */
  readonly messageBs: string;
  /** Da li klijent treba ponoviti zahtjev (npr. nakon osvježavanja tokena). */
  readonly retryable: boolean;
}

/**
 * Katalog kodova grešaka.
 *
 * Ključeve koristiti kao `ERROR_CODES.TASK_ALREADY_CLAIMED.code` (type-safe),
 * a `isErrorCode()` za runtime provjeru ulaznih stringova.
 */
export const ERROR_CODES = {
  // --- Pristup i klijent (N-05) ---
  MOBILE_ACCESS_FORBIDDEN: {
    code: 'MOBILE_ACCESS_FORBIDDEN',
    httpStatus: 403,
    category: 'SECURITY',
    securityRelevant: true,
    messageBs: 'Super administrator ne može koristiti mobilnu aplikaciju. Prijavite se kroz web portal.',
    retryable: false,
  },
  MOBILE_SCOPE_NOT_ALLOWED: {
    code: 'MOBILE_SCOPE_NOT_ALLOWED',
    httpStatus: 403,
    category: 'SECURITY',
    securityRelevant: true,
    messageBs: 'Ova operacija nije dostupna u mobilnoj aplikaciji.',
    retryable: false,
  },

  // --- RBAC (P-01…P-03) ---
  PERMISSION_DENIED: {
    code: 'PERMISSION_DENIED',
    httpStatus: 403,
    category: 'AUTH',
    securityRelevant: true,
    messageBs: 'Nemate dozvolu za ovu operaciju.',
    retryable: false,
  },
  SCOPE_DENIED: {
    code: 'SCOPE_DENIED',
    httpStatus: 403,
    category: 'AUTH',
    securityRelevant: true,
    messageBs: 'Nemate pristup traženom opsegu podataka.',
    retryable: false,
  },
  LAST_SUPER_ADMIN_PROTECTED: {
    code: 'LAST_SUPER_ADMIN_PROTECTED',
    httpStatus: 409,
    category: 'DOMAIN',
    securityRelevant: true,
    messageBs: 'Sistem mora imati barem jednog aktivnog super administratora.',
    retryable: false,
  },

  // --- Sesije i tokeni ---
  PERMISSIONS_STALE: {
    code: 'PERMISSIONS_STALE',
    httpStatus: 401,
    category: 'AUTH',
    securityRelevant: false,
    messageBs: 'Vaša prava su promijenjena. Prijavite se ponovo.',
    retryable: true,
  },
  TOKEN_REVOKED: {
    code: 'TOKEN_REVOKED',
    httpStatus: 401,
    category: 'AUTH',
    securityRelevant: true,
    messageBs: 'Sesija je istekla ili je poništena. Prijavite se ponovo.',
    retryable: true,
  },
  TOKEN_EXPIRED: {
    code: 'TOKEN_EXPIRED',
    httpStatus: 401,
    category: 'AUTH',
    securityRelevant: false,
    messageBs: 'Sesija je istekla. Prijavite se ponovo.',
    retryable: true,
  },
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    httpStatus: 401,
    category: 'AUTH',
    securityRelevant: true,
    messageBs: 'Pogrešan e-mail ili lozinka.',
    retryable: false,
  },
  ACCOUNT_LOCKED: {
    code: 'ACCOUNT_LOCKED',
    httpStatus: 423,
    category: 'SECURITY',
    securityRelevant: true,
    messageBs: 'Nalog je privremeno zaključan zbog više neuspješnih prijava.',
    retryable: false,
  },
  ACCOUNT_INACTIVE: {
    code: 'ACCOUNT_INACTIVE',
    httpStatus: 403,
    category: 'AUTH',
    securityRelevant: true,
    messageBs: 'Nalog nije aktivan. Kontaktirajte administratora.',
    retryable: false,
  },
  REFRESH_TOKEN_REUSE_DETECTED: {
    code: 'REFRESH_TOKEN_REUSE_DETECTED',
    httpStatus: 401,
    category: 'SECURITY',
    securityRelevant: true,
    messageBs: 'Otkrivena je ponovna upotreba istog tokena za obnovu. Sve sesije su poništene.',
    retryable: false,
  },

  // --- Zadaci (P-04…P-08) ---
  TASK_ALREADY_CLAIMED: {
    code: 'TASK_ALREADY_CLAIMED',
    httpStatus: 409,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Zadatak je već preuzeo drugi korisnik.',
    retryable: false,
  },
  NOT_ASSIGNEE: {
    code: 'NOT_ASSIGNEE',
    httpStatus: 403,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Samo dodijeljeni izvršilac može mijenjati ovaj zadatak.',
    retryable: false,
  },
  INVALID_TASK_TRANSITION: {
    code: 'INVALID_TASK_TRANSITION',
    httpStatus: 422,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Tražena promjena stanja zadatka nije dozvoljena.',
    retryable: false,
  },

  // --- Optimističko zaključavanje i periodi ---
  VERSION_CONFLICT: {
    code: 'VERSION_CONFLICT',
    httpStatus: 409,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Zapis je u međuvremenu izmijenjen. Osvježite podatke i pokušajte ponovo.',
    retryable: true,
  },
  PERIOD_OVERLAP: {
    code: 'PERIOD_OVERLAP',
    httpStatus: 409,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Vremenski period se preklapa s postojećim zapisom.',
    retryable: false,
  },
  TIRE_ALREADY_MOUNTED: {
    code: 'TIRE_ALREADY_MOUNTED',
    httpStatus: 409,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Guma je već montirana na vozilo.',
    retryable: false,
  },
  ODOMETER_REGRESSION: {
    code: 'ODOMETER_REGRESSION',
    httpStatus: 422,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Kilometraža ne može biti manja od posljednje zabilježene.',
    retryable: false,
  },

  // --- Form engine (P-09…P-12) ---
  FORM_VALIDATION_FAILED: {
    code: 'FORM_VALIDATION_FAILED',
    httpStatus: 422,
    category: 'VALIDATION',
    securityRelevant: false,
    messageBs: 'Podaci u formi nisu ispravni.',
    retryable: false,
  },
  RESERVED_FIELD_KEY: {
    code: 'RESERVED_FIELD_KEY',
    httpStatus: 422,
    category: 'VALIDATION',
    securityRelevant: false,
    messageBs: 'Naziv polja je rezervisan i ne može se koristiti.',
    retryable: false,
  },
  FORM_VERSION_NOT_PUBLISHED: {
    code: 'FORM_VERSION_NOT_PUBLISHED',
    httpStatus: 409,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Verzija forme nije objavljena.',
    retryable: false,
  },
  FORM_VERSION_IMMUTABLE: {
    code: 'FORM_VERSION_IMMUTABLE',
    httpStatus: 409,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Objavljena verzija forme se ne može mijenjati. Kreirajte novu verziju.',
    retryable: false,
  },
  NORMALIZATION_MISMATCH: {
    code: 'NORMALIZATION_MISMATCH',
    httpStatus: 422,
    category: 'VALIDATION',
    securityRelevant: false,
    messageBs: 'Normalizovana vrijednost se ne slaže s podacima u formi.',
    retryable: false,
  },
  UNKNOWN_FIELD: {
    code: 'UNKNOWN_FIELD',
    httpStatus: 422,
    category: 'VALIDATION',
    securityRelevant: false,
    messageBs: 'Forma sadrži nepoznato polje.',
    retryable: false,
  },
  FIELD_NOT_VISIBLE: {
    code: 'FIELD_NOT_VISIBLE',
    httpStatus: 422,
    category: 'VALIDATION',
    securityRelevant: false,
    messageBs: 'Polje nije vidljivo za trenutni unos.',
    retryable: false,
  },

  // --- Idempotencija i rate limit ---
  IDEMPOTENCY_KEY_REUSED: {
    code: 'IDEMPOTENCY_KEY_REUSED',
    httpStatus: 422,
    category: 'VALIDATION',
    securityRelevant: false,
    messageBs: 'Idempotency ključ je već iskorišten s drugim podacima.',
    retryable: false,
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    httpStatus: 429,
    category: 'RATE_LIMIT',
    securityRelevant: true,
    messageBs: 'Previše zahtjeva u kratkom vremenu. Pokušajte ponovo za koji trenutak.',
    retryable: true,
  },

  // --- Infrastruktura ---
  DEPENDENCY_UNAVAILABLE: {
    code: 'DEPENDENCY_UNAVAILABLE',
    httpStatus: 503,
    category: 'INFRA',
    securityRelevant: false,
    messageBs: 'Servis je privremeno nedostupan. Pokušajte ponovo.',
    retryable: true,
  },

  // --- Generičke ---
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    httpStatus: 400,
    category: 'VALIDATION',
    securityRelevant: false,
    messageBs: 'Zahtjev nije ispravan.',
    retryable: false,
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    httpStatus: 404,
    category: 'DOMAIN',
    securityRelevant: false,
    messageBs: 'Traženi resurs nije pronađen.',
    retryable: false,
  },
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    httpStatus: 500,
    category: 'INFRA',
    securityRelevant: false,
    messageBs: 'Došlo je do interne greške.',
    retryable: true,
  },
} as const satisfies Record<string, ErrorCodeMeta>;

/** Tip: kod greške (string literal unija). */
export type ErrorCode = keyof typeof ERROR_CODES;

/** Svi kodovi kao lista (za testove/dokumente). */
export const ALL_ERROR_CODES: readonly ErrorCode[] = Object.keys(ERROR_CODES) as ErrorCode[];

/** Runtime provjera da li je string poznati kod greške. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/** Meta podaci za kod greške. */
export function getErrorMeta(code: ErrorCode): ErrorCodeMeta {
  return ERROR_CODES[code];
}

/** HTTP status za kod greške. */
export function getErrorHttpStatus(code: ErrorCode): number {
  return ERROR_CODES[code].httpStatus;
}

// -----------------------------------------------------------------------------
//  API envelope (docs/07 §1.2)
// -----------------------------------------------------------------------------

/** Uspješan odgovor: `{ data, meta? }`. */
export interface ApiSuccess<T> {
  readonly data: T;
  readonly meta?: ApiMeta;
}

/** Greška: `{ error: { code, message, details?, requestId? } }`. */
export interface ApiErrorBody {
  readonly code: ErrorCode | string;
  readonly message: string;
  readonly details?: readonly ApiErrorDetail[];
  readonly requestId?: string;
  /** Za `VERSION_CONFLICT`: verzija zapisa u bazi (klijent osvježava). */
  readonly currentVersion?: number;
  /** Za `RATE_LIMITED`: sekunde do ponovnog pokušaja. */
  readonly retryAfterSeconds?: number;
}

/** Pojedinačna greška validacije (Zod → `details`). */
export interface ApiErrorDetail {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly code?: string;
}

export interface ApiMeta {
  readonly requestId?: string;
  readonly timestamp?: string;
  readonly page?: PaginationMeta;
  readonly permissionsVersion?: number;
  readonly tokenVersion?: number;
}

export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasMore: boolean;
}

export interface ApiFailure {
  readonly error: ApiErrorBody;
  readonly meta?: Pick<ApiMeta, 'requestId' | 'timestamp'>;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Da li je odgovor greška (type guard za klijente). */
export function isApiFailure<T>(response: ApiEnvelope<T>): response is ApiFailure {
  return typeof response === 'object' && response !== null && 'error' in response;
}

/** Da li je odgovor uspjeh (type guard za klijente). */
export function isApiSuccess<T>(response: ApiEnvelope<T>): response is ApiSuccess<T> {
  return typeof response === 'object' && response !== null && 'data' in response;
}

/** Izračunava pagination meta podatke. */
export function buildPaginationMeta(
  page: number,
  pageSize: number,
  totalItems: number,
): PaginationMeta {
  const safePageSize = pageSize > 0 ? pageSize : 1;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  return {
    page,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    hasMore: page < totalPages,
  };
}
