/** Modul vozila (docs/07 §2.5) — CRUD, arhiviranje, soft-delete. */
import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { AuditLogModule } from '../audit-logs/audit-log.module.js';

@Module({
  imports: [TasksModule, AuditLogModule],
  controllers: [VehiclesController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
