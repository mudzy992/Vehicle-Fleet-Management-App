/**
 * Modul zadataka — jezgra Faze 5.
 *
 * `AuthModule` daje `PermissionsService`: servis njime provjerava opseg
 * aktera nad konkretnim zadatkom i da pozvani/direktni izvršioci zaista imaju
 * `task:claim`, a posmatrači pravo pregleda.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
