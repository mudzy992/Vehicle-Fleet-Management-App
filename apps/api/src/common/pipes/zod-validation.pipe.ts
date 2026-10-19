/**
 * `ZodValidationPipe` — validacija ulaza Zod šemama iz `@vfm/shared/schemas`.
 *
 * Zašto ne `class-validator` (docs/07 §7: „Zod DTO iz `@vfm/shared`, nema inline
 * šema"): jedna šema = jedan izvor istine za API, web i mobilnu aplikaciju, pa
 * nema drifta između klijentske i serverske validacije.
 *
 * Ponašanje:
 * - ispravan ulaz → vraća **parsiran** objekt (defaulti, `.toLowerCase()` na e-mail,
 *   coerced brojevi u query-ju),
 * - nepoznato polje (DTO šeme su `.strict()`) → `422 UNKNOWN_FIELD` (T-11 mass
 *   assignment: nikad se tiho ne ignoriše),
 * - ostale greške → `400 VALIDATION_ERROR` s `details[]` po polju
 *   (`{ path, message, code }` — docs/07 §1.5).
 *
 * Upotreba:
 * ```ts
 * @Post('login')
 * login(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput) { … }
 * ```
 */
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodError, ZodType } from 'zod';
import type { ApiErrorDetail } from '@vfm/shared';
import { VfmErrors } from '../errors/vfm-error.js';
import type { VfmException } from '../errors/vfm-error.js';

/** Zod issue code za nepoznata polja (`.strict()` šeme). */
const UNRECOGNIZED_KEYS = 'unrecognized_keys';

/**
 * Zod greške → `details[]` iz API envelope-a.
 *
 * Poruke dolaze iz šema (bosanski), a `code` je Zod issue code — klijent ga može
 * koristiti za specifične hintove (npr. `issueCode` iz politike lozinke ide u
 * `params`, pa ga ovdje izvlačimo kao `code` kad postoji).
 */
export function zodIssuesToDetails(error: ZodError): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];

  for (const issue of error.issues) {
    const path = issue.path.map((part) => String(part));

    // Nepoznato polje: jedan issue nosi listu ključeva → po jedan `details[]` unos
    // po ključu, da klijent tačno vidi koja polja nisu dio DTO-a (T-11).
    if (issue.code === UNRECOGNIZED_KEYS) {
      const keys = ((issue as { keys?: unknown }).keys ?? []) as readonly unknown[];
      if (keys.length > 0) {
        for (const key of keys) {
          details.push({ path: [...path, String(key)], message: issue.message, code: issue.code });
        }
        continue;
      }
    }

    // `params` postoji na custom issue-ovima (npr. politika lozinke) ali nije dio
    // javnog Zod tipa → čitamo ga defanzivno.
    const params = ((issue as { params?: unknown }).params ?? {}) as Record<string, unknown>;
    const issueCode = typeof params.issueCode === 'string' ? params.issueCode : undefined;

    details.push({
      path,
      message: issue.message,
      ...(issueCode ? { code: issueCode } : { code: issue.code }),
    });
  }

  return details;
}

/** Da li greška sadrži nepoznato polje (→ `UNKNOWN_FIELD`, 422). */
export function hasUnknownFieldIssue(error: ZodError): boolean {
  return error.issues.some((issue) => issue.code === UNRECOGNIZED_KEYS);
}

/**
 * Pipe za Zod validaciju. Generički tip `T` je **izlaz** šeme (nakon defaulta i
 * transformacija), pa controller dobija tačan tip (`z.output<…>`).
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  /**
   * @param schema Zod šema iz `@vfm/shared/schemas` (nema inline šema u API-ju).
   * @param label Naziv izvora za jasniju poruku u logu (`body`, `query`, `params`).
   */
  constructor(
    private readonly schema: ZodType<T>,
    private readonly label?: string,
  ) {}

  transform(value: unknown, _metadata?: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details = zodIssuesToDetails(result.error);
    throw hasUnknownFieldIssue(result.error)
      ? VfmErrors.unknownField(details)
      : VfmErrors.validationError(details);
  }

  /**
   * Varijanta koja ne baca grešku — za servise koji validiraju podatke iz baze
   * ili iz outbox-a i žele nastaviti s radom (graceful degradation).
   */
  tryParse(value: unknown): { ok: true; data: T } | { ok: false; error: VfmException } {
    const result = this.schema.safeParse(value);
    if (result.success) return { ok: true, data: result.data };
    const details = zodIssuesToDetails(result.error);
    return {
      ok: false,
      error: hasUnknownFieldIssue(result.error)
        ? VfmErrors.unknownField(details)
        : VfmErrors.validationError(details),
    };
  }

  /** Naziv izvora (za log/dijagnostiku). */
  get source(): string | undefined {
    return this.label;
  }
}
