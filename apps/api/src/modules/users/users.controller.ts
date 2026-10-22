/**
 * `UsersController` — `/api/v1/users/*` (docs/07 §2.2).
 *
 * | Ruta                              | Permisija             | Audit                     |
 * | --------------------------------- | --------------------- | ------------------------- |
 * | `GET /users`                      | `user:view`           | —                         |
 * | `POST /users`                     | `user:create`         | `CREATE` (diff)           |
 * | `GET /users/:id`                  | `user:view` (+`user:view_pii` za PII) | —      |
 * | `PATCH /users/:id`                | `user:update`         | `UPDATE` (diff)           |
 * | `POST /users/:id/archive`         | `user:archive`        | `ARCHIVE` (diff)          |
 * | `DELETE /users/:id`               | `user:delete`         | `DELETE` (CRITICAL)       |
 * | `POST /users/:id/roles`           | `user:assign_role`    | `UPDATE` (SECURITY)       |
 * | `DELETE /users/:id/roles/:roleId` | `user:assign_role`    | `UPDATE` (SECURITY)       |
 * | `POST /users/:id/reset-password`  | `user:reset_password` | `UPDATE` (SECURITY)       |
 * | `POST /users/:id/force-logout`    | `user:force_logout`   | `SECURITY`                |
 *
 * Napomene:
 * - lozinke i tokeni **nikad** ne ulaze u audit: `@Audit({ diff: false })` za
 *   reset, a `DELETE` je anonimizacija (ne fizički `DELETE` — vidi `UsersService`).
 * - `DELETE /users/:id/roles/:roleId` ima `roleId` u putanji, pa se validira
 *   istim `uuidSchema` pipe-om kao i `id`.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type {
  ArchiveUserInput,
  AssignUserRoleInput,
  CreateUserInput,
  CreateUserResult,
  IssuePasswordResetInput,
  PasswordResetIssued,
  UpdateUserInput,
  UserDetail,
  UserListResponse,
} from '@vfm/shared/schemas';
import {
  archiveUserSchema,
  assignUserRoleSchema,
  createUserSchema,
  issuePasswordResetSchema,
  updateUserSchema,
  userListQuerySchema,
  uuidSchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequireScope } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireScope('user:view', 'ALL')
  list(
    @Query(new ZodValidationPipe(userListQuerySchema, 'query')) query: Parameters<UsersService['list']>[0],
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ): Promise<UserListResponse> {
    return this.users.list(query, actor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireScope('user:create', 'ALL')
  @Audit('CREATE', { severity: 'INFO', resource: 'User' })
  async create(
    @Body(new ZodValidationPipe(createUserSchema, 'body')) input: CreateUserInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<CreateUserResult> {
    const result = await this.users.create(input, actor);

    AuditContext.from(request)
      .setEntityId(result.user.id)
      .setResource('User')
      // Privremena lozinka se **ne** upisuje u audit (samo da je izdata).
      .setAfter({
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        status: result.user.status,
        roles: result.user.roles.map((role) => role.code).join(','),
        mustChangePassword: result.mustChangePassword,
      });

    return result;
  }

  @Get(':id')
  @RequireScope('user:view', 'ALL')
  get(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ): Promise<UserDetail> {
    return this.users.get(id, actor);
  }

  @Patch(':id')
  @RequireScope('user:update', 'ALL')
  @Audit('UPDATE', { severity: 'INFO', resource: 'User' })
  async update(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateUserSchema, 'body')) input: UpdateUserInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<UserDetail> {
    const outcome = await this.users.update(id, input, actor);

    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('User')
      .set('statusChanged', outcome.meta?.statusChanged ?? false);

    return outcome.data;
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope('user:archive', 'ALL')
  @Audit('ARCHIVE', { severity: 'SECURITY', resource: 'User' })
  async archive(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(archiveUserSchema, 'body', { allowEmpty: true })) input: ArchiveUserInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.users.archive(id, input, actor);

    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('User')
      .set('revokedSessions', outcome.meta?.revokedSessions ?? 0);
  }

  /**
   * Trajno uklanjanje = **anonimizacija** PII-a (vidi `UsersService.remove`).
   * Super Admin only (`user:delete` nije u default matrici drugih rola).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope('user:delete', 'ALL')
  @Audit('DELETE', { severity: 'CRITICAL', resource: 'User' })
  async remove(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(archiveUserSchema, 'body', { allowEmpty: true })) input: ArchiveUserInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.users.remove(id, input, actor);

    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('User')
      .set('anonymizedAt', outcome.data.anonymizedAt);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @RequireScope('user:assign_role', 'ALL')
  @Audit('UPDATE', { severity: 'SECURITY', resource: 'User' })
  async assignRole(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(assignUserRoleSchema, 'body')) input: AssignUserRoleInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<UserDetail> {
    const outcome = await this.users.assignRole(id, input, actor);

    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('User')
      .set('roleChange', outcome.meta);

    return outcome.data;
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(HttpStatus.OK)
  @RequireScope('user:assign_role', 'ALL')
  @Audit('UPDATE', { severity: 'SECURITY', resource: 'User' })
  async removeRole(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Param('roleId', new ZodValidationPipe(uuidSchema, 'params')) roleId: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<UserDetail> {
    const outcome = await this.users.removeRole(id, roleId, actor);

    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('User')
      .set('roleChange', outcome.meta);

    return outcome.data;
  }

  /** Izdaje jednokratni token (30 min). Token se **ne** upisuje u audit. */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequireScope('user:reset_password', 'ALL')
  @Audit('UPDATE', { severity: 'SECURITY', resource: 'User', diff: false })
  async resetPassword(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(issuePasswordResetSchema, 'body', { allowEmpty: true })) input: IssuePasswordResetInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<PasswordResetIssued> {
    const outcome = await this.users.issuePasswordReset(id, input, actor);

    AuditContext.from(request)
      .setEntityId(id)
      .setResource('User')
      .setAfter({ resetIssuedAt: new Date().toISOString(), expiresAt: outcome.data.expiresAt })
      .set('ttlMinutes', outcome.data.expiresAt);

    return outcome.data;
  }

  @Post(':id/force-logout')
  @HttpCode(HttpStatus.OK)
  @RequireScope('user:force_logout', 'ALL')
  @Audit('SECURITY', { severity: 'SECURITY', resource: 'Session' })
  async forceLogout(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<{ revokedSessions: number; tokenVersion: number }> {
    const outcome = await this.users.forceLogout(id, actor);

    AuditContext.from(request)
      .setEntityId(id)
      .setResource('Session')
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .set('revokedSessions', outcome.data.revokedSessions);

    return outcome.data;
  }
}
