/**
 * `TokenService` — access JWT + refresh token (docs/05 §5, docs/07 §3.1).
 *
 * Access token: JWT HS256, TTL `JWT_ACCESS_TTL` (10 min), issuer `JWT_ISSUER`
 * (`vfm-api`), audience `JWT_AUDIENCE` (`vfm-clients`). Claimovi:
 * `sub`, `jti`, `iat`, `exp`, `roles` (samo kodovi), `tv` (tokenVersion),
 * `pv` (permissionsVersion), `ct` (clientType), `sid` (sessionId).
 *
 * Refresh token: **nije JWT** — 32 B CSPRNG (base64url), u bazi se čuva isključivo
 * SHA-256 hash (`RefreshSession.tokenHash`), a klijentu ide kroz HttpOnly cookie
 * (`vfm_refresh`, Path `/api/v1/auth`).
 *
 * Sigurnosna pravila:
 * - algoritam je **pinovan** na HS256 i pri verify-u (`algorithms: ['HS256']`) →
 *   `alg: none` i RS/HS konfuzija nisu mogući,
 * - issuer/audience se provjeravaju → token druge usluge ne prolazi,
 * - istekao token → `401 TOKEN_EXPIRED`, bilo šta drugo → `401 UNAUTHENTICATED`
 *   (bez otkrivanja razloga napadaču),
 * - `tv`/`pv` u tokenu su samo **snapshot**: pravo stanje se čita iz Redis-a na
 *   svakom zahtjevu (docs/05 §5.3), pa opoziv prava važi ≤ 5 s bez re-logina.
 *
 * ⚠️ 2FA se NE implementira (R-05).
 */
import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import {
  CLIENT_TYPES,
  JWT_CLAIMS,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  REFRESH_TOKEN_BYTES,
  type ClientType,
} from '@vfm/shared';
import { durationToSeconds, type BaseEnv } from '@vfm/shared/env';
import { getEnv } from '../../../config/env.js';
import { VfmErrors } from '../../../common/errors/vfm-error.js';

/** Tip klijenta je validan ako je u `CLIENT_TYPES` enumu. */
function isClientType(value: unknown): value is ClientType {
  return typeof value === 'string' && (CLIENT_TYPES as readonly string[]).includes(value);
}

/** Algoritam potpisa — pinovan (nikad se ne čita iz tokena). */
export const ACCESS_TOKEN_ALGORITHM = 'HS256';

/** Claimovi access tokena (skraćena imena iz `JWT_CLAIMS`). */
export interface AccessTokenClaims {
  /** `sub` — UUID korisnika. */
  sub: string;
  /** `jti` — jedinstveni ID tokena (za audit i opoziv pojedinačnog tokena). */
  jti: string;
  /** `iat` — izdavanje (UNIX sekunde). */
  iat: number;
  /** `exp` — istek (UNIX sekunde). */
  exp: number;
  /** `iss` — izdavaoc. */
  iss: string;
  /** `aud` — publika. */
  aud: string;
  /** `roles` — kodovi dodijeljenih uloga (bez prava; prava idu iz Redis keša). */
  roles: string[];
  /** `tv` — `tokenVersion` korisnika u trenutku izdavanja. */
  tv: number;
  /** `pv` — `permissionsVersion` u trenutku izdavanja. */
  pv: number;
  /** `ct` — tip klijenta s kojeg je login izvršen. */
  ct: ClientType;
  /** `sid` — ID refresh sesije kojoj access token pripada. */
  sid: string;
}

/** Ulaz za izdavanje access tokena. */
export interface SignAccessTokenInput {
  userId: string;
  /** Kodovi uloga (npr. `['SUPER_ADMIN']`). */
  roles: readonly string[];
  tokenVersion: number;
  permissionsVersion: number;
  clientType: ClientType;
  sessionId: string;
  /** Opcioni `jti` (inače se generiše). */
  jti?: string;
}

/** Rezultat izdavanja access tokena. */
export interface SignedAccessToken {
  accessToken: string;
  /** TTL u sekundama — ide u odgovor `/auth/login` i `/auth/refresh`. */
  expiresIn: number;
  tokenType: 'Bearer';
  claims: AccessTokenClaims;
}

/** Opcije cookie-ja (bez express tipova — koristi ih i Fastify adapter). */
export interface RefreshCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  domain?: string;
  /**
   * Vrijeme života cookie-ja u **milisekundama** (konvencija express/fastify
   * `res.cookie`), jednako TTL-u refresh tokena; `0` kod brisanja (logout).
   */
  maxAge: number;
}

/**
 * Izdavanje i verifikacija tokena.
 *
 * Env i JWT instanca se čitaju **lijeno** (pri prvom pozivu), pa testovi mogu
 * postaviti `process.env` + `__resetEnvCache()` bez rekonstrukcije servisa.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private cachedJwt: { secret: string; service: JwtService } | undefined;

  /** Naziv refresh cookie-ja (`COOKIE_NAME`, default `vfm_refresh`). */
  get refreshCookieName(): string {
    return this.env().COOKIE_NAME;
  }

  private env(): BaseEnv {
    return getEnv();
  }

  /** JWT servis s trenutnim secretom (memoizirano; secret rotacija → nova instanca). */
  private jwt(): JwtService {
    const env = this.env();
    const cached = this.cachedJwt;
    if (cached && cached.secret === env.JWT_ACCESS_SECRET) return cached.service;
    const service = new JwtService({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: {
        algorithm: ACCESS_TOKEN_ALGORITHM,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      },
    });
    this.cachedJwt = { secret: env.JWT_ACCESS_SECRET ?? '', service };
    return service;
  }

  /** TTL access tokena u sekundama (iz `JWT_ACCESS_TTL`, npr. `10m` → 600). */
  accessTokenTtlSeconds(): number {
    return durationToSeconds(this.env().JWT_ACCESS_TTL);
  }

  /** TTL refresh tokena u sekundama (iz `JWT_REFRESH_TTL`, npr. `30d` → 2 592 000). */
  refreshTokenTtlSeconds(): number {
    return durationToSeconds(this.env().JWT_REFRESH_TTL);
  }

  /**
   * Izdaje access JWT s punim setom claimova.
   *
   * @throws `500 INTERNAL_ERROR` ako `JWT_SECRET` nije postavljen — fail fast umjesto
   * potpisivanja praznim secretom.
   */
  signAccessToken(input: SignAccessTokenInput): SignedAccessToken {
    const env = this.env();
    if (!env.JWT_ACCESS_SECRET) {
      // Fail fast: potpisivanje bez tajne bi proizvelo tokene koje niko ne može
      // verifikovati. Razlog ide u log, a klijent dobija generički 500
      // (detalji implementacije se ne iznose u odgovoru).
      this.logger.error('JWT_ACCESS_SECRET nije postavljen — nije moguće izdati access token.');
      throw VfmErrors.internal();
    }
    if (!isClientType(input.clientType)) {
      // Programerska greška (clientType mora proći DTO validaciju prije ove tačke).
      this.logger.error(`Neispravan clientType za izdavanje tokena: ${String(input.clientType)}`);
      throw VfmErrors.internal();
    }

    const expiresIn = this.accessTokenTtlSeconds();
    const jti = input.jti ?? randomBytes(16).toString('base64url');
    const payload: Record<string, unknown> = {
      sub: input.userId,
      // `jti` ide direktno u payload (jsonwebtoken ne dozvoljava istovremeno
      // `payload.jti` i `options.jwtid`).
      jti,
      [JWT_CLAIMS.roles]: [...input.roles],
      [JWT_CLAIMS.tokenVersion]: input.tokenVersion,
      [JWT_CLAIMS.permissionsVersion]: input.permissionsVersion,
      [JWT_CLAIMS.clientType]: input.clientType,
      [JWT_CLAIMS.sessionId]: input.sessionId,
    };

    const accessToken = this.jwt().sign(payload, { expiresIn: `${expiresIn}s` });
    const claims = this.decodeClaims(accessToken);

    return { accessToken, expiresIn, tokenType: 'Bearer', claims };
  }

  /**
   * Verifikuje access token: potpis, `exp`, `iss`, `aud` i obavezne claimove.
   *
   * @throws `401 TOKEN_EXPIRED` za istekao token, `401 UNAUTHENTICATED` za sve ostalo
   * (neispravan potpis, pogrešan issuer/audience, nepotpuni claimovi).
   */
  verifyAccessToken(token: string): AccessTokenClaims {
    const env = this.env();
    if (!token.trim()) throw VfmErrors.unauthenticated();

    let payload: unknown;
    try {
      payload = this.jwt().verify(token, {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) throw VfmErrors.tokenExpired();
      this.logger.debug(
        `Odbijen access token: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      );
      throw VfmErrors.unauthenticated();
    }

    return this.assertClaims(payload);
  }

  /**
   * Generiše refresh token (CSPRNG) i njegov SHA-256 hash za pohranu.
   *
   * U bazi se **nikad** ne čuva sirovi token — samo hash (`RefreshSession.tokenHash`),
   * pa curenje baze ne omogućava preuzimanje sesija.
   */
  generateRefreshToken(): { token: string; tokenHash: string } {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  /** SHA-256 (hex) hash tokena — koristi se i za token za reset lozinke. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generiše jednokratni token za reset lozinke (30 min, `PASSWORD_RESET_TOKEN_TTL_MINUTES`).
   *
   * Vraća i sirovi token (koji se **jednom** šalje korisniku/adminu) i hash za bazu.
   */
  generatePasswordResetToken(): { token: string; tokenHash: string; expiresAt: Date; ttlMinutes: number } {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    return {
      token,
      tokenHash: this.hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60_000),
      ttlMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
    };
  }

  /** Opcije za postavljanje refresh cookie-ja (docs/05 §5.2). */
  refreshCookieOptions(): RefreshCookieOptions {
    const env = this.env();
    return {
      // HttpOnly je obavezan (docs/05 §5.2) i namjerno NIJE konfigurabilan:
      // refresh token ne smije biti čitljiv iz JS-a (XSS).
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: env.COOKIE_PATH,
      ...(env.COOKIE_DOMAIN?.trim() ? { domain: env.COOKIE_DOMAIN.trim() } : {}),
      maxAge: this.refreshTokenTtlSeconds() * 1000,
    };
  }

  /** Opcije za brisanje refresh cookie-ja (isti `path`/`domain`, `maxAge: 0`). */
  clearRefreshCookieOptions(): RefreshCookieOptions {
    return { ...this.refreshCookieOptions(), maxAge: 0 };
  }

  /** Dekodira payload bez verifikacije — samo za log/dijagnostiku. */
  decodeClaims(token: string): AccessTokenClaims {
    const payload = this.jwt().decode(token);
    return this.assertClaims(payload);
  }

  /** Provjera obaveznih claimova nakon verify-a (payload je `unknown`). */
  private assertClaims(payload: unknown): AccessTokenClaims {
    if (typeof payload !== 'object' || payload === null) throw VfmErrors.unauthenticated();
    const raw = payload as Record<string, unknown>;

    const sub = raw.sub;
    const jti = raw.jti;
    const sid = raw[JWT_CLAIMS.sessionId];
    const roles = raw[JWT_CLAIMS.roles];
    const tv = raw[JWT_CLAIMS.tokenVersion];
    const pv = raw[JWT_CLAIMS.permissionsVersion];
    const ct = raw[JWT_CLAIMS.clientType];
    const iat = raw.iat;
    const exp = raw.exp;
    const iss = raw.iss;
    const aud = raw.aud;

    if (
      typeof sub !== 'string' ||
      typeof jti !== 'string' ||
      typeof sid !== 'string' ||
      !Array.isArray(roles) ||
      !roles.every((role) => typeof role === 'string') ||
      typeof tv !== 'number' ||
      typeof pv !== 'number' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number' ||
      typeof iss !== 'string' ||
      typeof aud !== 'string' ||
      !isClientType(ct)
    ) {
      throw VfmErrors.unauthenticated();
    }

    return {
      sub,
      jti,
      sid,
      roles: roles as string[],
      tv,
      pv,
      ct: ct as ClientType,
      iat,
      exp,
      iss,
      aud,
    };
  }
}
