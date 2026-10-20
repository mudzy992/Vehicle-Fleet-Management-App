/** Modul osiguranja (docs/07 §2.6) — historija perioda, bez preklapanja (B-10). */
import { Module } from '@nestjs/common';
import { InsurancesController } from './insurances.controller.js';
import { InsurancesService } from './insurances.service.js';

@Module({
  controllers: [InsurancesController],
  providers: [InsurancesService],
  exports: [InsurancesService],
})
export class InsurancesModule {}
