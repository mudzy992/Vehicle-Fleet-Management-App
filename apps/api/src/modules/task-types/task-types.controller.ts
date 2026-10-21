/** Vrste zadataka i zahtjevi završetka — konfiguracija Faze 5. */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  archiveTaskTypeSchema,
  createTaskTypeSchema,
  replaceTaskCompletionRequirementsSchema,
  taskTypeIdSchema,
  taskTypeListQuerySchema,
  updateTaskTypeSchema,
  type ArchiveTaskTypeInput,
  type CreateTaskTypeInput,
  type ReplaceTaskCompletionRequirementsInput,
  type TaskTypeListQuery,
  type UpdateTaskTypeInput,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { TaskTypesService } from './task-types.service.js';

@Controller('task-types')
export class TaskTypesController {
  constructor(private readonly taskTypes: TaskTypesService) {}

  @Get()
  @RequirePermissions('task_type:view')
  list(@Query(new ZodValidationPipe(taskTypeListQuerySchema, 'query')) query: TaskTypeListQuery) {
    return this.taskTypes.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('task_type:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'TaskType' })
  async create(
    @Body(new ZodValidationPipe(createTaskTypeSchema, 'body')) input: CreateTaskTypeInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ) {
    const result = await this.taskTypes.create(input, actor?.id);
    AuditContext.from(request)
      .setEntityId(result.data.id)
      .setAfter(result.after)
      .setResource('TaskType')
      .set('code', result.data.code);
    return result.data;
  }

  @Get(':id')
  @RequirePermissions('task_type:view')
  get(@Param('id', new ZodValidationPipe(taskTypeIdSchema, 'params')) id: string) {
    return this.taskTypes.get(id);
  }

  @Patch(':id')
  @RequirePermissions('task_type:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'TaskType' })
  async update(
    @Param('id', new ZodValidationPipe(taskTypeIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateTaskTypeSchema, 'body')) input: UpdateTaskTypeInput,
    @Req() request: VfmRequest,
  ) {
    const result = await this.taskTypes.update(id, input);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('TaskType')
      .set('code', result.data.code);
    return result.data;
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('task_type:archive')
  @Audit('ARCHIVE', { severity: 'WARN', resource: 'TaskType' })
  async archive(
    @Param('id', new ZodValidationPipe(taskTypeIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(archiveTaskTypeSchema, 'body', { allowEmpty: true }))
    input: ArchiveTaskTypeInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const result = await this.taskTypes.archive(id, input, actor?.id);
    const audit = AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('TaskType')
      .set('code', result.data.code)
      .set('archivedAt', result.data.archivedAt);
    if (input.reason) audit.set('reason', input.reason);
  }

  @Get(':id/completion-requirements')
  @RequirePermissions('task_type:view')
  listCompletionRequirements(@Param('id', new ZodValidationPipe(taskTypeIdSchema, 'params')) id: string) {
    return this.taskTypes.listCompletionRequirements(id);
  }

  @Put(':id/completion-requirements')
  @RequirePermissions('task_type:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'TaskType' })
  async replaceCompletionRequirements(
    @Param('id', new ZodValidationPipe(taskTypeIdSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(replaceTaskCompletionRequirementsSchema, 'body'))
    input: ReplaceTaskCompletionRequirementsInput,
    @Req() request: VfmRequest,
  ) {
    const result = await this.taskTypes.replaceCompletionRequirements(id, input);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(result.before)
      .setAfter(result.after)
      .setResource('TaskType')
      .set('completionRequirementsChanged', true)
      .set('requirementCount', result.data.requirements.length);
    return result.data;
  }
}
