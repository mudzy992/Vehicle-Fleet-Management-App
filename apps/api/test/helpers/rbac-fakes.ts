/**
 * Test helperi za RBAC/auth (Faza 1).
 *
 * U sandboxu nema Redis servera ni Prisme, pa se koriste:
 * - `FakeRedis` — in-memory implementacija uskog interfejsa
 *   `PermissionsRedisClient`. **Namjerno nema `KEYS`** (ACL ga zabranjuje,
 *   `REDIS_ACL.md` §4) → svaki kod koji bi ga pozvao pada na testovima.
 * - `FakeLoader` — zamjena za `PrismaPermissionsLoader` (bloker 1).
 * - `fakeExecutionContext` — ExecutionContext s običnim objektima (bez express-a).
 */
import type { ExecutionContext } from '@nestjs/common';
import { REDIS_NS, type PermissionGrant } from '@vfm/shared';
import type { RedisService } from '../../src/infra/redis/redis.service.js';
import type {
  PermissionsLoader,
  PermissionsRedisClient,
  UserPermissionsSnapshot,
} from '../../src/modules/auth/permissions/permissions.types.js';
import type { AuthenticatedUser, VfmRequest } from '../../src/common/types/authenticated-user.js';
import type { SecurityEvent, SecurityEventSink } from '../../src/common/audit/security-event.js';

// -----------------------------------------------------------------------------
//  IDs i fiksni podaci
// -----------------------------------------------------------------------------

export const USER_SUPER = '018f0000-0000-7000-8000-000000000001';
export const USER_ADMIN = '018f0000-0000-7000-8000-000000000002';
export const USER_DRIVER = '018f0000-0000-7000-8000-000000000003';
export const ROLE_SUPER_ID = '018f0000-0000-7000-8000-000000000r00';
export const ROLE_ADMIN_ID = '018f0000-0000-7000-8000-000000000r01';
export const ROLE_DRIVER_ID = '018f0000-0000-7000-8000-000000000r02';
export const VEHICLE_1 = '018f0000-0000-7000-8000-000000000v01';
export const VEHICLE_2 = '018f0000-0000-7000-8000-000000000v02';
export const DRIVER_1 = '018f0000-0000-7000-8000-000000000d01';

export const ADMIN_GRANTS: readonly PermissionGrant[] = [
  { permission: 'vehicle:view', scope: 'ALL' },
  { permission: 'vehicle:create', scope: 'ALL' },
  { permission: 'task:view', scope: 'ALL' },
  { permission: 'task:execute', scope: 'ALL' },
];

export const DRIVER_GRANTS: readonly PermissionGrant[] = [
  { permission: 'vehicle:view', scope: 'VEHICLE_IDS', scopeVehicleIds: [VEHICLE_1] },
  { permission: 'task:view', scope: 'DRIVER_IDS', scopeDriverIds: [DRIVER_1] },
  { permission: 'task:execute', scope: 'OWN' },
  { permission: 'fuel:create', scope: 'OWN' },
];

/** Snapshot s razumnim defaultima (testovi ga preklopljuju). */
export function snapshot(
  overrides: Partial<UserPermissionsSnapshot> & { userId: string },
): UserPermissionsSnapshot {
  return {
    status: 'ACTIVE',
    roles: ['OBICNI_KORISNIK'],
    roleIds: [ROLE_DRIVER_ID],
    grants: [],
    tokenVersion: 1,
    allowedClientTypes: ['WEB', 'MOBILE_ANDROID'],
    permissionsVersion: 1,
    mustChangePassword: false,
    ...overrides,
  };
}

export const SUPER_ADMIN_SNAPSHOT = snapshot({
  userId: USER_SUPER,
  roles: ['SUPER_ADMIN'],
  roleIds: [ROLE_SUPER_ID],
  allowedClientTypes: ['WEB'],
});

export const ADMIN_SNAPSHOT = snapshot({
  userId: USER_ADMIN,
  roles: ['ADMINISTRATOR'],
  roleIds: [ROLE_ADMIN_ID],
  grants: ADMIN_GRANTS,
  tokenVersion: 4,
});

export const DRIVER_SNAPSHOT = snapshot({
  userId: USER_DRIVER,
  roles: ['OBICNI_KORISNIK'],
  roleIds: [ROLE_DRIVER_ID],
  grants: DRIVER_GRANTS,
});

// -----------------------------------------------------------------------------
//  Redis fake
// -----------------------------------------------------------------------------

/** In-memory Redis (podskup komandi koje RBAC keš koristi). */
export class FakeRedis implements PermissionsRedisClient {
  readonly store = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  /** TTL-ovi postavljeni preko `PEXPIRE` (u ms). */
  readonly pttls = new Map<string, number>();
  scanCalls = 0;
  /** Simulacija kvara (NOPERM/timeout) — potroši se na prvi poziv. */
  failNext = false;

  async get(key: string): Promise<string | null> {
    this.maybeFail();
    return this.store.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _mode?: 'EX',
    seconds?: number,
    condition?: 'NX',
  ): Promise<'OK' | null> {
    this.maybeFail();
    if (condition === 'NX' && this.store.has(key)) return null;
    this.store.set(key, value);
    if (seconds !== undefined) this.ttls.set(key, seconds);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    this.maybeFail();
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
      this.ttls.delete(key);
      this.pttls.delete(key);
    }
    return removed;
  }

  async incr(key: string): Promise<number> {
    this.maybeFail();
    const next = (Number.parseInt(this.store.get(key) ?? '0', 10) || 0) + 1;
    this.store.set(key, String(next));
    return next;
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    this.maybeFail();
    return keys.map((key) => this.store.get(key) ?? null);
  }

  async scan(
    cursor: string | number,
    _matchKeyword: 'MATCH',
    pattern: string,
    _countKeyword: 'COUNT',
    _count: number,
  ): Promise<[string, string[]]> {
    this.maybeFail();
    this.scanCalls += 1;
    if (String(cursor) !== '0') return ['0', []];
    const regex = new RegExp(
      `^${pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\\\*/gu, '.*')}$`,
      'u',
    );
    return ['0', [...this.store.keys()].filter((key) => regex.test(key))];
  }

  /** `PEXPIRE` — pamti TTL u ms (kao ioredis). */
  async pexpire(key: string, milliseconds: number): Promise<number> {
    this.maybeFail();
    if (!this.store.has(key)) return 0;
    this.pttls.set(key, milliseconds);
    return 1;
  }

  /** `PTTL` — preostali TTL u ms; -2 ako ključ ne postoji, -1 ako nema TTL. */
  async pttl(key: string): Promise<number> {
    this.maybeFail();
    if (!this.store.has(key)) return -2;
    return this.pttls.get(key) ?? -1;
  }

  /** Ključevi u store-u (za asertacije). */
  keys(): string[] {
    return [...this.store.keys()];
  }

  private maybeFail(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('NOPERM simuliran kvar');
    }
  }
}

/** Fake `RedisService` (samo ono što RBAC sloj koristi). */
export function fakeRedisService(client: FakeRedis | undefined, available = true): RedisService {
  return {
    isEnabled: client !== undefined,
    isAvailable: () => available && client !== undefined,
    getConnection: () => client,
    requireConnection: () => {
      if (!client) throw new Error('Redis nije konfigurisan (REDIS_HOST nije postavljen).');
      return client;
    },
    key: (namespace: keyof typeof REDIS_NS, ...parts: readonly (string | number)[]) =>
      parts.length > 0 ? `${REDIS_NS[namespace]}:${parts.join(':')}` : REDIS_NS[namespace],
  } as unknown as RedisService;
}

// -----------------------------------------------------------------------------
//  Loader fake
// -----------------------------------------------------------------------------

/** Zamjena za `PrismaPermissionsLoader`. */
export class FakeLoader implements PermissionsLoader {
  calls = 0;
  private readonly users = new Map<string, UserPermissionsSnapshot>();

  constructor(users: readonly UserPermissionsSnapshot[] = []) {
    for (const user of users) this.users.set(user.userId, user);
  }

  async loadSnapshot(userId: string): Promise<UserPermissionsSnapshot | undefined> {
    this.calls += 1;
    return this.users.get(userId);
  }

  /** Simulira izmjenu u bazi (kao što to radi Roles/Users modul). */
  update(userId: string, patch: Partial<UserPermissionsSnapshot>): void {
    const current = this.users.get(userId);
    if (!current) return;
    this.users.set(userId, { ...current, ...patch });
  }
}

// -----------------------------------------------------------------------------
//  Security sink fake
// -----------------------------------------------------------------------------

/** Bilježi sigurnosne događaje (za asertacije P1/P3). */
export class RecordingSecuritySink implements SecurityEventSink {
  readonly events: SecurityEvent[] = [];

  record(event: SecurityEvent): void {
    this.events.push(event);
  }

  /** Tipovi događaja (redoslijed prijave). */
  get types(): string[] {
    return this.events.map((event) => event.type);
  }
}

// -----------------------------------------------------------------------------
//  HTTP fake (ExecutionContext bez express-a)
// -----------------------------------------------------------------------------

/** Fake HTTP odgovor s `setHeader` (za `Retry-After`). */
export class FakeResponse {
  readonly headers: Record<string, string> = {};
  statusCode: number | undefined;

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }
}

/** Fake zahtjev. */
export function fakeRequest(options: {
  user?: AuthenticatedUser;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  id?: string;
  ip?: string;
}): VfmRequest {
  const request: VfmRequest = {
    id: options.id ?? 'req-test-1',
    method: options.method ?? 'GET',
    url: options.url ?? '/api/v1/vehicles',
    ip: options.ip ?? '203.0.113.10',
    headers: { 'user-agent': 'vitest', ...options.headers },
    ...(options.user ? { user: options.user } : {}),
  };
  return request;
}

/** Fake `ExecutionContext` (handler nosi metadata stvarnih dekoratora). */
export function fakeExecutionContext(options: {
  handler: (...args: never[]) => unknown;
  controller?: unknown;
  request: VfmRequest;
  response?: FakeResponse;
}): ExecutionContext {
  const response = options.response ?? new FakeResponse();
  return {
    getHandler: () => options.handler,
    getClass: () => (options.controller ?? class {}) as never,
    switchToHttp: () => ({
      getRequest: () => options.request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
    switchToRpc: () => undefined,
    switchToWs: () => undefined,
    getType: () => 'http',
    getArgs: () => [options.request, response],
    getArgByIndex: (index: number) => (index === 0 ? options.request : response),
  } as unknown as ExecutionContext;
}

/** Autentificirani korisnik kakvog postavlja `JwtAuthGuard`. */
export function authenticatedUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_ADMIN,
    roles: ['ADMINISTRATOR'],
    roleIds: [ROLE_ADMIN_ID],
    clientType: 'WEB',
    sessionId: '018f0000-0000-7000-8000-0000000000aa',
    jti: '018f0000-0000-7000-8000-0000000000bb',
    tokenVersion: 1,
    permissionsVersion: 1,
    isSuperAdmin: false,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB', 'MOBILE_ANDROID'],
    ...overrides,
  };
}
