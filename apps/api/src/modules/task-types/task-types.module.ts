/** Modul vrsta zadataka — konfiguracija i zahtjevi završetka. */
import { Module } from '@nestjs/common';
import { TaskTypesController } from './task-types.controller.js';
import { TaskTypesService } from './task-types.service.js';

@Module({
  controllers: [TaskTypesController],
  providers: [TaskTypesService],
  exports: [TaskTypesService],
})
export class TaskTypesModule {}
