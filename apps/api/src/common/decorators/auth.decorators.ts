/**
 * Auth/RBAC dekoratori (docs/05 §5.3, docs/07 §7).
 *
 * Deklarativna autorizacija: controller **navodi** šta je potrebno, a guard-ovi
 * (`JwtAuthGuard` → `ClientTypeGuard` → `PermissionsGuard`) to provjeravaju.
 * Time je nemoguće zaboraviti provjeru u handler-u, a P14 (bez podataka preko
 * direktnog URL-a) važi jednako za API i za web.
 *
 * ⚠️ 2FA se NE implementira (R-05) — nema `@RequireOtp` i sličnih dekoratora.
 */
import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuditAction, AuditSeverity, ClientType, Permission, PermissionScope } from '@vfm/shared';
import type { AuthenticatedUser, VfmRequest } from '../types/authenticated-user.js';

// -----------------------------------------------------------------------------
//  @Public
// -----------------------------------------------------------------------------

/** Metadata ključ za javne rute. */
export const IS_PUBLIC_KEY = 'vfm:isPublic';

/**
 * Označava rutu kao javnu (bez tokena): `/auth/login`, `/auth/refresh`,
 * `/auth/forgot-password`, `/health/*`.
 *
 * Sve ostale rute zahtijevaju access token (globalni `JwtAuthGuard`).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Čita `@Public` s handler-a ili controllera. */
export function isPublicRoute(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]) === true
  );
}

// -----------------------------------------------------------------------------
//  @RequirePermissions
// -----------------------------------------------------------------------------

/** Metadata ključ za tražene permisije. */
export const REQUIRED_PERMISSIONS_KEY = 'vfm:requiredPermissions';

/** Kako se upoređuje više traženih permisija. */
export type PermissionMode = 'ALL' | 'ANY';

export interface RequiredPermissionsMetadata {
  readonly permissions: readonly Permission[];
  readonly mode: PermissionMode;
  /** Minimalan opseg koji zadovoljava zahtjev (default `OWN`). */
  readonly scope: PermissionScope;
}

/**
 * Zahtijeva **sve** navedene permisije (najčešći slučaj).
 *
 * ```ts
 * @Post()
 * @RequirePermissions('vehicle:create')
 * create(@Body(new ZodValidationPipe(createVehicleSchema)) input: CreateVehicleInput) { … }
 * ```
 */
export const RequirePermissions = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, {
    permissions,
    mode: 'ALL',
    scope: 'OWN',
  } satisfies RequiredPermissionsMetadata);

/** Zahtijeva **bilo koju** od navedenih permisija (npr. `task:view` ili `task:manage`). */
export const RequireAnyPermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, {
    permissions,
    mode: 'ANY',
    scope: 'OWN',
  } satisfies RequiredPermissionsMetadata);

/** Zahtijeva permisiju s **tačno određenim opsegom** (npr. izvještaji: `ALL`). */
export const RequireScope = (
  permission: Permission,
  scope: PermissionScope,
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, {
    permissions: [permission],
    mode: 'ALL',
    scope,
  } satisfies RequiredPermissionsMetadata);

/** Čita tražene permisije s handler-a (ima prednost nad controllerom). */
export function requiredPermissions(
  reflector: Reflector,
  context: ExecutionContext,
): RequiredPermissionsMetadata | undefined {
  return reflector.getAllAndOverride<RequiredPermissionsMetadata | undefined>(REQUIRED_PERMISSIONS_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}

// -----------------------------------------------------------------------------
//  @AllowedClientTypes (N-05)
// -----------------------------------------------------------------------------

/** Metadata ključ za dozvoljene tipove klijenta na ruti. */
export const ALLOWED_CLIENT_TYPES_KEY = 'vfm:allowedClientTypes';

/**
 * Ograničava rutu na navedene tipove klijenta.
 *
 * Bez ovog dekoratora važe `allowedClientTypes` korisnikovih uloga (iz baze), uz
 * dodatno pravilo: Super Admin **samo** web (N-05/P1) — provjera je i u
 * `ClientTypeGuard` i u evaluatoru prava (dva sloja).
 */
export const AllowedClientTypes = (...clientTypes: ClientType[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOWED_CLIENT_TYPES_KEY, clientTypes);

/** Čita dozvoljene tipove klijenta za rutu. */
export function allowedClientTypesForRoute(
  reflector: Reflector,
  context: ExecutionContext,
): readonly ClientType[] | undefined {
  return reflector.getAllAndOverride<readonly ClientType[] | undefined>(ALLOWED_CLIENT_TYPES_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}

// -----------------------------------------------------------------------------
//  @Audit (koristi AuditInterceptor — chunk C)
// -----------------------------------------------------------------------------

/** Metadata ključ za audit. */
export const AUDIT_METADATA_KEY = 'vfm:audit';

export interface AuditMetadata {
  readonly action: AuditAction;
  readonly severity: AuditSeverity;
  /** Naziv resursa za audit log (npr. `Vehicle`, `Role`). */
  readonly resource?: string;
  /** Da li se bilježi before/after diff (default `true` za UPDATE). */
  readonly diff?: boolean;
}

/**
 * Označava handler za audit (sve značajne akcije moraju biti auditovane —
 * docs/05 §9). `SECURITY` severity je rezervisan za sigurnosne događaje.
 */
export const Audit = (
  action: AuditAction,
  options: { severity?: AuditSeverity; resource?: string; diff?: boolean } = {},
): MethodDecorator & ClassDecorator =>
  SetMetadata(AUDIT_METADATA_KEY, {
    action,
    severity: options.severity ?? 'INFO',
    resource: options.resource,
    diff: options.diff,
  } satisfies AuditMetadata);

/** Čita audit metadata s handler-a. */
export function auditMetadataFor(reflector: Reflector, context: ExecutionContext): AuditMetadata | undefined {
  return reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_METADATA_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}

// -----------------------------------------------------------------------------
//  @CurrentUser
// -----------------------------------------------------------------------------

/**
 * Ubacuje autentificiranog korisnika (ili jedno njegovo polje) u handler.
 *
 * ```ts
 * @Get('me')
 * me(@CurrentUser() user: AuthenticatedUser) { … }
 *
 * @Get('mine')
 * mine(@CurrentUser('id') userId: string) { … }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<VfmRequest>();
    const user = request.user;
    if (!user) return undefined;
    return field === undefined ? user : user[field];
  },
);
