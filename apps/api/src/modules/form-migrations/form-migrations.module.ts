/**
 * Modul migracije zapisa (docs/04 §10, P12).
 *
 * `PrismaModule` je globalan; modul izvozi servis jer će ga Faza 3 koristiti iz
 * task modula pri promjeni forme nad postojećim zapisima.
 */
import { Module } from '@nestjs/common';
import { FormMigrationsController } from './form-migrations.controller.js';
import { FormMigrationsService } from './form-migrations.service.js';

@Module({
  controllers: [FormMigrationsController],
  providers: [FormMigrationsService],
  exports: [FormMigrationsService],
})
export class FormMigrationsModule {}
