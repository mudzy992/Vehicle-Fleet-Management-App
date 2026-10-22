/** Zadaci — jezgra Faze 5, atomsko preuzimanje i završetak zadataka. */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  assignTaskSchema,
  createTaskCommentSchema,
  taskCommentListQuerySchema,
  cancelTaskSchema,
  claimTaskSchema,
  completeTaskSchema,
  createTaskSchema,
  reopenTaskSchema,
  releaseTaskSchema,
  taskAvailableQuerySchema,
  taskIdSchema,
  taskListQuerySchema,
  updateTaskSchema,
  type AssignTaskInput,
  type CreateTaskCommentInput,
  type TaskCommentListQuery,
  type CancelTaskInput,
  type ClaimTaskInput,
  type CompleteTaskInput,
  type CreateTaskInput,
  type ReopenTaskInput,
  type ReleaseTaskInput,
  type TaskAvailableQuery,
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

  @Get('available')
  @RequirePermissions('task:claim')
  available(
    @Query(new ZodValidationPipe(taskAvailableQuerySchema, 'query')) query: TaskAvailableQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    return this.tasks.available(query, actorContext(actor, request));
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

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('task:claim')
  @Audit('CLAIM', { severity: 'INFO', resource: 'Task' })
  async claim(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(claimTaskSchema, 'body', { allowEmpty: true })) input: ClaimTaskInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.claim(id, input, actorContext(actor, request));
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('Task')
      .set('code', result.data.code)
      .set('status', result.data.status)
      .set('assigneeUserId', result.data.assigneeUserId)
      .set('claimedAt', result.data.claimedAt);
    return result.data;
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission('task:complete', 'task:complete_override')
  @Audit('COMPLETE', { severity: 'INFO', resource: 'Task' })
  async complete(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(completeTaskSchema, 'body')) input: CompleteTaskInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.complete(id, input, actorContext(actor, request));
    const audit = AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('Task')
      .set('code', result.data.code)
      .set('status', result.data.status)
      .set('assigneeUserId', result.data.assigneeUserId)
      .set('completedById', result.data.completedById)
      .set('completedAt', result.data.completedAt)
      .set('durationMinutes', result.data.durationMinutes)
      .set('override', result.meta?.['override'] ?? false);
    if (input.reason) audit.set('reason', input.reason);
    if (result.meta?.['commentId']) audit.set('commentId', result.meta['commentId']);
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

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('task:release')
  @Audit('RELEASE', { severity: 'WARN', resource: 'Task' })
  async release(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(releaseTaskSchema, 'body')) input: ReleaseTaskInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.release(id, input, actorContext(actor, request));
    const audit = AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('Task')
      .set('code', result.data.code)
      .set('status', result.data.status)
      .set('previousAssigneeUserId', result.meta?.['previousAssigneeUserId'] ?? null)
      .set('assigneeUserId', result.data.assigneeUserId);
    if (input.reason) audit.set('reason', input.reason);
    return result.data;
  }

  @Get(':id/comments')
  @RequireAnyPermission('task:view', 'task:view_all')
  listComments(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Query(new ZodValidationPipe(taskCommentListQuerySchema, 'query')) query: TaskCommentListQuery,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    return this.tasks.listComments(id, query, actorContext(actor, request));
  }

  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('task:comment')
  @Audit('CREATE', { severity: 'INFO', resource: 'TaskComment' })
  async addComment(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(createTaskCommentSchema, 'body')) input: CreateTaskCommentInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.addComment(id, input, actorContext(actor, request));
    AuditContext.from(request).setEntityId(result.id).setResource('TaskComment').set('taskId', id);
    return result;
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('task:assign')
  @Audit('UPDATE', { severity: 'WARN', resource: 'Task' })
  async assign(
    @Param('id', new ZodValidationPipe(taskIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(assignTaskSchema, 'body')) input: AssignTaskInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.tasks.assign(id, input, actorContext(actor, request));
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('Task')
      .set('code', result.data.code)
      .set('status', result.data.status)
      .set('assignMode', result.data.assignMode)
      .set('assigneeUserId', result.data.assigneeUserId);
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
