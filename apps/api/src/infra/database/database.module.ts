/**
 * Database modul — provjera dostupnosti baze (Faza 1).
 *
 * Prisma sloj je u `src/prisma/` (`PrismaModule`, globalan): `PrismaService`
 * drži jedini `PrismaClient` s `@prisma/adapter-pg` pool-om. Ovaj modul izlaže
 * `DatabaseAvailabilityService`, koji taj pool koristi za stvarni `SELECT 1` u
 * `/health/ready` (docs/09 P0, docs/10 §3).
 *
 * Migracije se primjenjuju ISKLJUČIVO preko compose servisa `migrate`
 * (`src/tools/migrate.ts` → `prisma migrate deploy`), nikad pri bootu API-ja.
 * Vidi `apps/api/prisma/README.md` (§A redoslijed, §D verifier, §E oporavak).
 */
import { Global, Module } from '@nestjs/common';
import { DatabaseAvailabilityService } from './database-availability.service.js';

@Global()
@Module({
  providers: [DatabaseAvailabilityService],
  exports: [DatabaseAvailabilityService],
})
export class DatabaseModule {}
