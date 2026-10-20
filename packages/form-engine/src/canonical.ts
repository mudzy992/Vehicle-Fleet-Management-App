/**
 * Kanonski JSON + `contentHash` (docs/04-FORM_ENGINE.md §8/10, §11).
 *
 * Objavljena verzija upisuje SHA-256 nad **kanonskim** JSON-om definicije:
 * ključevi objekata sortirani, bez razmaka, bez `undefined` vrijednosti. Time
 * je hash stabilan bez obzira na redoslijed polja u editoru, a bilo kakva
 * naknadna izmjena `definition` se detektuje (immutabilnost).
 *
 * Mobilni/web klijent kešira definiciju po `contentHash` (`ETag`), jer je
 * objavljena verzija nepromjenjiva.
 */
import { createHash } from 'node:crypto';

/** Greška koja znači da vrijednost nije JSON-kanonizabilna. */
export class CanonicalizationError extends Error {
  constructor(
    message: string,
    readonly path: string = '$',
  ) {
    // Putanja ide i u poruku: greška se logira i vraća kroz API bez dodatnog
    // konteksta, pa bi bez nje bilo nemoguće naći problematično polje.
    super(`${message} (na ${path})`);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Samo **čisti** JSON objekti (`{}` / `Object.create(null)`). Sve ostalo
 * (`Map`, `Set`, `Date`, klase) bi se tiho serializovalo kao `{}` i dalo lažno
 * isti hash za različite definicije.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function writeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(`Broj nije konačan (${String(value)}).`, path);
  }
  // `-0` se kanonizuje kao `0` da dva jednaka zapisa daju isti hash.
  return Object.is(value, -0) ? '0' : JSON.stringify(value);
}

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return writeNumber(value, path);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'undefined':
      throw new CanonicalizationError('Definicija ne smije sadržavati `undefined`.', path);
    case 'bigint':
      throw new CanonicalizationError('Definicija ne smije sadržavati `bigint`.', path);
    case 'function':
    case 'symbol':
      throw new CanonicalizationError('Definicija ne smije sadržavati funkcije ni simbole.', path);
    default:
      break;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) throw new CanonicalizationError('Neispravan datum.', path);
    return JSON.stringify(value.toISOString());
  }

  if (seen.has(value as object)) {
    throw new CanonicalizationError('Ciklična referenca u definiciji.', path);
  }
  seen.add(value as object);

  try {
    if (Array.isArray(value)) {
      const items = value.map((item, index) => {
        if (item === undefined) {
          throw new CanonicalizationError('Niz ne smije sadržavati `undefined`.', `${path}[${index}]`);
        }
        return canonicalize(item, `${path}[${index}]`, seen);
      });
      return `[${items.join(',')}]`;
    }

    if (isPlainObject(value)) {
      const keys = Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort();
      const parts = keys.map((key) => {
        const childPath = `${path}.${key}`;
        if (key === '__proto__') {
          throw new CanonicalizationError('Ključ `__proto__` nije dozvoljen.', childPath);
        }
        return `${JSON.stringify(key)}:${canonicalize(value[key], childPath, seen)}`;
      });
      return `{${parts.join(',')}}`;
    }

    throw new CanonicalizationError('Vrijednost nije JSON kompatibilna.', path);
  } finally {
    seen.delete(value as object);
  }
}

/** Kanonski JSON (sortirani ključevi, bez razmaka). Baca {@link CanonicalizationError}. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, '$', new Set<object>());
}

/** SHA-256 (hex) nad kanonskim JSON-om — `FormSchemaVersion.contentHash`. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * ETag vrijednost za `GET /form-schemas/:id/versions/:vid` (docs/04 §11).
 * Format: `"<contentHash>"` (jak ETag, jer je sadržaj nepromjenjiv).
 */
export function definitionETag(value: unknown): string {
  return `"${contentHash(value)}"`;
}

/**
 * Da li se dva `definition` objekta kanonski podudaraju (ignoriše redoslijed
 * ključeva objekata, poštuje redoslijed nizova). Koristi se za detekciju
 * izmjene objavljene verzije bez upotrebe hasha.
 */
export function sameCanonicalJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
