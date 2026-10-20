/**
 * `PermissionsService` — RBAC keš i evaluacija opsega (docs/05 §1, §5.3).
 *
 * Redis ključevi (svi unutar `~vfm:*`, već dokumentovani u `REDIS_ACL.md` §4):
 * - `vfm:perm:{userId}`       — keš izračunatih prava, TTL `PERMISSIONS_CACHE_TTL_SECONDS` (60 s)
 * - `vfm:permver:global`      — globalni brojač verzije permisija
 * - `vfm:permver:role:{roleId}`— brojač verzije po roli
 * - `vfm:tokenver:{userId}`   — `tokenVersion` (trenutno odjavljivanje svih sesija)
 *
 * Revokacija prava (P3 — ≤ 5 s bez ponovnog logina):
 * 1. izmjena matrice → `INCR vfm:permver:role:{id}` + brisanje `vfm:perm:*`,
 * 2. `PermissionsGuard` uporedi claim `pv` s trenutnom verzijom → ako je stariji,
 *    `401 PERMISSIONS_STALE` (+ `Retry-After: 0`) → klijent zove `/auth/refresh`,
 * 3. novi access token nosi svježu `pv`, a prava se računaju iz nove matrice →
 *    oduzeta permisija daje `403 PERMISSION_DENIED` bez ponovnog logina.
 *
 * Dostupnost:
 * - Redis nedostupan → keš se preskače, prava se čitaju iz baze svaki put
 *   (sporije, ali **nikad** manje sigurno),
 * - loader (Prisma) nedostupan → `503 DEPENDENCY_UNAVAILABLE` (fail closed;
 *   trenutno stanje dok bloker 1 nije riješen).
 *
 * ⚠️ 2FA se NE implementira (R-05).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  evaluateEffectivePermissions,
  hasPermission as hasPermissionIn,
  missingPermissions as missingPermissionsIn,
  type EffectivePermissionsResult,
  type Permission,
  type PermissionGrant,
  type PermissionScope,
} from '@vfm/shared';
import type { ClientType } from '@vfm/shared';
import { getEnv } from '../../../config/env.js';
// ⚠️ Value import (ne `import type`): klasa se emituje u `design:paramtypes`
// metadata, bez nje Nest ne može riješiti zavisnost.
import { RedisService } from '../../../infra/redis/redis.service.js';
import { VfmErrors } from '../../../common/errors/vfm-error.js';
import {
  PERMISSIONS_LOADER,
  type PermissionsLoader,
  type PermissionsRedisClient,
  type ScopeCheckResult,
  type ScopedResource,
  type UserPermissionsSnapshot,
} from './permissions.types.js';

/** JSON koji se kešira u `vfm:perm:{userId}`. */
interface CachedPermissions {
  /**
   * Redis verzija (`max(global, role brojači)`) u trenutku keširanja — koristi se
   * **samo** za detekciju zastarjelosti keša.
   */
  v: number;
  /** `Role.permissionsVersion` iz baze — ide u claim `pv` novog tokena. */
  pv: number;
  tv: number;
  status: UserPermissionsSnapshot['status'];
  roles: UserPermissionsSnapshot['roles'];
  roleIds: string[];
  allowedClientTypes: ClientType[];
  grants: UserPermissionsSnapshot['grants'];
  mustChangePassword: boolean;
  cachedAt: number;
}

/** Maksimalan broj SCAN iteracija pri brisanju keša (zaštita od beskonačne petlje). */
const MAX_SCAN_ITERATIONS = 500;
/** Broj ključeva po SCAN pozivu. */
const SCAN_COUNT = 200;

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  /** Da li je već logovano da Redis nije dostupan (bez spamovanja logova). */
  private redisWarned = false;

  constructor(
    private readonly redis: RedisService,
    @Optional() @Inject(PERMISSIONS_LOADER) private readonly loader?: PermissionsLoader,
  ) {}

  // ---------------------------------------------------------------------------
  //  Verzije i keš
  // ---------------------------------------------------------------------------

  /**
   * Trenutna globalna verzija permisija za date uloge:
   * `max(vfm:permver:global, vfm:permver:role:{id}…, dbVersion)`.
   *
   * Bez Redis-a vraća `dbVersion` (iz `Role.permissionsVersion`) — poredenje
   * ostaje konzistentno jer i token nosi `pv` iz istog izvora.
   */
  async currentPermissionsVersion(roleIds: readonly string[], dbVersion = 0): Promise<number> {
    return Math.max(await this.redisVersion(roleIds), dbVersion);
  }

  /**
   * Čista Redis verzija: `max(vfm:permver:global, vfm:permver:role:{id}…)`.
   * Bez Redis-a (ili pri grešci) vraća 0 → keš se tada i ne koristi.
   */
  private async redisVersion(roleIds: readonly string[]): Promise<number> {
    const client = this.client();
    if (!client) return 0;

    const keys = [
      this.redis.key('permissionsVersion', 'global'),
      ...roleIds.map((roleId) => this.redis.key('permissionsVersion', 'role', roleId)),
    ];

    try {
      const values = await client.mget(...keys);
      return values.reduce<number>((max, value) => Math.max(max, Number.parseInt(value ?? '0', 10) || 0), 0);
    } catch (error) {
      this.warnRedisOnce(`redisVersion: ${describe(error)}`);
      return 0;
    }
  }

  /**
   * Snapshot prava korisnika (keš → baza).
   *
   * @returns `undefined` ako korisnik ne postoji.
   * @throws `503 DEPENDENCY_UNAVAILABLE` ako nema loadera (Prisma) ni keša.
   */
  async snapshot(
    userId: string,
    options: { ignoreCache?: boolean } = {},
  ): Promise<UserPermissionsSnapshot | undefined> {
    if (!userId) throw VfmErrors.unauthenticated();
    const client = options.ignoreCache ? undefined : this.client();
    const cacheKey = this.redis.key('permissions', userId);

    if (client) {
      try {
        const raw = await client.get(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as CachedPermissions;
          const current = await this.redisVersion(cached.roleIds);
          if (current <= cached.v) return fromCache(cached, userId);

          // Verzija je porasla (revokacija prava) → keš je nevažeći (P3: ≤ 5 s).
          await client.del(cacheKey);
        }
      } catch (error) {
        this.warnRedisOnce(`snapshot(${userId}): ${describe(error)}`);
      }
    }

    const loaded = await this.loadFromSource(userId);
    if (!loaded) return undefined;

    if (client) {
      try {
        const version = await this.redisVersion(loaded.roleIds);
        await client.set(
          cacheKey,
          JSON.stringify(toCache(loaded, version)),
          'EX',
          getEnv().PERMISSIONS_CACHE_TTL_SECONDS,
        );
      } catch (error) {
        this.warnRedisOnce(`snapshot cache set(${userId}): ${describe(error)}`);
      }
    }

    return loaded;
  }

  /**
   * Izračunata (efektivna) prava — uključuje pravila:
   * neaktivan nalog = bez prava, Super Admin na mobilnom = bez prava (N-05),
   * Super Admin na webu = sve permisije s opsegom `ALL` (R-07).
   *
   * @returns `undefined` ako korisnik ne postoji.
   */
  async effective(
    userId: string,
    clientType: ClientType = 'WEB',
  ): Promise<EffectivePermissionsResult | undefined> {
    const data = await this.snapshot(userId);
    if (!data) return undefined;

    return evaluateEffectivePermissions({
      roles: data.roles,
      grants: data.grants,
      status: data.status,
      clientType,
    });
  }

  /** `tokenVersion` korisnika (Redis brojač ima prednost — trenutno odjavljivanje). */
  async tokenVersion(userId: string): Promise<number | undefined> {
    const client = this.client();
    if (client) {
      try {
        const raw = await client.get(this.redis.key('tokenVersion', userId));
        if (raw !== null) return Number.parseInt(raw, 10) || 0;
      } catch (error) {
        this.warnRedisOnce(`tokenVersion(${userId}): ${describe(error)}`);
      }
    }
    const data = await this.snapshot(userId);
    return data?.tokenVersion;
  }

  // ---------------------------------------------------------------------------
  //  Provjere (koriste ih guard-ovi i servisi)
  // ---------------------------------------------------------------------------

  /** Ima li korisnik permisiju (s potrebnim opsegom). */
  async hasPermission(
    userId: string,
    permission: Permission,
    requiredScope: PermissionScope = 'OWN',
    clientType: ClientType = 'WEB',
  ): Promise<boolean> {
    const result = await this.effective(userId, clientType);
    if (!result) return false;
    return hasPermissionIn(result, permission, requiredScope);
  }

  /**
   * Baca `403 PERMISSION_DENIED` ako permisija nedostaje.
   *
   * `details[]` nosi tačne kodove koji nedostaju — klijent ih prikazuje, a audit
   * ih bilježi kao `SECURITY` događaj (docs/05 §9).
   */
  async assertPermission(
    userId: string,
    permissions: readonly Permission[],
    clientType: ClientType = 'WEB',
  ): Promise<EffectivePermissionsResult> {
    const result = await this.effective(userId, clientType);
    if (!result) throw VfmErrors.unauthenticated();

    const missing = missingPermissionsIn(result, permissions);
    if (missing.length > 0) {
      throw VfmErrors.permissionDenied(
        missing.map((permission) => ({
          path: [permission],
          message: `Nemate pravo: ${permission}.`,
          code: 'permission_denied',
        })),
      );
    }
    return result;
  }

  /**
   * Provjera opsega nad konkretnim zapisom (`ALL` | `OWN` | `VEHICLE_IDS` |
   * `DRIVER_IDS` — docs/05 §1.2).
   *
   * Redoslijed: najširi važeći opseg pobjeđuje; ako nijedan ne pokriva resurs →
   * `allowed: false` (caller baca `403 SCOPE_DENIED`).
   */
  async checkScope(
    userId: string,
    permission: Permission,
    resource: ScopedResource,
    clientType: ClientType = 'WEB',
  ): Promise<ScopeCheckResult> {
    const result = await this.effective(userId, clientType);
    if (!result) {
      return { allowed: false, permission, scope: undefined, reason: 'korisnik ne postoji' };
    }
    if (result.isSuperAdmin) {
      return { allowed: true, permission, scope: 'ALL' };
    }

    const scope = result.permissions.get(permission);
    if (scope === undefined) {
      return { allowed: false, permission, scope: undefined, reason: 'permisija nije dodijeljena' };
    }

    switch (scope) {
      case 'ALL':
        return { allowed: true, permission, scope };

      case 'OWN':
        if (resource.ownerId && resource.ownerId === userId) {
          return { allowed: true, permission, scope };
        }
        return { allowed: false, permission, scope, reason: 'zapis nije vlasništvo korisnika' };

      case 'VEHICLE_IDS': {
        const allowedIds = collectIds(result.grants, permission, 'scopeVehicleIds');
        if (resource.vehicleId && allowedIds.has(resource.vehicleId)) {
          return { allowed: true, permission, scope };
        }
        return { allowed: false, permission, scope, reason: 'vozilo nije u dodijeljenoj listi' };
      }

      case 'DRIVER_IDS': {
        const allowedIds = collectIds(result.grants, permission, 'scopeDriverIds');
        if (resource.driverId && allowedIds.has(resource.driverId)) {
          return { allowed: true, permission, scope };
        }
        return { allowed: false, permission, scope, reason: 'vozač nije u dodijeljenoj listi' };
      }

      default:
        return { allowed: false, permission, scope, reason: `nepoznat opseg: ${String(scope)}` };
    }
  }

  /** Baca `403 SCOPE_DENIED` ako opseg ne pokriva resurs. */
  async assertScope(
    userId: string,
    permission: Permission,
    resource: ScopedResource,
    clientType: ClientType = 'WEB',
  ): Promise<void> {
    const check = await this.checkScope(userId, permission, resource, clientType);
    if (check.allowed) return;

    this.logger.warn(
      `SCOPE_DENIED user=${userId} permission=${permission} scope=${check.scope ?? '-'} razlog=${check.reason ?? '-'}`,
    );
    throw VfmErrors.scopeDenied([
      {
        path: [permission],
        message: 'Nemate pristup ovom zapisu u okviru dodijeljenog opsega.',
        code: 'scope_denied',
      },
    ]);
  }

  // ---------------------------------------------------------------------------
  //  Invalidacija (koriste je Roles/Users moduli)
  // ---------------------------------------------------------------------------

  /**
   * Povećava `tokenVersion` → **svi** postojeći access tokeni korisnika postaju
   * nevažeći na sljedećem zahtjevu (guard poredi claim `tv`).
   *
   * @param dbVersion `User.tokenVersion` **nakon** upisa u bazu. Kada se preda,
   *   Redis brojač se preslikava (`SET`) umjesto `INCR` — tako Redis i baza dijele
   *   isti numerički prostor (isto pravilo kao `invalidateRole`). Bez toga bi
   *   `INCR` od nule ostao **ispod** DB verzije, pa guard ne bi poništio token
   *   nakon odjave/promjene lozinke (P1/P3 bi pali u produkciji).
   */
  async bumpTokenVersion(userId: string, dbVersion?: number): Promise<number> {
    const client = this.client();
    const key = this.redis.key('tokenVersion', userId);

    if (client) {
      try {
        let next: number;
        if (dbVersion === undefined) {
          next = await client.incr(key);
        } else {
          // Monotonost: Redis nikad ne smije pasti ispod vrijednosti koju već
          // ima (stari tokeni s višim `tv` bi tada ponovo postali važeći).
          const raw = await client.get(key);
          const current = raw === null ? Number.NaN : Number.parseInt(raw, 10);
          next = Number.isNaN(current) ? dbVersion : Math.max(dbVersion, current);
          if (String(next) !== raw) await client.set(key, String(next));
        }
        await this.invalidateUser(userId);
        return next;
      } catch (error) {
        this.warnRedisOnce(`bumpTokenVersion(${userId}): ${describe(error)}`);
      }
    }

    // Bez Redis-a verziju vodi baza (`User.tokenVersion`) — caller je mora upisati.
    if (dbVersion !== undefined) return dbVersion;
    const data = await this.loadFromSource(userId);
    return (data?.tokenVersion ?? 0) + 1;
  }

  /** Briše keš prava jednog korisnika (npr. nakon izmjene uloga). */
  async invalidateUser(userId: string): Promise<void> {
    const client = this.client();
    if (!client) return;
    try {
      await client.del(this.redis.key('permissions', userId));
    } catch (error) {
      this.warnRedisOnce(`invalidateUser(${userId}): ${describe(error)}`);
    }
  }

  /**
   * Revokacija/izmjena prava jedne role: bump verzije + brisanje keša.
   *
   * @param dbVersion `Role.permissionsVersion` nakon upisa u bazu. Kada se preda,
   * brojač se **preslikava** (`SET`) umjesto `INCR` — tako Redis i baza dijele isti
   * numerički prostor pa nakon restarta/flushevanja Redis-a nema lažno svježih
   * tokena (revokacija bi bila propuštena).
   *
   * ⚠️ `KEYS` je ACL-om zabranjen → koristi se `SCAN MATCH` (REDIS_ACL.md §4).
   */
  async invalidateRole(roleId: string, dbVersion?: number): Promise<number> {
    const client = this.client();
    if (!client) return dbVersion ?? 0;
    const key = this.redis.key('permissionsVersion', 'role', roleId);
    try {
      if (dbVersion === undefined) {
        const version = await client.incr(key);
        await this.deleteByPattern(`${this.redis.key('permissions')}:*`);
        return version;
      }
      await client.set(key, String(dbVersion));
      await this.deleteByPattern(`${this.redis.key('permissions')}:*`);
      return dbVersion;
    } catch (error) {
      this.warnRedisOnce(`invalidateRole(${roleId}): ${describe(error)}`);
      return dbVersion ?? 0;
    }
  }

  /** Globalna invalidacija (npr. izmjena kataloga permisija ili sigurnosni incident). */
  async invalidateAll(): Promise<number> {
    const client = this.client();
    if (!client) return 0;
    try {
      const version = await client.incr(this.redis.key('permissionsVersion', 'global'));
      await this.deleteByPattern(`${this.redis.key('permissions')}:*`);
      return version;
    } catch (error) {
      this.warnRedisOnce(`invalidateAll: ${describe(error)}`);
      return 0;
    }
  }

  /** Da li je RBAC keš trenutno aktivan (dijagnostika/health). */
  get isCacheActive(): boolean {
    return this.client() !== undefined;
  }

  /** TTL keša u sekundama (iz ENV-a). */
  get cacheTtlSeconds(): number {
    return getEnv().PERMISSIONS_CACHE_TTL_SECONDS;
  }

  // ---------------------------------------------------------------------------
  //  Interno
  // ---------------------------------------------------------------------------

  /** Redis klijent ako je dostupan, inače `undefined` (graceful degradation). */
  private client(): PermissionsRedisClient | undefined {
    if (!this.redis.isEnabled || !this.redis.isAvailable()) return undefined;
    return this.redis.getConnection('api') as PermissionsRedisClient | undefined;
  }

  /** Čita snapshot iz izvora (Prisma). Bez loadera → 503 (fail closed). */
  private async loadFromSource(userId: string): Promise<UserPermissionsSnapshot | undefined> {
    if (!this.loader) {
      this.logger.error(
        'PermissionsLoader nije registrovan — RBAC ne može čitati prava iz baze (bloker 1: Prisma).',
      );
      throw VfmErrors.dependencyUnavailable('permissions');
    }
    return this.loader.loadSnapshot(userId);
  }

  /** SCAN + DEL po uzorku (bez `KEYS`, koji je ACL-om zabranjen). */
  private async deleteByPattern(pattern: string): Promise<number> {
    const client = this.client();
    if (!client) return 0;

    let cursor = '0';
    let deleted = 0;

    for (let iteration = 0; iteration < MAX_SCAN_ITERATIONS; iteration += 1) {
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
      if (keys.length > 0) deleted += await client.del(...keys);
      cursor = String(next);
      if (cursor === '0') break;
    }

    return deleted;
  }

  /** Jednokratno upozorenje da Redis nije dostupan (bez spamovanja po zahtjevu). */
  private warnRedisOnce(message: string): void {
    if (this.redisWarned) return;
    this.redisWarned = true;
    this.logger.warn(`Redis nije dostupan za RBAC keš — čitam prava iz baze. ${message}`);
  }
}

/** Kratak opis greške za log (bez stacka). */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Snapshot → JSON za keš. */
function toCache(data: UserPermissionsSnapshot, redisVersion: number): CachedPermissions {
  return {
    v: redisVersion,
    pv: data.permissionsVersion,
    tv: data.tokenVersion,
    status: data.status,
    roles: data.roles,
    roleIds: [...data.roleIds],
    allowedClientTypes: [...data.allowedClientTypes],
    grants: [...data.grants],
    mustChangePassword: data.mustChangePassword,
    cachedAt: Date.now(),
  };
}

/** JSON iz keša → snapshot (`userId` se ne kešira — dolazi iz zahtjeva). */
function fromCache(cached: CachedPermissions, userId: string): UserPermissionsSnapshot {
  return {
    userId,
    status: cached.status,
    roles: cached.roles,
    roleIds: cached.roleIds,
    grants: cached.grants,
    tokenVersion: cached.tv,
    allowedClientTypes: cached.allowedClientTypes,
    permissionsVersion: cached.pv,
    mustChangePassword: cached.mustChangePassword,
  };
}

/** Skup ID-ova iz grantova za dati opseg (unija preko svih uloga). */
function collectIds(
  grants: readonly PermissionGrant[],
  permission: Permission,
  field: 'scopeVehicleIds' | 'scopeDriverIds',
): Set<string> {
  const ids = new Set<string>();
  for (const grant of grants) {
    if (grant.permission !== permission) continue;
    for (const id of grant[field] ?? []) ids.add(id);
  }
  return ids;
}
