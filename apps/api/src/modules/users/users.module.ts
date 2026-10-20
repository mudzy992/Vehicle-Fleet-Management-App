/**
 * `UsersModule` — upravljanje korisnicima (docs/07 §2.2).
 *
 * `AuthModule` daje `PasswordService` (politika/hash), `TokenService`
 * (jednokratni reset token) i `PermissionsService` (revokacija keša i
 * `tokenVersion`). Globalni `PrismaModule` daje bazu.
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
