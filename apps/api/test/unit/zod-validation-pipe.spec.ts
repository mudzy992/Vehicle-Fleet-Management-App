import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ZodValidationPipe,
  hasUnknownFieldIssue,
  zodIssuesToDetails,
} from '../../src/common/pipes/zod-validation.pipe.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';
import {
  CHANGE_PASSWORD_MIN_DIFFERENCE_MESSAGE,
  changePasswordSchema,
  loginSchema,
  paginationQuerySchema,
  type ChangePasswordInput,
  type LoginInput,
  type PaginationQuery,
} from '@vfm/shared/schemas';

/**
 * `ZodValidationPipe` — jedina validacija ulaza u API-ju (docs/07 §7: „Zod DTO iz
 * `@vfm/shared`, nema inline šema", bez `class-validator`).
 *
 * Ključna svojstva koja se ovdje dokazuju:
 * - ispravan ulaz → parsiran objekt s defaultima i transformacijama,
 * - nepoznato polje → `422 UNKNOWN_FIELD` (T-11 mass assignment),
 * - ostalo → `400 VALIDATION_ERROR` s `details[]` po polju.
 */

/** Baca li pipe grešku i vraća je kao `VfmException` (za čitljive asertacije). */
function capture<T>(pipe: ZodValidationPipe<T>, value: unknown): VfmException {
  try {
    pipe.transform(value);
  } catch (error) {
    expect(error).toBeInstanceOf(VfmException);
    return error as VfmException;
  }
  throw new Error('Očekivana je VfmException, ali validacija je prošla.');
}

describe('ZodValidationPipe — ispravan ulaz', () => {
  it('login: vraća parsiran DTO, e-mail lowercase, clientType default WEB', () => {
    const pipe = new ZodValidationPipe<LoginInput>(loginSchema);

    const result = pipe.transform({ email: 'Admin@Firma.BA', password: 'Sifra!123456' });

    expect(result).toEqual({ email: 'admin@firma.ba', password: 'Sifra!123456', clientType: 'WEB' });
  });

  it('login: deviceInfo (mobilna) prolazi kroz .strict() objekt', () => {
    const pipe = new ZodValidationPipe<LoginInput>(loginSchema);

    const result = pipe.transform({
      email: 'vozac@firma.ba',
      password: 'Sifra!123456',
      clientType: 'MOBILE_ANDROID',
      deviceInfo: { model: 'Samsung A55', osVersion: '15', appVersion: '1.0.0' },
    });

    expect(result.clientType).toBe('MOBILE_ANDROID');
    expect(result.deviceInfo?.model).toBe('Samsung A55');
  });

  it('query: stringovi se coerce-uju u brojeve + defaulti (page/pageSize/sortOrder)', () => {
    const pipe = new ZodValidationPipe<PaginationQuery>(paginationQuerySchema);

    const result = pipe.transform({ page: '3', pageSize: '50', q: 'kamion' });

    expect(result).toMatchObject({ page: 3, pageSize: 50, sortOrder: 'asc', q: 'kamion' });
  });

  it('query: празan objekt dobija sve defaulte (page 1, pageSize 25)', () => {
    const pipe = new ZodValidationPipe<PaginationQuery>(paginationQuerySchema);

    expect(pipe.transform({})).toMatchObject({ page: 1, pageSize: 25, sortOrder: 'asc' });
  });
});

describe('ZodValidationPipe — VALIDATION_ERROR (400)', () => {
  it('neispravan e-mail → 400 s details[] po polju', () => {
    const error = capture(new ZodValidationPipe<LoginInput>(loginSchema), {
      email: 'nije-email',
      password: 'Sifra!123456',
    });

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.httpStatus).toBe(400);
    expect(error.details?.[0]?.path).toEqual(['email']);
  });

  it('nedostajuće obavezno polje → details[] uključuje path i message na bosanskom', () => {
    const error = capture(new ZodValidationPipe<LoginInput>(loginSchema), {
      email: 'admin@firma.ba',
    });

    const passwordIssue = error.details?.find((detail) => detail.path.join('.') === 'password');
    expect(passwordIssue).toBeDefined();
    expect(typeof passwordIssue?.message).toBe('string');
    expect(passwordIssue?.message.length).toBeGreaterThan(3);
  });

  it('neispravan clientType (nije u enumu) → 400', () => {
    const error = capture(new ZodValidationPipe<LoginInput>(loginSchema), {
      email: 'admin@firma.ba',
      password: 'Sifra!123456',
      clientType: 'DESKTOP',
    });

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.[0]?.path).toEqual(['clientType']);
  });

  it('change-password: ista nova i trenutna lozinka → details path ["newPassword"]', () => {
    const error = capture(
      new ZodValidationPipe<ChangePasswordInput>(changePasswordSchema),
      // Namjerno lozinka koja prolazi politiku → jedina greška je `.refine()`
      // (identična nova i trenutna), pa je asertacija deterministička.
      { currentPassword: 'Sifra!Vfm2026', newPassword: 'Sifra!Vfm2026' },
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.some((detail) => detail.message === CHANGE_PASSWORD_MIN_DIFFERENCE_MESSAGE)).toBe(
      true,
    );
    expect(error.details?.some((detail) => detail.path.join('.') === 'newPassword')).toBe(true);
  });

  it('slaba nova lozinka → code iz politike lozinke (params.issueCode), ne generički Zod code', () => {
    const error = capture(new ZodValidationPipe<ChangePasswordInput>(changePasswordSchema), {
      currentPassword: 'Sifra!Vfm2026',
      newPassword: 'Password123456!',
    });

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.map((detail) => detail.code)).toContain('common_password');
  });

  it('predugačak password → 400 (max 128 znakova)', () => {
    const error = capture(new ZodValidationPipe<LoginInput>(loginSchema), {
      email: 'admin@firma.ba',
      password: 'a'.repeat(129),
    });

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.[0]?.path).toEqual(['password']);
  });
});

describe('ZodValidationPipe — UNKNOWN_FIELD (422, T-11 mass assignment)', () => {
  it('višak polja u loginu → 422 UNKNOWN_FIELD s imenom polja u path-u', () => {
    const error = capture(new ZodValidationPipe<LoginInput>(loginSchema), {
      email: 'admin@firma.ba',
      password: 'Sifra!123456',
      role: 'SUPER_ADMIN',
    });

    expect(error.code).toBe('UNKNOWN_FIELD');
    expect(error.httpStatus).toBe(422);
    expect(error.details?.[0]?.path).toEqual(['role']);
  });

  it('pokušaj eskalacije prava (`isAdmin`, `permissions`) nikad ne prolazi tiho', () => {
    const error = capture(new ZodValidationPipe<LoginInput>(loginSchema), {
      email: 'admin@firma.ba',
      password: 'Sifra!123456',
      isAdmin: true,
      permissions: ['user:create'],
    });

    expect(error.code).toBe('UNKNOWN_FIELD');
    const paths = error.details?.map((detail) => detail.path.join('.')) ?? [];
    expect(paths).toContain('isAdmin');
    expect(paths).toContain('permissions');
  });

  it('višak polja u ugniježđenom objektu (deviceInfo) → path s prefiksom', () => {
    const error = capture(new ZodValidationPipe<LoginInput>(loginSchema), {
      email: 'admin@firma.ba',
      password: 'Sifra!123456',
      deviceInfo: { model: 'Pixel 9', pushToken: 'cudni-token' },
    });

    expect(error.code).toBe('UNKNOWN_FIELD');
    expect(error.details?.[0]?.path).toEqual(['deviceInfo', 'pushToken']);
  });
});

describe('zodIssuesToDetails / hasUnknownFieldIssue', () => {
  it('mapira Zod grešku u details[] (path, message, code)', () => {
    const result = loginSchema.safeParse({ email: 'x', password: '' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const details = zodIssuesToDetails(result.error);

    expect(details.length).toBeGreaterThan(0);
    for (const detail of details) {
      expect(Array.isArray(detail.path)).toBe(true);
      expect(typeof detail.message).toBe('string');
      expect(typeof detail.code).toBe('string');
    }
    expect(hasUnknownFieldIssue(result.error)).toBe(false);
  });

  it('prepoznaje unrecognized_keys i vraća po jedan unos za svaki ključ', () => {
    const result = loginSchema.safeParse({
      email: 'admin@firma.ba',
      password: 'Sifra!123456',
      a: 1,
      b: 2,
    });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(hasUnknownFieldIssue(result.error)).toBe(true);
    expect(zodIssuesToDetails(result.error).map((detail) => detail.path.join('.'))).toEqual(['a', 'b']);
  });

  it('radi i s inline Zod šemom (npr. interna validacija payloada iz outbox-a)', () => {
    const schema = z.object({ id: z.uuid() }).strict();
    const result = schema.safeParse({ id: 'nije-uuid', extra: true });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(hasUnknownFieldIssue(result.error)).toBe(true);
    const details = zodIssuesToDetails(result.error);
    expect(details.map((detail) => detail.path.join('.'))).toContain('id');
    expect(details.map((detail) => detail.path.join('.'))).toContain('extra');
  });
});

describe('ZodValidationPipe — tryParse (bez bacanja)', () => {
  it('ispravan ulaz → { ok: true, data }', () => {
    const pipe = new ZodValidationPipe<LoginInput>(loginSchema, 'body');

    const result = pipe.tryParse({ email: 'admin@firma.ba', password: 'Sifra!123456' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe('admin@firma.ba');
    expect(pipe.source).toBe('body');
  });

  it('neispravan ulaz → { ok: false, error } bez izuzetka', () => {
    const pipe = new ZodValidationPipe<LoginInput>(loginSchema);

    const result = pipe.tryParse({ email: 'admin@firma.ba' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(VfmException);
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('tryParse s viškom polja → UNKNOWN_FIELD', () => {
    const pipe = new ZodValidationPipe<LoginInput>(loginSchema);

    const result = pipe.tryParse({ email: 'admin@firma.ba', password: 'Sifra!123456', role: 'ADMIN' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_FIELD');
  });
});
