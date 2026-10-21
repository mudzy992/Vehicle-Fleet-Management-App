/** Faza 4 — historija montaža guma. */
import { Controller, Get, Query } from '@nestjs/common';
import { tireInstallationListQuerySchema, type TireInstallationListQuery } from '@vfm/shared/schemas';
import { RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { TiresService } from './tires.service.js';
@Controller('tire-installations')
export class TiresController {
  constructor(private readonly tires: TiresService) {}
  @Get()
  @RequirePermissions('tire:view')
  list(
    @Query(new ZodValidationPipe(tireInstallationListQuerySchema, 'query')) query: TireInstallationListQuery,
  ) {
    return this.tires.listInstallations(query);
  }
}
