/** Modul guma — kompleti i pregled; transakcijske montaže slijede odvojeno. */
import { Module } from '@nestjs/common';
import { TiresService } from './tires.service.js';
import { TiresController } from './tires.controller.js';
@Module({ controllers: [TiresController], providers: [TiresService] })
export class TiresModule {}
