/**
 * Replace seeded demo passwords with CI-only ASCII credentials before Maestro
 * types them into Android fields. Runs only against the workflow's disposable DB.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { inspectEnv } from '../config/env.js';
import { prismaConnectionOptions } from '../prisma/prisma.service.js';
import { PasswordService } from '../modules/auth/services/password.service.js';

async function main(): Promise<void> {
  const { env, errors } = inspectEnv();
  if (errors.length > 0) throw new Error(`ENV nije ispravan: ${errors.join('; ')}`);

  const adminPassword = process.env.TEST_ADMIN_PASSWORD;
  const userPassword = process.env.TEST_USER_PASSWORD;
  if (!adminPassword || !userPassword || !/^[a-f0-9]{64}$/u.test(adminPassword) || !/^[a-f0-9]{64}$/u.test(userPassword)) {
    throw new Error('P4 CI lozinke moraju biti nasumični 64-znakovni lowercase hex nizovi.');
  }

  const passwordService = new PasswordService();
  const [adminHash, userHash] = await Promise.all([
    passwordService.hashUnchecked(adminPassword),
    passwordService.hashUnchecked(userPassword),
  ]);
  const prisma = new PrismaClient({ adapter: new PrismaPg(prismaConnectionOptions(env)) });
  try {
    const result = await prisma.user.updateMany({
      where: { email: { in: ['admin@vfm.local', 'vozac@vfm.local'] } },
      data: { status: 'ACTIVE', mustChangePassword: false },
    });
    if (result.count !== 2) throw new Error(`Očekivana su 2 privremena demo naloga; ažurirano ${result.count}.`);
    await prisma.user.update({ where: { email: 'admin@vfm.local' }, data: { passwordHash: adminHash } });
    await prisma.user.update({ where: { email: 'vozac@vfm.local' }, data: { passwordHash: userHash } });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('P4 E2E priprema naloga nije uspjela:', error instanceof Error ? error.message : 'nepoznata greška');
  process.exitCode = 1;
});
