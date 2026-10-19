/**
 * Database modul (Faza 0: provjera dostupnosti; Faza 1: Prisma client).
 *
 * 🔴 **STATUS (Faza 0):** `prisma generate` zahtijeva preuzimanje engine
 * binarnih fajlova s `binaries.prisma.sh`. U sandbox okruženju u kojem je
 * nastao ovaj kod taj host nije dostupan, pa Prisma client **nije** generisan
 * i paket `prisma`/`@prisma/client` još nije dodat u `apps/api/package.json`.
 *
 * Šta je spremno:
 * - `prisma/schema.prisma` — potpuni model podataka za Fazu 1 (izvor istine),
 * - `prisma/sql/0000_bootstrap_extensions.sql` — ekstenzije (`pgcrypto`, `citext`)
 *   i inicijalizacija šeme,
 * - `src/tools/migrate.ts` — alat koji pokreće `prisma migrate deploy` pod
 *   Redis lockom `vfm:lock:migrate` (compose servis `migrate`),
 * - `DATABASE_*` varijable su validirane u ENV šemi (`@vfm/shared/env-schema`).
 *
 * Koraci za aktivaciju (jednom, na mašini s pristupom `binaries.prisma.sh`
 * ili u Coolify build-u gdje je internet otvoren):
 * ```bash
 * pnpm --filter @vfm/api add prisma@7.10.1 @prisma/client@7.10.1
 * pnpm prisma:generate
 * pnpm --filter @vfm/api exec prisma migrate dev --name init   # kreira migrations/
 * pnpm --filter @vfm/api build:full                            # uključuje src/prisma/**
 * ```
 * Nakon toga se `PrismaService` iz `src/prisma/prisma.service.ts` uključuje u
 * ovaj modul i mijenja `DatabaseAvailabilityService` kao izvor `/health/ready`
 * provjere baze.
 */
import { Global, Module } from '@nestjs/common';
import { DatabaseAvailabilityService } from './database-availability.service.js';

@Global()
@Module({
  providers: [DatabaseAvailabilityService],
  exports: [DatabaseAvailabilityService],
})
export class DatabaseModule {}
