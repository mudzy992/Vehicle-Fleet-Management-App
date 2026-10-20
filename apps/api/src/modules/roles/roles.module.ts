/**
 * `RolesModule` — uloge, matrica prava i katalog permisija (docs/07 §2.3).
 *
 * `AuthModule` se importuje zbog `PermissionsService` (Redis invalidacija nakon
 * izmjene matrice). Globalni `PrismaModule` daje bazu.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsController, RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RolesController, PermissionsController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
