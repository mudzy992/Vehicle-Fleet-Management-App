import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { ReportsService } from './reports.service.js';

const querySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    vehicleId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Početni datum mora biti prije završnog datuma.',
  });

@Controller('reports')
@RequirePermissions('report:view')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  catalog(@CurrentUser() actor: AuthenticatedUser | undefined) {
    return this.reports.catalog(actor);
  }

  @Get('vehicles')
  vehicles(@CurrentUser() actor: AuthenticatedUser | undefined) {
    return this.reports.vehicles(actor);
  }

  @Get(':code/export')
  @RequirePermissions('report:view', 'report:export')
  export(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(querySchema, 'query')) query: z.infer<typeof querySchema>,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ) {
    return this.reports.run(code, query, actor);
  }

  @Get(':code')
  run(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(querySchema, 'query')) query: z.infer<typeof querySchema>,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ) {
    return this.reports.run(code, query, actor);
  }
}
