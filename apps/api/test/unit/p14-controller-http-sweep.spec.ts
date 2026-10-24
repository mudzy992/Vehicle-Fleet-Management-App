import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import type { INestApplication, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  defaultGrantsForRole,
  evaluateEffectivePermissions,
  type RoleCode,
} from '@vfm/shared';
import { REQUIRED_PERMISSIONS_KEY, IS_PUBLIC_KEY } from '../../src/common/decorators/auth.decorators.js';
import type { RequiredPermissionsMetadata } from '../../src/common/decorators/auth.decorators.js';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { AttachmentsController } from '../../src/modules/attachments/attachments.controller.js';
import { AuditLogController } from '../../src/modules/audit-logs/audit-log.controller.js';
import { AuthController } from '../../src/modules/auth/auth.controller.js';
import { DriversController } from '../../src/modules/drivers/drivers.controller.js';
import { FormMigrationsController } from '../../src/modules/form-migrations/form-migrations.controller.js';
import { FormSchemasController } from '../../src/modules/form-schemas/form-schemas.controller.js';
import { InsurancesController } from '../../src/modules/insurances/insurances.controller.js';
import { NotificationsController } from '../../src/modules/notifications/notifications.controller.js';
import { RegistrationsController } from '../../src/modules/registrations/registrations.controller.js';
import { RemindersController } from '../../src/modules/reminders/reminders.controller.js';
import { PermissionsController, RolesController } from '../../src/modules/roles/roles.controller.js';
import { ServiceItemsController } from '../../src/modules/services/service-items.controller.js';
import { ServicesController } from '../../src/modules/services/services.controller.js';
import { TaskTypesController } from '../../src/modules/task-types/task-types.controller.js';
import { TasksController } from '../../src/modules/tasks/tasks.controller.js';
import { TireInstallationsController } from '../../src/modules/tires/tire-installations.controller.js';
import { TireSetsController } from '../../src/modules/tires/tires.controller.js';
import { UsersController } from '../../src/modules/users/users.controller.js';
import { VehiclesController } from '../../src/modules/vehicles/vehicles.controller.js';
import { HealthController } from '../../src/health/health.controller.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const CONTROLLERS: readonly Type[] = [
  AttachmentsController,
  AuditLogController,
  AuthController,
  DriversController,
  FormMigrationsController,
  FormSchemasController,
  InsurancesController,
  NotificationsController,
  RegistrationsController,
  RemindersController,
  RolesController,
  PermissionsController,
  ServiceItemsController,
  ServicesController,
  TaskTypesController,
  TasksController,
  TireInstallationsController,
  TireSetsController,
  UsersController,
  VehiclesController,
  HealthController,
];
const ROLES: readonly RoleCode[] = ['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK'];
const CONTROLLER_DIRS = [resolve(process.cwd(), 'src/modules'), resolve(process.cwd(), 'src/health')];
const HTTP_METHODS: Readonly<Record<number, string>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

function discoveredControllerNames(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return discoveredControllerNames(file);
    if (!entry.isFile() || !entry.name.endsWith('.controller.ts')) return [];
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    return source.statements.flatMap((statement) =>
      ts.isClassDeclaration(statement) && statement.name?.text.endsWith('Controller')
        ? [statement.name.text]
        : [],
    );
  });
}

interface ProtectedRoute {
  readonly name: string;
  readonly path: string;
  readonly method: string;
  readonly metadata: RequiredPermissionsMetadata;
}

function controllerRoutes(): ProtectedRoute[] {
  const routes: ProtectedRoute[] = [];
  for (const controller of CONTROLLERS) {
    if (typeof controller !== 'function') throw new Error(`Invalid controller import at index ${CONTROLLERS.indexOf(controller)}: ${CONTROLLERS.map((item) => item?.name ?? 'undefined').join(', ')}`);
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string | { path?: string } | undefined;
    const basePath = typeof base === 'string' ? base : (base?.path ?? '');
    const classMetadata = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller) as
      | RequiredPermissionsMetadata
      | undefined;
    for (const methodName of Object.getOwnPropertyNames(controller.prototype)) {
      if (methodName === 'constructor') continue;
      const handler = (controller.prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (method === undefined || HTTP_METHODS[method] === undefined) continue;
      if (Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true) continue;
      const metadata =
        (Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler) as RequiredPermissionsMetadata | undefined) ??
        classMetadata;
      if (!metadata?.permissions?.length) continue; // auth session-only routes are tested by auth guard specs
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const fullPath = [basePath, path ?? '']
        .filter(Boolean)
        .join('/')
        .split('/')
        .map((segment) => (segment.startsWith(':') ? `p14-${segment.slice(1).replaceAll('?', '')}` : segment))
        .filter(Boolean)
        .join('/');
      routes.push({
        name: `${controller.name}.${methodName}`,
        path: `/${fullPath}`,
        method: HTTP_METHODS[method],
        metadata,
      });
    }
  }
  return routes;
}

function actorFor(role: RoleCode): AuthenticatedUser {
  return {
    id: `p14-${role.toLowerCase()}`,
    roles: [role],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'p14-controller-sweep',
    jti: 'p14-controller-sweep',
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

function deniedByMetadata(route: ProtectedRoute, role: RoleCode): boolean {
  const permissions = actorFor(role).permissions!;
  const allowed = (permission: string) => {
    const scope = permissions.permissions.get(permission);
    return scope === 'ALL' || scope === route.metadata.scope;
  };
  return route.metadata.mode === 'ANY'
    ? !route.metadata.permissions.some(allowed)
    : !route.metadata.permissions.every(allowed);
}

describe('P14 — HTTP sweep nad stvarnim kontrolerima', () => {
  let app: INestApplication;
  let baseUrl: string;
  let handlerCalls = 0;
  const routes = controllerRoutes();
  const fakeDependency = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'then') return undefined;
        return (..._args: unknown[]) => {
          handlerCalls += 1;
          return undefined;
        };
      },
    },
  );

  beforeAll(async () => {
    const dependencies = new Set<Type<unknown>>();
    for (const controller of CONTROLLERS) {
      const types = (Reflect.getMetadata('design:paramtypes', controller) as Type<unknown>[] | undefined) ?? [];
      for (const dependency of types) if (dependency && dependency !== Object) dependencies.add(dependency);
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [...CONTROLLERS],
      providers: [
        ...[...dependencies].map((provide) => ({ provide, useValue: fakeDependency })),
        Reflector,
        PermissionsGuard,
        {
          provide: PermissionsService,
          useValue: {
            snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
            currentPermissionsVersion: vi.fn(async () => 0),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(
      (
        request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser },
        _response: unknown,
        next: () => void,
      ) => {
        const rawRole = request.headers['x-p14-role'];
        const role = Array.isArray(rawRole) ? rawRole[0] : rawRole;
        if (role && ROLES.includes(role as RoleCode)) request.user = actorFor(role as RoleCode);
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

  it('svaka stvarna zaštićena ruta odbija svaku sistemsku ulogu bez potrebne permisije prije handlera', async () => {
    expect([...CONTROLLERS.map((controller) => controller.name)].sort()).toEqual(
      discoveredControllerNames(CONTROLLER_DIRS[0]!).concat(discoveredControllerNames(CONTROLLER_DIRS[1]!)).sort(),
    );
    expect(routes.length).toBeGreaterThan(100);
    for (const route of routes) {
      for (const role of ROLES.filter((candidate) => deniedByMetadata(route, candidate))) {
        handlerCalls = 0;
        const response = await fetch(`${baseUrl}${route.path}`, {
          method: route.method,
          headers: { 'x-p14-role': role },
        });
        expect(response.status, `${route.method} ${route.path} (${route.name} / ${role})`).toBe(403);
        const body = (await response.json()) as { error?: { code?: string } };
        expect(body.error?.code, `${route.name} / ${role}`).toBe('PERMISSION_DENIED');
        expect(handlerCalls, `${route.name} / ${role} mora biti odbijen prije handlera`).toBe(0);
      }
    }
  }, 90_000);
});
