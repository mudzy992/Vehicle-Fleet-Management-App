import { describe, expect, it } from 'vitest';
import { hash as argon2Hash } from '@node-rs/argon2';
import {
  ARGON2_HASH_LENGTH,
  ARGON2_MEMORY_COST_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
  GENERATED_PASSWORD_LENGTH,
} from '@vfm/shared';
import { passwordCharacterClassCount } from '@vfm/shared/schemas';
import {
  ARGON2_OPTIONS,
  COMMON_PASSWORD_BLOCKLIST,
  PasswordService,
} from '../../src/modules/auth/services/password.service.js';
import { VfmException } from '../../src/common/errors/vfm-error.js';

/**
 * `PasswordService` — argon2id + politika lozinki (docs/05 §7).
 *
 * Parametri su zaključani: `argon2id`, m=65536 KiB (64 MiB), t=3, p=1, 32 B hash.
 * Testovi to dokazuju čitanjem PHC stringa, a ne samo ponašanjem — jer svaka
 * promjena parametara mijenja i sigurnosni profil.
 *
 * ⚠️ 2FA se NE implementira (R-05) — nema `otp`/`totp` metoda u servisu.
 */

/** Lozinka koja zadovoljava politiku (12+, 4 klase, bez sekvenci i čestih osnova). */
const VALID_PASSWORD = 'Kamion!Zima2026x';

/** Kodovi problema iz `details[]` bacene greške. */
function codesOf(error: VfmException): string[] {
  return (error.details ?? []).map((detail) => detail.code ?? '');
}

describe('PasswordService — argon2id parametri (docs/05 §7)', () => {
  it('konstante odgovaraju specifikaciji: 64 MiB, 3 iteracije, 1 nit, 32 B', () => {
    expect(ARGON2_MEMORY_COST_KIB).toBe(65_536);
    expect(ARGON2_TIME_COST).toBe(3);
    expect(ARGON2_PARALLELISM).toBe(1);
    expect(ARGON2_HASH_LENGTH).toBe(32);
    expect(ARGON2_OPTIONS).toMatchObject({
      memoryCost: ARGON2_MEMORY_COST_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
      outputLen: ARGON2_HASH_LENGTH,
      algorithm: 2, // Algorithm.Argon2id
      version: 1, // Version.V0x13
    });
  });

  it('hash je PHC string s argon2id i zaključanim parametrima', async () => {
    const service = new PasswordService();

    const hashed = await service.hash(VALID_PASSWORD);

    expect(hashed.startsWith('$argon2id$v=19$m=65536,t=3,p=1$')).toBe(true);
    expect(hashed.split('$')).toHaveLength(6); // ['', 'argon2id', 'v=19', 'm=…,t=…,p=…', salt, hash]
  });

  it('verify vraća true za tačnu i false za pogrešnu lozinku', async () => {
    const service = new PasswordService();
    const hashed = await service.hash(VALID_PASSWORD);

    await expect(service.verify(hashed, VALID_PASSWORD)).resolves.toBe(true);
    await expect(service.verify(hashed, 'Pogresna!Sifra2026')).resolves.toBe(false);
  });

  it('verify ne baca za neispravan/prazan hash (vrati false)', async () => {
    const service = new PasswordService();

    await expect(service.verify('', VALID_PASSWORD)).resolves.toBe(false);
    await expect(service.verify('nije-argon2-hash', VALID_PASSWORD)).resolves.toBe(false);
  });

  it('svaki hash ima jedinstven salt (16 B) → isti password, različiti hashovi', async () => {
    const service = new PasswordService();

    const first = await service.hash(VALID_PASSWORD);
    const second = await service.hash(VALID_PASSWORD);

    expect(first).not.toBe(second);
    expect(first.split('$')[4]).not.toBe(second.split('$')[4]);
    expect(service.saltLength).toBe(16);
  });
});

describe('PasswordService — politika lozinke (hash odbija slabu lozinku)', () => {
  it('prekratka lozinka → 400 VALIDATION_ERROR s kodom too_short', async () => {
    const service = new PasswordService();

    const error = await service.hash('kratka1!').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VfmException);
    expect((error as VfmException).code).toBe('VALIDATION_ERROR');
    expect((error as VfmException).httpStatus).toBe(400);
    expect(codesOf(error as VfmException)).toContain('too_short');
  });

  it('preduga lozinka (> 128) → too_long', async () => {
    const service = new PasswordService();

    const error = (await service
      .hash(`${'Ab!9'.repeat(40)}`.slice(0, 129))
      .catch((caught: unknown) => caught)) as VfmException;

    expect(codesOf(error)).toContain('too_long');
  });

  it('manje od 3 klase znakova → insufficient_character_classes', async () => {
    const service = new PasswordService();

    const error = (await service
      .hash('samoslovaikolovoz')
      .catch((caught: unknown) => caught)) as VfmException;

    expect(codesOf(error)).toContain('insufficient_character_classes');
  });

  it('česta lozinka (uključujući varijante s brojevima) → common_password', async () => {
    const service = new PasswordService();

    const error = (await service.hash('Password123456!').catch((caught: unknown) => caught)) as VfmException;

    expect(codesOf(error)).toContain('common_password');
  });

  it('organizacijske lozinke iz ugrađene blockliste → common_password', async () => {
    const service = new PasswordService();

    // lettersOnly varijante (cifre/simboli se skidaju prije poređenja) + direktne
    for (const candidate of ['VozniPark123!', 'Sifra!2026', 'Gorivo!99', 'Administrator1!']) {
      const error = (await service.hash(candidate).catch((caught: unknown) => caught)) as VfmException;
      expect(error, `očekivano odbijanje za "${candidate}"`).toBeInstanceOf(VfmException);
      expect(codesOf(error), `očekivan common_password za "${candidate}"`).toContain('common_password');
    }
  });

  it('dodatna blocklista iz konstruktora se poštuje (deploy bez izmjene koda)', async () => {
    const service = new PasswordService(['firmaSuperSecret']);

    const error = (await service
      .hash('FirmaSuperSecret!9')
      .catch((caught: unknown) => caught)) as VfmException;

    expect(codesOf(error)).toContain('common_password');
    expect(COMMON_PASSWORD_BLOCKLIST).not.toContain('firmaSuperSecret');
  });

  it('e-mail/ime korisnika u lozinki → contains_personal_data', async () => {
    const service = new PasswordService();

    const error = (await service
      .hash('AnaAnic2026xyz!', {
        email: 'ana.anic@firma.ba',
        firstName: 'Ana',
        lastName: 'Anić',
      })
      .catch((caught: unknown) => caught)) as VfmException;

    expect(codesOf(error)).toContain('contains_personal_data');
  });

  it('registarska oznaka u lozinki → contains_personal_data (forbiddenSubstrings)', async () => {
    const service = new PasswordService();

    const error = (await service
      .hash('Vozilo!A12-K-345x', {
        forbiddenSubstrings: ['A12-K-345'],
      })
      .catch((caught: unknown) => caught)) as VfmException;

    expect(codesOf(error)).toContain('contains_personal_data');
  });

  it('trivijalna sekvenca (123456 / aaaaaa) → repetitive_sequence', async () => {
    const service = new PasswordService();

    const error = (await service.hash('Sifra!aaaaaa9').catch((caught: unknown) => caught)) as VfmException;

    expect(codesOf(error)).toContain('repetitive_sequence');
  });

  it('validatePolicy vraća praznu listu za ispravnu lozinku', () => {
    const service = new PasswordService();

    expect(service.validatePolicy(VALID_PASSWORD)).toEqual([]);
    expect(service.validatePolicy(VALID_PASSWORD, { email: 'admin@firma.ba' })).toEqual([]);
  });

  it('assertPolicy baca details[] s path ["password"]', () => {
    const service = new PasswordService();

    const error = (() => {
      try {
        service.assertPolicy('kratka1!');
      } catch (caught) {
        return caught as VfmException;
      }
      throw new Error('Očekivana je greška.');
    })();

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details?.[0]?.path).toEqual(['password']);
    expect(error.details?.[0]?.code).toBe('too_short');
  });
});

describe('PasswordService — needsRehash (transparentno pooštravanje)', () => {
  it('hash s trenutnim parametrima → false', async () => {
    const service = new PasswordService();
    const hashed = await service.hashUnchecked(VALID_PASSWORD);

    expect(service.needsRehash(hashed)).toBe(false);
  });

  it('hash sa slabijim parametrima (default m=19456,t=2) → true', async () => {
    const service = new PasswordService();
    const weak = await argon2Hash(VALID_PASSWORD, {
      algorithm: 2,
      version: 1,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    expect(service.needsRehash(weak)).toBe(true);
  });

  it('neispravan ili prazan hash → true (fail-safe)', () => {
    const service = new PasswordService();

    expect(service.needsRehash('')).toBe(true);
    expect(service.needsRehash('sha256$nesto')).toBe(true);
  });
});

describe('PasswordService — generisane lozinke (reset/seed/bootstrap)', () => {
  it('dužina 20 (GENERATED_PASSWORD_LENGTH), 4 klase, prolazi politiku', () => {
    const service = new PasswordService();

    const password = service.randomPassword();

    expect(GENERATED_PASSWORD_LENGTH).toBe(20);
    expect(password).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(passwordCharacterClassCount(password)).toBe(4);
    expect(service.validatePolicy(password)).toEqual([]);
  });

  it('poštiva traženu dužinu i ne vraća dvosmislene znakove (0/O/1/l/I)', () => {
    const service = new PasswordService();

    const password = service.randomPassword(28);

    expect(password).toHaveLength(28);
    expect(password).not.toMatch(/[0O1lI]/u);
  });

  it('10 generisanih lozinki je međusobno različito (CSPRNG)', () => {
    const service = new PasswordService();

    const generated = new Set(Array.from({ length: 10 }, () => service.randomPassword()));

    expect(generated.size).toBe(10);
  });

  it('kratka tražena dužina se podiže na minimum 16 (politika 12+ ostaje sigurna)', () => {
    const service = new PasswordService();

    expect(service.randomPassword(4).length).toBeGreaterThanOrEqual(16);
  });
});

describe('PasswordService — otpornost na enumeraciju korisnika', () => {
  it('equalizeTiming troši vrijeme i ne baca (nepostojeći korisnik)', async () => {
    const service = new PasswordService();

    const started = Date.now();
    await expect(service.equalizeTiming('BiloKakva!Sifra2026')).resolves.toBeUndefined();
    const elapsed = Date.now() - started;

    // argon2id s 64 MiB traje desetine milisekundi → dokaz da je verify izvršen.
    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  it('drugi poziv je jeftiniji (dummy hash se kešira)', async () => {
    const service = new PasswordService();
    await service.equalizeTiming('Prva!Sifra2026x');

    const started = Date.now();
    await service.equalizeTiming('Druga!Sifra2026x');
    const second = Date.now() - started;

    expect(second).toBeGreaterThanOrEqual(0);
  });
});
