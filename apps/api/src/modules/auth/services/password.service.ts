/**
 * `PasswordService` — argon2id hashiranje i politika lozinki (docs/05 §7).
 *
 * Parametri su **zaključani u `@vfm/shared/constants.ts`** (ne u env-u) jer su dio
 * sigurnosne specifikacije: `argon2id`, 64 MiB memorije, 3 iteracije, 1 nit,
 * 32 B hash, 16 B salt. Svaki hash nosi svoje parametre (PHC string), pa
 * `needsRehash()` omogućava transparentno pooštravanje bez resetovanja lozinki.
 *
 * Politika lozinke: min 12 / max 128 znakova, ≥ 3 od 4 klase, bez dijelova e-maila,
 * imena ili korisničkog imena (≥ 3 znaka), bez registarskih oznaka i drugih
 * prepoznatljivih podstringova (`forbiddenSubstrings`), bez čestih lozinki i
 * trivijalnih sekvenci. Provjera je centralizovana u `@vfm/shared/schemas`
 * (`passwordPolicyIssues`) → identična pravila važe u API-ju, webu i mobilnoj
 * aplikaciji, a poruke su bosanske.
 *
 * ⚠️ 2FA se NE implementira (R-05).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { hash, parseOptions, verify } from '@node-rs/argon2';
import {
  ARGON2_HASH_LENGTH,
  ARGON2_MEMORY_COST_KIB,
  ARGON2_PARALLELISM,
  ARGON2_SALT_LENGTH,
  ARGON2_TIME_COST,
  GENERATED_PASSWORD_LENGTH,
} from '@vfm/shared';
import {
  passwordPolicyIssues,
  type PasswordPolicyContext,
  type PasswordPolicyIssue,
} from '@vfm/shared/schemas';
import { VfmErrors } from '../../../common/errors/vfm-error.js';

/** `Algorithm.Argon2id` — enum je ambient `const enum` pa ga ne smijemo importovati (isolatedModules). */
const ARGON2_ALGORITHM_ID = 2;
/** `Version.V0x13` (argon2 v19). */
const ARGON2_VERSION_13 = 1;

/** Tip opcija bez direktnog pozivanja ambient const enum-a. */
type Argon2Options = NonNullable<Parameters<typeof hash>[1]>;

/** Zaključani argon2id parametri (docs/05 §7). */
export const ARGON2_OPTIONS: Argon2Options = {
  algorithm: ARGON2_ALGORITHM_ID as Argon2Options['algorithm'],
  version: ARGON2_VERSION_13 as Argon2Options['version'],
  memoryCost: ARGON2_MEMORY_COST_KIB,
  timeCost: ARGON2_TIME_COST,
  parallelism: ARGON2_PARALLELISM,
  outputLen: ARGON2_HASH_LENGTH,
};

/**
 * Ugrađena lista čestih lozinki (skraćeni izbor najčešćih + bosanske varijante).
 *
 * ⚠️ ODSTUPANJE od docs/05 §7 (zabilježeno u izvještaju): dokument traži provjeru
 * protiv „top 100k čestih lozinki". Punu listu ne commitujemo u repo (veličina +
 * licence); umjesto toga servis prima **dodatnu blocklistu kroz konstruktor**, pa
 * se kompletan spisak može ubaciti iz datoteke/baze u deploy okruženju bez izmjene
 * koda. Lista se poredi case-insensitively (radi `passwordPolicyIssues`).
 */
export const COMMON_PASSWORD_BLOCKLIST: readonly string[] = [
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '12345678910',
  '123123',
  '123321',
  '112233',
  '111111',
  '000000',
  '121212',
  '666666',
  '654321',
  '7654321',
  '87654321',
  '987654321',
  '123qwe',
  '1q2w3e',
  '1q2w3e4r',
  '1q2w3e4r5t',
  '1qaz2wsx',
  '1qazxsw2',
  'qazwsx',
  'qwerty',
  'qwertyuiop',
  'qwerty123',
  'asdfgh',
  'asdfghjkl',
  'zxcvbn',
  'zxcvbnm',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'pass123',
  'pass1234',
  'admin',
  'admin123',
  'admin1234',
  'administrator',
  'root',
  'root123',
  'toor',
  'letmein',
  'welcome',
  'welcome1',
  'welcome123',
  'welcome2024',
  'welcome2025',
  'welcome2026',
  'iloveyou',
  'monkey',
  'dragon',
  'master',
  'superman',
  'batman',
  'trustno1',
  'sunshine',
  'princess',
  'football',
  'basketball',
  'baseball',
  'soccer',
  'hockey',
  'starwars',
  'pokemon',
  'minecraft',
  'google',
  'facebook',
  'amazon',
  'microsoft',
  'test',
  'test123',
  'test1234',
  'testtest',
  'guest',
  'guest123',
  'user',
  'user123',
  'demo',
  'demo123',
  'sample',
  'example',
  'changeme',
  'changeme123',
  'default',
  'default123',
  'temp',
  'temp123',
  'temporary',
  'abc123',
  'abcd1234',
  'abcdef',
  'abcdefg',
  'aaaaaaaa',
  'a123456',
  'a1234567',
  'a12345678',
  'a123456789',
  'aa123456',
  'asdf1234',
  'q1w2e3r4',
  'q1w2e3',
  'qwe123',
  'qweasd',
  'qweasdzxc',
  'zaq12wsx',
  'xsw21qaz',
  'sifra',
  'sifra123',
  'sifra1234',
  'lozinka',
  'lozinka123',
  'lozinka1234',
  'vozilopark',
  'voznipark',
  'voznipark123',
  'vfm',
  'vfm123',
  'vfm1234',
  'vfm2024',
  'vfm2025',
  'vfm2026',
  'sarajevo',
  'sarajevo123',
  'bosna',
  'bosna123',
  'bih',
  'bih123',
  'registracija',
  'registracija123',
  'gorivo',
  'gorivo123',
  'servis',
  'servis123',
  'kamion',
  'kamion123',
  'auto',
  'auto123',
  'automobil',
  'automobil123',
  'mobilna',
  'mobitel',
  'mobitel123',
  'telefon',
  'telefon123',
];

/**
 * DI token za dodatnu blocklistu čestih lozinki (opciono).
 *
 * Deploy može registrovati provider koji učitava puni spisak (npr. iz datoteke
 * montirane u kontejner) bez izmjene koda — vidi `AuthModule`.
 */
export const PASSWORD_BLOCKLIST = Symbol('VFM_PASSWORD_BLOCKLIST');

/** Karakter set za generisane lozinke (bez dvosmislenih znakova 0/O/1/l/I). */
const GENERATED_CHARSET = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*()-_=+[]{}?',
};

/**
 * Hashiranje i provjera lozinki.
 *
 * Konstruktor prima opcionu dodatnu blocklistu (npr. učitanu iz datoteke), pa se
 * puni spisak čestih lozinki može dodati bez izmjene koda.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private readonly blocklist: readonly string[];
  /** Hash koji se koristi za izjednačavanje vremena kod nepostojećih korisnika. */
  private timingHash: string | undefined;

  constructor(@Optional() @Inject(PASSWORD_BLOCKLIST) extraBlocklist?: readonly string[]) {
    // `passwordPolicyIssues` poredi lowercase oblike, pa se ulaz normalizuje ovdje
    // (deploy datoteka može sadržavati `FirmaSuperSecret` ili razmake).
    const extra = extraBlocklist ?? [];
    this.blocklist = [
      ...COMMON_PASSWORD_BLOCKLIST,
      ...extra.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0),
    ];
  }

  /** Zaključeni argon2id parametri (za dijagnostiku/testove). */
  get options(): Argon2Options {
    return ARGON2_OPTIONS;
  }

  /**
   * Generiše **privremenu** lozinku koja prolazi politiku (bootstrap, seed,
   * kreiranje korisnika bez unosa lozinke).
   *
   * Zašto ovdje, a ne u pozivaocima: politika i generator moraju dijeliti iste
   * konstante. 20 znakova iz 4 klase, pa provjera `validatePolicy` (bloklista,
   * sekvence, lični podaci) — ako kandidat padne, generiše se novi (max 25×).
   *
   * Vraćena lozinka se ispisuje korisniku **jednom** i nikad se ne logira.
   */
  generateTemporaryPassword(context?: PasswordPolicyContext): string {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const candidate = this.randomPasswordCandidate();
      if (this.validatePolicy(candidate, context).length === 0) return candidate;
    }

    this.logger.error('Generisana privremena lozinka nije prošla politiku nakon 25 pokušaja.');
    throw VfmErrors.internal();
  }

  /** 20 znakova, ciklično kroz 4 klase, pa Fisher–Yates uz `randomInt`. */
  private randomPasswordCandidate(): string {
    const classes = [
      'abcdefghijkmnopqrstuvwxyz',
      'ABCDEFGHJKLMNPQRSTUVWXYZ',
      '23456789',
      '!@#$%&*?-_+=',
    ] as const;

    const chars: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const alphabet = classes[index % classes.length] ?? classes[0];
      chars.push(alphabet.charAt(randomInt(alphabet.length)));
    }

    for (let index = chars.length - 1; index > 0; index -= 1) {
      const swap = randomInt(index + 1);
      const left = chars[index] ?? '';
      const right = chars[swap] ?? '';
      chars[index] = right;
      chars[swap] = left;
    }

    return chars.join('');
  }

  /**
   * Provjera politike (bez bacanja greške) — vraća listu problema za UI hintove.
   */
  validatePolicy(password: string, context?: PasswordPolicyContext): readonly PasswordPolicyIssue[] {
    return passwordPolicyIssues(password, {
      ...context,
      blocklist: [...this.blocklist, ...(context?.blocklist ?? [])],
    });
  }

  /**
   * Provjera politike koja baca `400 VALIDATION_ERROR` s `details[]` po problemu
   * (`code` = `issueCode` iz politike, npr. `PASSWORD_TOO_SHORT`).
   */
  assertPolicy(password: string, context?: PasswordPolicyContext): void {
    const issues = this.validatePolicy(password, context);
    if (issues.length === 0) return;
    throw VfmErrors.validationError(
      issues.map((issue) => ({
        path: ['password'],
        message: issue.message,
        code: issue.code,
      })),
    );
  }

  /**
   * Hashira lozinku argon2id-om uz zaključane parametre.
   *
   * @throws `400 VALIDATION_ERROR` ako lozinka ne zadovoljava politiku — hashiranje
   * slabe lozinke nikad ne smije proći (docs/05 §7).
   */
  async hash(password: string, context?: PasswordPolicyContext): Promise<string> {
    this.assertPolicy(password, context);
    return hash(password, ARGON2_OPTIONS);
  }

  /**
   * Hashira bez provjere politike — **samo** za migraciju postojećih hashova i za
   * privremene lozinke iz `bootstrap-super-admin.mjs`/seed-a (koje su već provjerene).
   */
  async hashUnchecked(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /**
   * Provjera lozinke uz pohranjeni hash.
   *
   * Vraća `false` (a ne grešku) za neispravan hash ili pogrešnu lozinku — razlog
   * se logira, a caller odgovara `401 INVALID_CREDENTIALS` s generičkom porukom.
   */
  async verify(storedHash: string, password: string): Promise<boolean> {
    if (!storedHash) return false;
    try {
      return await verify(storedHash, password);
    } catch (error) {
      this.logger.warn(`argon2 verify nije uspio: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Izjednačava vrijeme odgovora za nepostojećeg korisnika (sprječava nagađanje
   * korisničkih imena po trajanju odgovora — docs/05 §10).
   *
   * Poziva se u `login` grani kada e-mail nije pronađen; rezultat se odbacuje.
   */
  async equalizeTiming(password: string): Promise<void> {
    try {
      this.timingHash ??= await hashUncheckedWithFixedSalt();
      await verify(this.timingHash, password);
    } catch {
      // Namjerno: cilj je potrošiti vrijeme, ne rezultat.
    }
  }

  /**
   * Da li hash treba ponovo izračunati (parametri slabiji od trenutnih ili drugi
   * algoritam). Koristi se nakon uspješnog logina → transparentan rehash.
   */
  needsRehash(storedHash: string): boolean {
    if (!storedHash) return true;
    try {
      const parsed = parseOptions(storedHash);
      return (
        Number(parsed.algorithm) !== ARGON2_ALGORITHM_ID ||
        Number(parsed.version) !== ARGON2_VERSION_13 ||
        parsed.memoryCost < ARGON2_MEMORY_COST_KIB ||
        parsed.timeCost < ARGON2_TIME_COST ||
        parsed.parallelism < ARGON2_PARALLELISM ||
        parsed.outputLen < ARGON2_HASH_LENGTH
      );
    } catch (error) {
      this.logger.warn(
        `Nije moguće parsirati argon2 hash (rehash potreban): ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
  }

  /**
   * Generiše nasumičnu lozinku (kriptografski RNG) koja zadovoljava politiku:
   * garantovano po jedan znak iz svake klase, bez dvosmislenih znakova.
   *
   * Koristi se za reset lozinke, seed i `bootstrap-super-admin.mjs` — lozinka se
   * ispisuje **jednom** na stdout i mora se promijeniti pri prvom loginu.
   */
  randomPassword(length: number = GENERATED_PASSWORD_LENGTH): string {
    const size = Math.max(length, 16);
    const classes = [
      GENERATED_CHARSET.lower,
      GENERATED_CHARSET.upper,
      GENERATED_CHARSET.digit,
      GENERATED_CHARSET.symbol,
    ];
    const all = classes.join('');

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const chars: string[] = [];
      // Po jedan znak iz svake klase (garancija 4/4), zatim ostatak iz punog seta.
      for (const charset of classes) chars.push(pick(charset));
      while (chars.length < size) chars.push(pick(all));
      // Fisher–Yates da pozicije obaveznih znakova ne budu predvidive.
      for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        const atI = chars[i];
        const atJ = chars[j];
        if (atI === undefined || atJ === undefined) continue;
        chars[i] = atJ;
        chars[j] = atI;
      }
      const candidate = chars.join('');
      if (this.validatePolicy(candidate).length === 0) return candidate;
    }
    // Nedostižno u praksi (25 pokušaja × 20 znakova iz 4 klase) — fail closed.
    this.logger.error('Generisana lozinka nije prošla politiku nakon 25 pokušaja.');
    throw VfmErrors.internal();
  }

  /** Dužina soli u bajtovima (iz PHC stringa) — za testove/dijagnostiku. */
  get saltLength(): number {
    return ARGON2_SALT_LENGTH;
  }
}

/** Jedan nasumičan znak iz seta (kriptografski RNG, bez modulo bias-a). */
function pick(charset: string): string {
  return charset.charAt(randomInt(charset.length));
}

/**
 * Hash s fiksnim saltom za `equalizeTiming` — računa se jednom i samo troši CPU
 * vrijeme; nikad se ne koristi za autentifikaciju.
 */
async function hashUncheckedWithFixedSalt(): Promise<string> {
  return hash('vfm-timing-equalizer!1', ARGON2_OPTIONS);
}
