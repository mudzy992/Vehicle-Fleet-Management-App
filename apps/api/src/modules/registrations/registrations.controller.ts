/**
 * `RegistrationsController` — `/api/v1/registrations` (docs/07 §2.6).
 *
 * | Ruta                        | Permisija            | Audit                |
 * | --------------------------- | -------------------- | -------------------- |
 * | `GET /registrations`        | `registration:view`  | —                    |
 * | `POST /registrations`       | `registration:create`| `CREATE`             |
 * | `GET /registrations/:id`    | `registration:view`  | —                    |
 * | `PATCH /registrations/:id`  | `registration:update`| `UPDATE`             |
 * | `DELETE /registrations/:id` | `registration:delete`| `DELETE` (CRITICAL)  |
 *
 * Preklapanje perioda je `409 PERIOD_OVERLAP` (servis + `EXCLUDE` u bazi).
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
  CreateRegistrationInput,
  RegistrationListQuery,
  RegistrationListResponse,
  RegistrationRecord,
  UpdateRegistrationInput,
} from '@vfm/shared/schemas';
import {
  createRegistrationSchema,
  registrationListQuerySchema,
  updateRegistrationSchema,
  uuidSchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { RegistrationsService } from './registrations.service.js';

@Controller('registrations')
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get()
  @RequirePermissions('registration:view')
  list(
    @Query(new ZodValidationPipe(registrationListQuerySchema, 'query')) query: RegistrationListQuery,
  ): Promise<RegistrationListResponse> {
    return this.registrations.list(query);
  }

  @Post()
  @RequirePermissions('registration:create')
  @Audit('CREATE', { severity: 'INFO', resource: 'RegistrationRecord' })
  async create(
    @Body(new ZodValidationPipe(createRegistrationSchema, 'body')) input: CreateRegistrationInput,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<RegistrationRecord> {
    const outcome = await this.registrations.create(input, actor?.id);
    AuditContext.from(request)
      .setEntityId(outcome.data.id)
      .setAfter(outcome.after)
      .setResource('RegistrationRecord')
      .set('vehicleId', outcome.data.vehicleId);
    return outcome.data;
  }

  @Get(':id')
  @RequirePermissions('registration:view')
  get(@Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string): Promise<RegistrationRecord> {
    return this.registrations.get(id);
  }

  @Patch(':id')
  @RequirePermissions('registration:update')
  @Audit('UPDATE', { severity: 'INFO', resource: 'RegistrationRecord' })
  async update(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @Body(new ZodValidationPipe(updateRegistrationSchema, 'body')) input: UpdateRegistrationInput,
    @Req() request: VfmRequest,
  ): Promise<RegistrationRecord> {
    const outcome = await this.registrations.update(id, input);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('RegistrationRecord');
    return outcome.data;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('registration:delete')
  @Audit('DELETE', { severity: 'CRITICAL', resource: 'RegistrationRecord' })
  async remove(
    @Param('id', new ZodValidationPipe(uuidSchema, 'params')) id: string,
    @CurrentUser() actor: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
  ): Promise<void> {
    const outcome = await this.registrations.remove(id, actor?.id);
    AuditContext.from(request)
      .setEntityId(id)
      .setBefore(outcome.before)
      .setAfter(outcome.after)
      .setResource('RegistrationRecord');
  }
}
