/**
 * Replace seeded demo passwords with CI-only ASCII credentials before Maestro
 * types them into Android fields. Runs only against the workflow's disposable DB.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { inspectEnv } from '../config/env.js';
import { prismaConnectionOptions } from '../prisma/prisma.service.js';
import { PasswordService } from '../modules/auth/services/password.service.js';

const HEX64 = /^[a-f0-9]{64}$/u;

async function upsertSuperAdmin(prisma: PrismaClient, passwordHash: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { code: 'SUPER_ADMIN' }, select: { id: true } });
  if (!role) throw new Error('SUPER_ADMIN role nije seedovana.');
  const email = 'superadmin@vfm.local';
  const existing = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  const userId = existing?.id ?? randomUUID();
  if (!existing) {
    await prisma.user.create({
      data: { id: userId, email, passwordHash, firstName: 'Demo', lastName: 'Super', status: 'ACTIVE', mustChangePassword: false },
    });
    await prisma.userRole.create({ data: { id: randomUUID(), userId, roleId: role.id } });
    return;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, status: 'ACTIVE', mustChangePassword: false },
  });
}

async function main(): Promise<void> {
  const { env, errors } = inspectEnv();
  if (errors.length > 0) throw new Error(`ENV nije ispravan: ${errors.join('; ')}`);
  const adminPassword = process.env.TEST_ADMIN_PASSWORD;
  const userPassword = process.env.TEST_USER_PASSWORD;
  const superPassword = process.env.TEST_SUPER_ADMIN_PASSWORD;
  if (!adminPassword || !userPassword || !superPassword || !HEX64.test(adminPassword) || !HEX64.test(userPassword) || !HEX64.test(superPassword)) {
    throw new Error('P4 CI lozinke moraju biti nasumični 64-znakovni lowercase hex nizovi.');
  }
  const passwordService = new PasswordService();
  const [adminHash, userHash, superHash] = await Promise.all([
    passwordService.hashUnchecked(adminPassword),
    passwordService.hashUnchecked(userPassword),
    passwordService.hashUnchecked(superPassword),
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
    await upsertSuperAdmin(prisma, superHash);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('P4 E2E priprema naloga nije uspjela:', error instanceof Error ? error.message : 'nepoznata greška');
  process.exitCode = 1;
});
