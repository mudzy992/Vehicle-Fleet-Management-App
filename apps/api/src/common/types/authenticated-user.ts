/**
 * Tipovi za autentificirani zahtjev (Faza 1).
 *
 * `JwtAuthGuard` puni `request.user` iz access tokena + snapshot-a prava, a
 * `ClientTypeGuard`/`PermissionsGuard` i controlleri ga čitaju. Namjerno **bez**
 * express tipova: guard-ovi se mogu unit-testirati s običnim objektima, a isti
 * ugovor važi i ako se kasnije prijeđe na Fastify.
 */
import type { ClientType, EffectivePermissionsResult, RoleCode, UserStatus } from '@vfm/shared';

/** Korisnik povezan s aktualnim zahtjevom (postavlja ga `JwtAuthGuard`). */
export interface AuthenticatedUser {
  /** UUID korisnika (`sub` iz tokena). */
  readonly id: string;
  /** E-mail (iz snapshot-a; opciono jer keš ga ne mora nositi). */
  readonly email?: string;
  /** Kodovi uloga (claim `roles`). */
  readonly roles: readonly RoleCode[];
  /** UUID-ovi uloga — za `vfm:permver:role:{roleId}` (provjera svježine prava). */
  readonly roleIds: readonly string[];
  /** Tip klijenta s kojeg je zahtjev poslan (claim `ct`) — N-05/P1. */
  readonly clientType: ClientType;
  /** ID refresh sesije (claim `sid`). */
  readonly sessionId: string;
  /** ID access tokena (claim `jti`) — za audit i opoziv pojedinog tokena. */
  readonly jti: string;
  /** `tokenVersion` iz tokena (claim `tv`). */
  readonly tokenVersion: number;
  /** `permissionsVersion` iz tokena (claim `pv`) — za provjeru svježine prava (P3). */
  readonly permissionsVersion: number;
  /** Ima li ulogu `SUPER_ADMIN` (R-07). */
  readonly isSuperAdmin: boolean;
  /** Mora li promijeniti lozinku pri prvom loginu (bootstrap/seed/reset). */
  readonly mustChangePassword: boolean;
  /** Status naloga — neaktivan nalog nema prava. */
  readonly status: UserStatus;
  /** Dozvoljeni tipovi klijenta za korisnikove uloge (union). */
  readonly allowedClientTypes: readonly ClientType[];
  /** Izračunata prava (popunjava se uz `clientType` iz zahtjeva). */
  readonly permissions?: EffectivePermissionsResult;
}

/** HTTP zahtjev s VFM proširenjima (requestId + user). */
export interface VfmRequest {
  /** `X-Request-Id` — postavlja ga `RequestIdMiddleware`. */
  readonly id?: string;
  readonly method: string;
  readonly url: string;
  readonly ip?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly cookies?: Readonly<Record<string, string | undefined>>;
  /** Popunjava ga `JwtAuthGuard`. */
  user?: AuthenticatedUser;
}

/** Zaglavlje s tipom klijenta (`X-Client-Type`) — server-side provjera (N-05). */
export const CLIENT_TYPE_HEADER_NAME = 'x-client-type';

/**
 * Čita tip klijenta iz zahtjeva: JWT claim `ct` ima prednost (potpisan je), a
 * zaglavlje se koristi samo za **login** (kad token još ne postoji).
 */
export function requestClientType(request: Pick<VfmRequest, 'headers' | 'user'>): ClientType | undefined {
  const fromToken = request.user?.clientType;
  if (fromToken) return fromToken;

  const header = request.headers[CLIENT_TYPE_HEADER_NAME];
  const value = Array.isArray(header) ? header[0] : header;
  return value as ClientType | undefined;
}
