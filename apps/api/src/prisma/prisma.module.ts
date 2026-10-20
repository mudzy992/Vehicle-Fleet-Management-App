/**
 * `PrismaModule` — globalni Prisma sloj (Faza 1, docs/PLAN_IMPLEMENTACIJE §Faza 1).
 *
 * `@Global()` je namjeran: postoji **jedan** `PrismaClient` (jedan pg.Pool) po
 * procesu, a dijele ga api, worker i CLI alati. Bez toga bi svaki modul pravio
 * svoj pool i `DATABASE_CONNECTION_LIMIT` ne bi značio ništa.
 *
 * Modul ne radi ništa pri uvozu — konekcija je lenja (pg.Pool), a stvarno stanje
 * baze provjerava `PrismaService.ping()` (`SELECT 1`) u `/health/ready`.
 */
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
