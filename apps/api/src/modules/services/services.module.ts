import { ServiceItemsController } from './service-items.controller.js';
import { ServiceItemsService } from './service-items.service.js';
/** Modul servisnih evidencija. */
import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';
@Module({
  controllers: [ServicesController, ServiceItemsController],
  providers: [ServicesService, ServiceItemsService],
})
export class ServicesModule {}
