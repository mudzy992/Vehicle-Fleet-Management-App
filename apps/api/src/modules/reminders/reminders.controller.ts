/**
 * `RemindersController` — `/api/v1/reminders` (docs/07 §2.14).
 *
 * | Ruta                             | Permisija                 | Audit               |
 * | -------------------------------- | ------------------------- | ------------------- |
 * | `GET /reminders`                 | `reminder:view`           | —                   |
 * | `POST /reminders/:id/acknowledge`| `reminder:acknowledge`    | `UPDATE`            |
 * | `POST /reminders/:id/snooze`     | `reminder:snooze`         | `UPDATE`            |
 * | `GET /reminders/policies`        | `reminder:manage_policies`| —                   |
 * | `PUT /reminders/policies/:kind`  | `reminder:manage_policies`| `SETTINGS_CHANGE`   |
 * | `POST /reminders/scan`           | `system:run_maintenance`  | `UPDATE` (WARN)     |
 *
 * Skener je idempotentan (`dedupeKey` unique) — ručno pokretanje ne pravi
 * duplikate uz cron u 06:00 (`Europe/Sarajevo`).
 */
import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type {
  ReminderListQuery,
  ReminderListResponse,
  ReminderPolicy,
  ReminderPolicyList,
  ReminderScanResult,
  ScheduledReminder,
  SnoozeReminderInput,
  UpdateReminderPolicyInput,
} from '@vfm/shared/schemas';
import {
  reminderKindSchema,
  reminderListQuerySchema,
  snoozeReminderSchema,
  uuidSchema,
  updateReminderPolicySchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { RemindersService } from './reminders.service.js';

@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  @RequirePermissions('reminder:view')
  list(
    @Query(new ZodValidationPipe(reminderListQuerySchema, 'query')) query: ReminderListQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ReminderListResponse> {
    return this.reminders.list(query, actor);
  }

  @Get('policies')
  @RequirePermissions('reminder:manage_policies')
  listPolicies(): Promise<ReminderPolicyList> {
    return this.reminders.listPolicies();
  }

  @Put('policies/:kind')
  @RequirePermissions('reminder:manage_policies')
  @Audit('SETTINGS_CHANGE', { severity: 'WARN', resource: 'ReminderPolicy' })
  async updatePolicy(
    @Param('kind', new ZodValidationPipe(reminderKindSchema, 'params')) kind: string,
    @Body(new ZodValidationPipe(updateReminderPolicySchema, 'body'))
    input: UpdateReminderPolicyInput,
    @Req() request: VfmRequest,
  ): Promise<ReminderPolicy> {
    const outcome = await this.reminders.updatePolicy(kind, input);
    AuditContext.from(request)
      .setEntityId(outcome.data.id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('ReminderPolicy')
      .set('kind', kind);
    return outcome.data;
  }

  @Post('scan')
  @RequirePermissions('system:run_maintenance')
  @Audit('UPDATE', { severity: 'WARN', resource: 'ScheduledReminder' })
  async scan(@Req() request: VfmRequest): Promise<ReminderScanResult> {
    const result = await this.reminders.scan();
    AuditContext.from(request)
      .setResource('ScheduledReminder')
      .setAfter(result as unknown as Record<string, unknown>);
    return result;
  }

  @Post(':id/acknowledge')
  @RequirePermissions('reminder:acknowledge')
  @Audit('UPDATE', { severity: 'INFO', resource: 'ScheduledReminder' })
  async acknowledge(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<ScheduledReminder> {
    const outcome = await this.reminders.acknowledge(id, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('ScheduledReminder');
    return outcome.data;
  }

  @Post(':id/snooze')
  @RequirePermissions('reminder:snooze')
  @Audit('UPDATE', { severity: 'INFO', resource: 'ScheduledReminder' })
  async snooze(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(snoozeReminderSchema, 'body')) input: SnoozeReminderInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: VfmRequest,
  ): Promise<ScheduledReminder> {
    const outcome = await this.reminders.snooze(id, input, actor);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('ScheduledReminder');
    return outcome.data;
  }
}
