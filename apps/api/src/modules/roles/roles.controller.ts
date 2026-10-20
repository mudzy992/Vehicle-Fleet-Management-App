/**
 * `RolesController` + `PermissionsController` — `/api/v1/roles/*` i
 * `/api/v1/permissions/*` (docs/07 §2.3).
 *
 * | Ruta                       | Permisija                 | Audit                  |
 * | -------------------------- | ------------------------- | ---------------------- |
 * | `GET /roles`               | `role:view`               | —                      |
 * | `GET /roles/matrix`        | `role:view`               | —                      |
 * | `PUT /roles/matrix`        | `role:manage_permissions` | `PERMISSION_CHANGE` (SECURITY, diff) |
 * | `POST /roles`              | `role:create`             | `CREATE` + diff        |
 * | `GET /roles/:id`           | `role:view`               | —                      |
 * | `PATCH /roles/:id`         | `role:update`             | `UPDATE` + diff        |
 * | `POST /roles/:id/archive`  | `role:archive`            | `ARCHIVE` + diff       |
 * | `GET /permissions`         | `permission:view`         | —                      |
 * | `POST /permissions/sync`   | `permission:catalog_sync` | `UPDATE` (SECURITY)    |
 *
 * ⚠️ Redoslijed ruta je bitan: `matrix` mora biti deklarisan **prije** `:id`,
 * inače Nest tretira `matrix` kao UUID parametar (i vrati 400 iz pipe-a).
 *
 * Audit diff: servis vraća `before`/`after` u istom obliku, a kontroler ih
 * upisuje u `AuditContext` → `AuditInterceptor` gradi diff i piše `AuditLog`
 * (za matricu: `"<ROLE_CODE>.<permission>" → scope` samo za dirane permisije).
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type {
  ArchiveRoleInput,
  CreateRoleInput,
  PermissionCatalogGroup,
  PermissionMatrixResponse,
  PermissionSyncResult,
  RoleDetail,
  RoleMatrixUpdateInput,
  RoleMatrixUpdateResult,
  RoleSummary,
  UpdateRoleInput,
} from '@vfm/shared/schemas';
import {
  archiveRoleSchema,
  createRoleSchema,
  roleIdSchema,
  roleMatrixUpdateSchema,
  updateRoleSchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { RolesService } from './roles.service.js';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('role:view')
  list(): Promise<RoleSummary[]> {
    return this.roles.list();
  }

  /** Matrica za editor (katalog + uloge + grantovi u jednom odgovoru). */
  @Get('matrix')
  @RequirePermissions('role:view')
  matrix(): Promise<PermissionMatrixResponse> {
    return this.roles.matrix();
  }

  /** P2: bulk izmjena matrice u jednoj transakciji + bump verzije + audit diff. */
  @Put('matrix')
  @RequirePermissions('role:manage_permissions')
  @Audit('PERMISSION_CHANGE', { severity: 'SECURITY', resource: 'Role' })
  async updateMatrix(
    @Body(new ZodValidationPipe(roleMatrixUpdateSchema, 'body')) input: RoleMatrixUpdateInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<RoleMatrixUpdateResult> {
    const outcome = await this.roles.updateMatrix(input, user?.id);

    AuditContext.from(request)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('Role')
      .set('affectedRoles', outcome.data.affectedRoles)
      .set('added', outcome.data.added)
      .set('removed', outcome.data.removed)
      .set('scopeChanged', outcome.data.scopeChanged)
      .set('permissionsVersion', outcome.data.permissionsVersion);

    return outcome.data;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('role:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'Role' })
  async create(
    @Body(new ZodValidationPipe(createRoleSchema, 'body')) input: CreateRoleInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<RoleDetail> {
    const outcome = await this.roles.create(input, user?.id);

    AuditContext.from(request).setAfter(outcome.after).setEntityId(outcome.data.id).setResource('Role');
    return outcome.data;
  }

  @Get(':id')
  @RequirePermissions('role:view')
  get(@Param('id', new ZodValidationPipe(roleIdSchema, 'params')) id: string): Promise<RoleDetail> {
    return this.roles.get(id);
  }

  @Patch(':id')
  @RequirePermissions('role:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'Role' })
  async update(
    @Param('id', new ZodValidationPipe(roleIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema, 'body')) input: UpdateRoleInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<RoleDetail> {
    const outcome = await this.roles.update(id, input, user?.id);

    AuditContext.from(request)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setEntityId(id)
      .setResource('Role')
      // Promjena `allowedClientTypes` je sigurnosno relevantna (N-05) → vidljivo
      // u Audit logu bez kopanja po diff-u.
      .set('allowedClientTypesChanged', input.allowedClientTypes !== undefined);

    return outcome.data;
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('role:archive')
  @Audit('ARCHIVE', { severity: 'INFO', resource: 'Role' })
  async archive(
    @Param('id', new ZodValidationPipe(roleIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(archiveRoleSchema, 'body', { allowEmpty: true })) input: ArchiveRoleInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.roles.archive(id, input, user?.id);

    AuditContext.from(request)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setEntityId(id)
      .setResource('Role')
      .set('archivedAt', outcome.data.archivedAt);
  }
}

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly roles: RolesService) {}

  /** Katalog iz koda + status u bazi (`inDatabase` = da li je sync pokrenut). */
  @Get()
  @RequirePermissions('permission:view')
  catalog(): Promise<PermissionCatalogGroup[]> {
    return this.roles.catalog();
  }

  /** Deploy korak: usklađuje `Permission` redove s `PERMISSION_CATALOG`. */
  @Post('sync')
  @RequirePermissions('permission:catalog_sync')
  @Audit('UPDATE', { severity: 'SECURITY', resource: 'Permission' })
  async sync(@Req() request: VfmRequest): Promise<PermissionSyncResult> {
    const result = await this.roles.syncCatalog();

    AuditContext.from(request)
      .setResource('Permission')
      .set('created', result.created)
      .set('updated', result.updated)
      .set('total', result.total);

    return result;
  }
}
