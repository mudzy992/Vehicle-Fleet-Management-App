/** Zadaci — jezgra Faze 5: lista, detalj, kreiranje, izmjena, otkazivanje i reopen. */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  cancelTaskSchema,
  createTaskSchema,
  reopenTaskSchema,
  taskIdSchema,
  taskListQuerySchema,
  updateTaskSchema,
  type CancelTaskInput,
  type CreateTaskInput,
  type ReopenTaskInput,
  type TaskListQuery,
  type UpdateTaskInput,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import {
  Audit,
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { TasksService, type TaskActorContext } from './tasks.service.js';

function actorContext(
  actor: AuthenticatedUser | undefined,
  request: VfmRequest,
): TaskActorContext | undefined {
  if (!actor) return undefined;
  return {
    id: actor.id,
    roles: actor.roles,
    clientType: actor.clientType,
    requestId: request.id ?? null,
    ipAddress: request.ip ?? null,
  };
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequireAnyPermission('task:view', 'task:view_all')
  list(
    @Query(new ZodValidationPipe(taskListQuerySchema, 'query')) query: TaskListQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    return this.tasks.list(query, actorContext(actor, request));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('task:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'Task' })
  async create(
    @Body(new ZodValidationPipe(createTaskSchema, 'body')) input: CreateTaskInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.create(input, actorContext(actor, request));
    AuditContext.from(request)
      .setEntityId(result.data.id)
      .setAfter(result.after)
      .setResource('Task')
      .set('code', result.data.code)
      .set('status', result.data.status)
      .set('taskTypeCode', result.data.taskTypeCode);
    return result.data;
  }

  @Get(':id')
  @RequireAnyPermission('task:view', 'task:view_all')
  get(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    return this.tasks.get(id, actorContext(actor, request));
  }

  @Patch(':id')
  @RequirePermissions('task:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'Task' })
  async update(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema, 'body')) input: UpdateTaskInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.update(id, input, actorContext(actor, request));
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('Task')
      .set('code', result.data.code)
      .set('status', result.data.status);
    return result.data;
  }

  @Post(':id/cancel')
  @RequirePermissions('task:cancel')
  @Audit('CANCEL', { severity: 'WARN', resource: 'Task' })
  async cancel(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(cancelTaskSchema, 'body')) input: CancelTaskInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.cancel(id, input, actorContext(actor, request));
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('Task')
      .set('code', result.data.code)
      .set('status', result.data.status)
      .set('reason', input.reason);
    return result.data;
  }

  @Post(':id/reopen')
  @RequirePermissions('task:reopen')
  @Audit('REOPEN', { severity: 'WARN', resource: 'Task' })
  async reopen(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(reopenTaskSchema, 'body')) input: ReopenTaskInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.reopen(id, input, actorContext(actor, request));
    const audit = AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('Task')
      .set('code', result.data.code)
      .set('status', result.data.status);
    if (input.reason) audit.set('reason', input.reason);
    return result.data;
  }
}
