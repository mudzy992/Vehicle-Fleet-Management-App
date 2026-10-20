/**
 * Modul formi (docs/04 §12, docs/07 §2.9).
 *
 * `PrismaModule` je globalan, pa modul nema dodatnih zavisnosti; `form-engine`
 * je čista biblioteka (bez DI-ja) i koristi se direktno u servisu.
 */
import { Module } from '@nestjs/common';
import { FormSchemasController } from './form-schemas.controller.js';
import { FormSchemasService } from './form-schemas.service.js';

@Module({
  controllers: [FormSchemasController],
  providers: [FormSchemasService],
  exports: [FormSchemasService],
})
export class FormSchemasModule {}
