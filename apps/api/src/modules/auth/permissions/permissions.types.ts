/**
 * Tipovi za RBAC sloj (docs/05 §1–§5).
 *
 * Zašto odvojeni od `PermissionsService`: izvor podataka o pravima je Prisma
 * (`Role`, `RolePermission`, `UserRole`), a Prisma sloj još nije dostupan
 * (bloker 1). Servis zato radi nad **loader interfejsom** — kad migracija `init`
 * bude u repou, dodaje se `PrismaPermissionsLoader` i registruje u `AuthModule`,
 * bez izmjene guard-ova, servisâ ili testova.
 */
import type {
  ClientType,
  Permission,
  PermissionGrant,
  PermissionScope,
  RoleCode,
  UserStatus,
} from '@vfm/shared';

/**
 * Snapshot prava jednog korisnika (čita se iz baze, kešira u Redisu).
 *
 * `permissionsVersion` je **izračunata** vrijednost u trenutku čitanja
 * (`max(global, per-role)` iz Redis brojača ili iz `Role.permissionsVersion`),
 * pa se kasnije može uporediti s trenutnom i tako otkriti revokacija (P3: ≤ 5 s).
 */
export interface UserPermissionsSnapshot {
  readonly userId: string;
  /** `ACTIVE` | `INACTIVE` | `SUSPENDED` | `PENDING` — neaktivan nalog nema prava. */
  readonly status: UserStatus;
  /** Kodovi uloga (idú i u JWT claim `roles`). */
  readonly roles: readonly RoleCode[];
  /** UUID-ovi uloga (za `vfm:permver:role:{roleId}`). */
  readonly roleIds: readonly string[];
  /** Grantovi iz `RolePermission` (permisija + opseg + ID liste). */
  readonly grants: readonly PermissionGrant[];
  /** `User.tokenVersion` — za trenutno odjavljivanje svih sesija. */
  readonly tokenVersion: number;
  /** Dozvoljeni tipovi klijenta (unija po ulogama; N-05/P1). */
  readonly allowedClientTypes: readonly ClientType[];
  /** Verzija permisija u trenutku čitanja snapshot-a. */
  readonly permissionsVersion: number;
  /** Zahtijevana promjena lozinke pri prvom loginu (bootstrap/seed/reset). */
  readonly mustChangePassword: boolean;
}

/** Izvor podataka o pravima (Prisma implementacija dolazi s blokerom 1). */
export interface PermissionsLoader {
  /**
   * Učitava snapshot korisnika.
   *
   * @returns `undefined` ako korisnik ne postoji (guard tada vraća
   * `401 UNAUTHENTICATED`, nikad 404 — bez otkrivanja postojanja naloga).
   */
  loadSnapshot(userId: string): Promise<UserPermissionsSnapshot | undefined>;
}

/** DI token za `PermissionsLoader`. */
export const PERMISSIONS_LOADER = Symbol('VFM_PERMISSIONS_LOADER');

/** Resurs nad kojim se provjerava opseg (`ALL` | `OWN` | `VEHICLE_IDS` | `DRIVER_IDS`). */
export interface ScopedResource {
  /** UUID vozila (za opseg `VEHICLE_IDS`). */
  readonly vehicleId?: string;
  /** UUID vozača (za opseg `DRIVER_IDS`). */
  readonly driverId?: string;
  /** UUID vlasnika zapisa — korisnik koji ga je kreirao (za opseg `OWN`). */
  readonly ownerId?: string;
}

/** Rezultat provjere opsega. */
export interface ScopeCheckResult {
  readonly allowed: boolean;
  readonly permission: Permission;
  /** Opseg koji je odlučen (najširi važeći grant). */
  readonly scope: PermissionScope | undefined;
  /** Razlog odbijanja (za log; klijent dobija generički `SCOPE_DENIED`). */
  readonly reason?: string;
}

/**
 * Podskup ioredis komandi koje koristi RBAC keš.
 *
 * Namjerno uzak interfejs: `RedisService.getConnection('api')` ga strukturno
 * zadovoljava, a unit testovi mogu ubaciti in-memory fake (u sandboxu nema
 * Redis servera, pa bi testovi inače bili nemogući).
 */
export interface PermissionsRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: 'EX', seconds?: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  scan(
    cursor: string | number,
    matchKeyword: 'MATCH',
    pattern: string,
    countKeyword: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>;
}
