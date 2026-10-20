/** Modul vozača (docs/07 §2.4) — CRUD, arhiviranje, soft-delete, kategorije dozvole. */
import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';

@Module({
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
