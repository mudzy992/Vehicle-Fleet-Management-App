/**
 * Statička P14 zaštita: svaka HTTP ruta modula mora deklarisati dozvolu/scope,
 * biti eksplicitno javna ili biti jedna od samoposlužnih auth ruta koje štiti
 * globalni JWT guard. Test ne uvozi kontrolere, pa ne zavisi od Prisma Clienta.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const MODULES_DIR = resolve(process.cwd(), 'src/modules');
const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options']);
const AUTH_DECORATORS = new Set(['Public', 'RequirePermissions', 'RequireAnyPermission', 'RequireScope']);
const PUBLIC_ROUTES = new Set([
  'AuthController.login',
  'AuthController.refresh',
  'AuthController.resetPassword',
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

describe('P14 — deklaracije autorizacije kontrolera', () => {
  it('svaka HTTP ruta je zaštićena, eksplicitno javna ili session-only auth ruta', () => {
    const unsecured: string[] = [];
    const discoveredPublic: string[] = [];

    for (const file of sourceFiles(MODULES_DIR)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isClassDeclaration(statement) || !statement.name?.text.endsWith('Controller')) continue;
        const controllerName = statement.name.text;
        const classDecorators = decoratorsOf(statement).map(decoratorName);

        for (const member of statement.members) {
          if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
          const methodName = member.name.text;
          const routeDecorators = decoratorsOf(member).map(decoratorName);
          if (!routeDecorators.some((name) => name !== null && ROUTE_DECORATORS.has(name))) continue;

          const route = `${controllerName}.${methodName}`;
          const allDecorators = [...classDecorators, ...routeDecorators];
          if (allDecorators.includes('Public')) discoveredPublic.push(route);

          const hasAuthorization = allDecorators.some((name) => name !== null && AUTH_DECORATORS.has(name));
          if (!hasAuthorization && !SESSION_ONLY_ROUTES.has(route)) unsecured.push(`${file}:${route}`);
        }
      }
    }

    expect(unsecured, 'Pronađene HTTP rute bez deklarisane autorizacije').toEqual([]);
    expect(discoveredPublic.sort(), 'Promijenjen je skup namjerno javnih ruta').toEqual(
      [...PUBLIC_ROUTES].sort(),
    );
  });
});
