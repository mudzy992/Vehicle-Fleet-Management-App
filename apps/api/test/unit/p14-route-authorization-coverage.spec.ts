/**
 * Statička P14 zaštita: svaka HTTP ruta API kontrolera mora deklarisati dozvolu/scope,
 * biti eksplicitno javna ili biti jedna od samoposlužnih auth ruta koje štiti
 * globalni JWT guard. Test ne uvozi kontrolere, pa ne zavisi od Prisma Clienta.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
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
import { missingFor } from '../../src/common/guards/permissions.guard.js';
import type { RequiredPermissionsMetadata } from '../../src/common/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const CONTROLLER_DIRS = [resolve(process.cwd(), 'src/modules'), resolve(process.cwd(), 'src/health')];
const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options']);
const AUTH_DECORATORS = new Set(['Public', 'RequirePermissions', 'RequireAnyPermission', 'RequireScope']);
const PUBLIC_ROUTES = new Set([
  'AuthController.login',
  'AuthController.refresh',
  'AuthController.resetPassword',
  'HealthController.liveness',
  'HealthController.readiness',
  'HealthController.startup',
]);
const SESSION_ONLY_ROUTES = new Set([
  'AuthController.logout',
  'AuthController.me',
  'AuthController.changePassword',
]);

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

function decoratorArguments(decorator: ts.Decorator): readonly ts.Expression[] {
  return ts.isCallExpression(decorator.expression) ? decorator.expression.arguments : [];
}

function requiredMetadata(decorator: ts.Decorator): RequiredPermissionsMetadata | null {
  const name = decoratorName(decorator);
  if (name !== 'RequirePermissions' && name !== 'RequireAnyPermission' && name !== 'RequireScope') {
    return null;
  }
  const arguments_ = decoratorArguments(decorator);
  const permissionNodes = name === 'RequireScope' ? arguments_.slice(0, 1) : arguments_;
  if (permissionNodes.length === 0 || !permissionNodes.every(ts.isStringLiteralLike)) return null;
  const permissions = permissionNodes.map((node) => node.text as Permission);
  const scopeNode = name === 'RequireScope' ? arguments_[1] : undefined;
  if (scopeNode && !ts.isStringLiteralLike(scopeNode)) return null;
  return {
    permissions,
    mode: name === 'RequireAnyPermission' ? 'ANY' : 'ALL',
    scope: (scopeNode?.text ?? 'OWN') as PermissionScope,
  };
}

describe('P14 — deklaracije autorizacije kontrolera', () => {
  it('svaka HTTP ruta je zaštićena, eksplicitno javna ili session-only auth ruta', () => {
    const unsecured: string[] = [];
    const discoveredPublic: string[] = [];
    const invalidDeclarations: string[] = [];
    const protectedRoutes: Array<{ route: string; metadata: RequiredPermissionsMetadata }> = [];

    for (const file of CONTROLLER_DIRS.flatMap(sourceFiles)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isClassDeclaration(statement) || !statement.name?.text.endsWith('Controller')) continue;
        const controllerName = statement.name.text;
        const classDecoratorNodes = decoratorsOf(statement);

        for (const member of statement.members) {
          if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
          const methodName = member.name.text;
          const routeDecoratorNodes = decoratorsOf(member);
          const routeDecorators = routeDecoratorNodes.map(decoratorName);
          if (!routeDecorators.some((name) => name !== null && ROUTE_DECORATORS.has(name))) continue;

          const route = `${controllerName}.${methodName}`;
          const allDecoratorNodes = [...classDecoratorNodes, ...routeDecoratorNodes];
          const allDecorators = allDecoratorNodes.map(decoratorName);
          if (allDecorators.includes('Public')) discoveredPublic.push(route);

          const hasAuthorization = allDecorators.some((name) => name !== null && AUTH_DECORATORS.has(name));
          if (!hasAuthorization && !SESSION_ONLY_ROUTES.has(route)) unsecured.push(`${file}:${route}`);

          for (const decorator of allDecoratorNodes) {
            const name = decoratorName(decorator);
            if (name !== 'RequirePermissions' && name !== 'RequireAnyPermission' && name !== 'RequireScope') {
              continue;
            }
            const arguments_ = decoratorArguments(decorator);
            const requiredCount = name === 'RequireScope' ? 2 : arguments_.length;
            const permissionNodes = name === 'RequireScope' ? arguments_.slice(0, 1) : arguments_;
            const permissions = permissionNodes.filter(ts.isStringLiteralLike).map((node) => node.text);
            if (permissions.length !== permissionNodes.length || permissions.length === 0) {
              invalidDeclarations.push(`${file}:${route} (${name}: permisija nije literalni string)`);
            } else {
              for (const permission of permissions) {
                if (!ALL_PERMISSIONS.includes(permission as (typeof ALL_PERMISSIONS)[number])) {
                  invalidDeclarations.push(`${file}:${route} (${name}: nepoznata permisija ${permission})`);
                }
              }
            }
            if (name === 'RequireScope') {
              const scope = arguments_[1];
              if (!scope || !ts.isStringLiteralLike(scope)) {
                invalidDeclarations.push(`${file}:${route} (RequireScope: opseg nije literalni string)`);
              } else if (
                !PERMISSION_SCOPE_VALUES.includes(scope.text as (typeof PERMISSION_SCOPE_VALUES)[number])
              ) {
                invalidDeclarations.push(`${file}:${route} (RequireScope: nepoznat opseg ${scope.text})`);
              }
            }
            if (name === 'RequireScope' && arguments_.length !== requiredCount) {
              invalidDeclarations.push(`${file}:${route} (RequireScope: očekivana su dva argumenta)`);
            }
          }

          if (!allDecorators.includes('Public')) {
            const methodMetadata = routeDecoratorNodes.map(requiredMetadata).find(Boolean);
            const classMetadata = classDecoratorNodes.map(requiredMetadata).find(Boolean);
            const metadata = methodMetadata ?? classMetadata;
            if (metadata) protectedRoutes.push({ route, metadata });
          }
        }
      }
    }

    expect(unsecured, 'Pronađene HTTP rute bez deklarisane autorizacije').toEqual([]);
    expect(discoveredPublic.sort(), 'Promijenjen je skup namjerno javnih ruta').toEqual(
      [...PUBLIC_ROUTES].sort(),
    );
    expect(invalidDeclarations, 'Dekoratori s neispravnim permisijama/opsezima').toEqual([]);
    expect(protectedRoutes.length).toBeGreaterThan(0);

    const roles: readonly RoleCode[] = ['SUPER_ADMIN', 'ADMINISTRATOR', 'OBICNI_KORISNIK'];
    const effectiveByRole = new Map(
      roles.map((role) => [
        role,
        evaluateEffectivePermissions({
          roles: [role],
          grants: defaultGrantsForRole(role),
          clientType: 'WEB',
        }),
      ]),
    );

    for (const { route, metadata } of protectedRoutes) {
      for (const role of roles) {
        const effective = effectiveByRole.get(role)!;
        const actor = { roles: [role], permissions: effective } as unknown as AuthenticatedUser;
        const expectedMissing =
          metadata.mode === 'ANY'
            ? metadata.permissions.some((permission) => hasPermission(effective, permission, metadata.scope))
              ? []
              : metadata.permissions
            : metadata.permissions.filter(
                (permission) => !hasPermission(effective, permission, metadata.scope),
              );
        expect(missingFor(actor, metadata), `${route} / ${role}`).toEqual(expectedMissing);
      }
    }

    expect(
      hasPermission(effectiveByRole.get('OBICNI_KORISNIK')!, 'vehicle:view', 'OWN'),
      'vehicle:view:ALL mora i dalje zadovoljiti scope OWN',
    ).toBe(true);
  });
});
