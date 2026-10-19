/**
 * Privremeni `PermissionsLoader` dok Prisma sloj nije dostupan (⛔ bloker 1).
 *
 * `prisma generate` i migracija `init` ne mogu se izvršiti u sandboxu
 * (`binaries.prisma.sh` nedostupan), a `prisma` se ne smije dodati u
 * `package.json` dok vlasnikov push ne stigne na `main`. Zato je ovdje
 * **fail-closed** zamjena: svako čitanje prava iz baze baca
 * `503 DEPENDENCY_UNAVAILABLE` umjesto da vrati „nema prava" ili „ima sva prava".
 *
 * Kad Prisma bude dostupna:
 * 1. dodati `PrismaPermissionsLoader` (čita `User`, `UserRole`, `Role`,
 *    `RolePermission` + `Role.permissionsVersion` i `Role.allowedClientTypes`),
 * 2. u `AuthModule` zamijeniti provider `PERMISSIONS_LOADER` s tom klasom,
 * 3. obrisati ovaj fajl.
 *
 * Guard-ovi, servisi i testovi se **ne mijenjaju** — rade nad interfejsom.
 */
import { Injectable, Logger } from '@nestjs/common';
import { VfmErrors } from '../../../common/errors/vfm-error.js';
import type { PermissionsLoader, UserPermissionsSnapshot } from './permissions.types.js';

@Injectable()
export class UnavailablePermissionsLoader implements PermissionsLoader {
  private readonly logger = new Logger(UnavailablePermissionsLoader.name);

  async loadSnapshot(userId: string): Promise<UserPermissionsSnapshot | undefined> {
    this.logger.error(
      `RBAC čitanje prava za user=${userId} nije moguće: PermissionsLoader (Prisma) nije povezan — bloker 1.`,
    );
    throw VfmErrors.dependencyUnavailable('permissions');
  }
}
