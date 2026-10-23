/**
 * Guard-level HTTP sweep: čita autorizacijske dekoratore stvarnih kontrolera,
 * pa montira privremene Nest rute s istim metadata podacima. Provjerava 200/403
 * i da odbijena uloga ne ulazi u handler. Ne pokreće produkcijske kontrolere,
 * servise ni resource-scope provjere; puni API E2E sweep ostaje poseban korak.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ts from 'typescript';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSION_SCOPE_VALUES,
  defaultGrantsForRole,
  evaluateEffectivePermissions,
  hasPermission,
  type Permission,
  type PermissionScope,
  type RoleCode,
} from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { REQUIRED_PERMISSIONS_KEY } from '../../src/common/decorators/auth.decorators.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

interface RouteAuthorization {
  readonly controller: string;
  readonly method: string;
  readonly metadata: {
    readonly permissions: readonly Permission[];
    readonly mode: 'ALL' | 'ANY';
    readonly scope: PermissionScope;
  };
}

const CONTROLLER_DIRS = [resolve(process.cwd(), 'src/modules'), resolve(process.cwd(), 'src/health')];
const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options']);
const AUTH_DECORATORS = new Set(['RequirePermissions', 'RequireAnyPermission', 'RequireScope']);
const ROLES: readonly RoleCode[] = ['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decoratorName(decorator: ts.Decorator): string | null {
  const expression = decorator.expression;
  const target = ts.isCallExpression(expression) ? expression.expression : expression;
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target)) return target.name.text;
  return null;
}

function authorizationOf(decorator: ts.Decorator): RouteAuthorization['metadata'] | null {
  const name = decoratorName(decorator);
  if (!name || !AUTH_DECORATORS.has(name)) return null;
  const expression = decorator.expression;
  if (!ts.isCallExpression(expression)) return null;
  const args = expression.arguments;
  const permissionArgs = name === 'RequireScope' ? args.slice(0, 1) : args;
  if (permissionArgs.length === 0 || !permissionArgs.every(ts.isStringLiteralLike)) return null;
  const permissions = permissionArgs.map((argument) => argument.text as Permission);
  if (!permissions.every((permission) => ALL_PERMISSIONS.includes(permission))) return null;
  const scopeArgument = name === 'RequireScope' ? args[1] : undefined;
  if (scopeArgument && !ts.isStringLiteralLike(scopeArgument)) return null;
  const scope = (scopeArgument?.text ?? 'OWN') as PermissionScope;
  if (!PERMISSION_SCOPE_VALUES.includes(scope)) return null;
  if (name === 'RequireScope' && args.length !== 2) return null;
  return { permissions, mode: name === 'RequireAnyPermission' ? 'ANY' : 'ALL', scope };
}

function routeAuthorizations(): RouteAuthorization[] {
  const routes: RouteAuthorization[] = [];
  for (const file of CONTROLLER_DIRS.flatMap(sourceFiles)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name?.text.endsWith('Controller')) continue;
      const classAuthorization = decoratorsOf(statement).map(authorizationOf).find(Boolean);
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
        const methodDecorators = decoratorsOf(member);
        const isRoute = methodDecorators.some((decorator) => {
          const name = decoratorName(decorator);
          return name !== null && ROUTE_DECORATORS.has(name);
        });
        if (!isRoute) continue;
        const metadata = methodDecorators.map(authorizationOf).find(Boolean) ?? classAuthorization;
        if (metadata) routes.push({ controller: statement.name.text, method: member.name.text, metadata });
      }
    }
  }
  return routes;
}

function userFor(role: RoleCode): AuthenticatedUser {
  return {
    id: `test-${role.toLowerCase()}`,
    roles: [role],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'p14-session',
    jti: 'p14-token',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin: role === 'SUPER_ADMIN',
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({
      roles: [role],
      grants: defaultGrantsForRole(role),
      clientType: 'WEB',
    }),
  };
}

function expectedStatus(route: RouteAuthorization, user: AuthenticatedUser): number {
  const permissions = user.permissions!;
  const satisfies = (permission: Permission) => hasPermission(permissions, permission, route.metadata.scope);
  const allowed =
    route.metadata.mode === 'ANY'
      ? route.metadata.permissions.some(satisfies)
      : route.metadata.permissions.every(satisfies);
  return allowed ? 200 : 403;
}

describe('P14 — HTTP provjera PermissionsGuard-a nad deklaracijama ruta', () => {
  let app: INestApplication;
  let baseUrl: string;
  const reachedHandlers: string[] = [];
  const routes = routeAuthorizations();

  beforeAll(async () => {
    class AuthorizationSweepController {}
    Controller('__p14_guard_sweep')(AuthorizationSweepController);

    routes.forEach((route, index) => {
      const methodName = `route${index}`;
      const routeKey = `${route.controller}.${route.method}`;
      Object.defineProperty(AuthorizationSweepController.prototype, methodName, {
        configurable: true,
        value: () => {
          reachedHandlers.push(routeKey);
          return { reached: true };
        },
      });
      const descriptor = Object.getOwnPropertyDescriptor(AuthorizationSweepController.prototype, methodName)!;
      Get(`r${index}`)(AuthorizationSweepController.prototype, methodName, descriptor);
      Reflect.defineMetadata(REQUIRED_PERMISSIONS_KEY, route.metadata, descriptor.value);
    });

    const permissionService = {
      snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
      currentPermissionsVersion: vi.fn(async () => 0),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthorizationSweepController],
      providers: [PermissionsGuard, Reflector, { provide: PermissionsService, useValue: permissionService }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(
      (
        request: { headers: Record<string, string | undefined>; user?: AuthenticatedUser },
        _response: unknown,
        next: () => void,
      ) => {
        const role = request.headers['x-sweep-role'] as RoleCode | undefined;
        if (role) request.user = userFor(role);
        next();
      },
    );
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('svaka ruta vraća očekivani HTTP status za svaku sistemsku ulogu', async () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const [index, route] of routes.entries()) {
      for (const role of ROLES) {
        const user = userFor(role);
        const expected = expectedStatus(route, user);
        const routeKey = `${route.controller}.${route.method}`;
        const hitsBefore = reachedHandlers.filter((handler) => handler === routeKey).length;
        const response = await fetch(`${baseUrl}/__p14_guard_sweep/r${index}`, {
          headers: { 'x-sweep-role': role },
        });
        expect(response.status, `${route.controller}.${route.method} / ${role}`).toBe(expected);
        if (expected === 403) {
          const body = (await response.json()) as { error?: { code?: string } };
          expect(body.error?.code, `${route.controller}.${route.method} / ${role}`).toBe('PERMISSION_DENIED');
          expect(reachedHandlers.filter((handler) => handler === routeKey)).toHaveLength(hitsBefore);
        } else {
          expect(reachedHandlers.filter((handler) => handler === routeKey)).toHaveLength(hitsBefore + 1);
        }
      }
    }
  }, 60_000);
});
