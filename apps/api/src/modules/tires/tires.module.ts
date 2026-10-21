/** Modul guma — kompleti i transakcijski ciklusi montaže. */
import { Module } from '@nestjs/common';
import { TireInstallationsController } from './tire-installations.controller.js';
import { TireInstallationsService } from './tire-installations.service.js';
import { TireSetsController } from './tires.controller.js';
import { TiresService } from './tires.service.js';

@Module({
  controllers: [TireSetsController, TireInstallationsController],
  providers: [TiresService, TireInstallationsService],
})
export class TiresModule {}
