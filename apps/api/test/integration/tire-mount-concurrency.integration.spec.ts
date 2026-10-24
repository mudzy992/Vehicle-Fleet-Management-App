import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.PHASE3_TEST_DATABASE_URL;
const databaseIsolatedForCi = (() => {
  if (!databaseUrl || process.env.CI !== 'true') return false;
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  return parsed.hostname === 'localhost' && databaseName === 'vfm_test';
})();

type IntegrationPrisma = {
  $disconnect(): Promise<void>;
};

/**
 * Faza 4 / P13: dvije istovremene API montaže istog kompleta na različita vozila.
 * Izvršava se samo u CI nad localhost bazom `vfm_test`; preskače svaki lokalni/udaljeni URL.
 */
describe.skipIf(!databaseIsolatedForCi)('Faza 4 — konkurentna montaža kompleta guma (P13)', () => {
  let client: Client | undefined;
  let prisma: IntegrationPrisma | undefined;
  let mountTireSet:
    | ((input: {
        setId: string;
        vehicleId: string;
        mountedAt: string;
        mountedOdometerKm: number;
        positions: ['FL', 'FR', 'RL', 'RR'];
      }) => Promise<{ data: { id: string } }>)
    | undefined;
  const vehicleIds = [randomUUID(), randomUUID()];
  const tireSetId = randomUUID();
  const testCode = `P13-RACE-${tireSetId.slice(0, 8)}`;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
    const testClient = new Client({ connectionString: databaseUrl });
    client = testClient;
    await testClient.connect();

    const [{ PrismaPg }, { PrismaClient }, { TireInstallationsService }] = await Promise.all([
      import('@prisma/adapter-pg'),
      import('../../src/generated/prisma/client.js'),
      import('../../src/modules/tires/tire-installations.service.js'),
    ]);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    }) as unknown as IntegrationPrisma;
    const service = new TireInstallationsService(prisma as never);
    mountTireSet = (input) => service.mount(input as never) as Promise<{ data: { id: string } }>;

    const [vehicleForm, installationForm] = await Promise.all([
      testClient.query<{ id: string; versionId: string }>(
        `SELECT fs."id", fs."currentPublishedVersionId" AS "versionId"
           FROM "FormSchema" fs
          WHERE fs."subject" = 'VEHICLE' AND fs."deletedAt" IS NULL
            AND fs."currentPublishedVersionId" IS NOT NULL
          LIMIT 1`,
      ),
      testClient.query<{ id: string; versionId: string }>(
        `SELECT fs."id", fs."currentPublishedVersionId" AS "versionId"
           FROM "FormSchema" fs
          WHERE fs."subject" = 'TIRE_INSTALLATION' AND fs."deletedAt" IS NULL
            AND fs."currentPublishedVersionId" IS NOT NULL
          LIMIT 1`,
      ),
    ]);
    if (!vehicleForm.rows[0] || !installationForm.rows[0]) {
      throw new Error('Testna baza mora imati seedovane VEHICLE i TIRE_INSTALLATION forme.');
    }

    for (const [index, id] of vehicleIds.entries()) {
      await testClient.query(
        `INSERT INTO "Vehicle" (
           "id", "internalNo", "make", "model", "fuelType", "formSchemaId",
           "formSchemaVersionId", "odometerKm", "updatedAt"
         ) VALUES ($1, $2, 'Test', 'Tire race', 'DIESEL', $3, $4, 0, CURRENT_TIMESTAMP)`,
        [id, `${testCode}-V${index + 1}`, vehicleForm.rows[0].id, vehicleForm.rows[0].versionId],
      );
    }
    await testClient.query(
      `INSERT INTO "TireSet" ("id", "code", "season", "tireCount", "status", "updatedAt")
       VALUES ($1, $2, 'WINTER', 4, 'IN_STOCK', CURRENT_TIMESTAMP)`,
      [tireSetId, testCode],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query(
        `DELETE FROM "OutboxEvent"
          WHERE "aggregateType" = 'TireInstallation'
            AND "aggregateId" IN (
              SELECT "id" FROM "TireInstallation" WHERE "setId" = $1::uuid
            )`,
        [tireSetId],
      );
      await client.query('DELETE FROM "Vehicle" WHERE "id" = ANY($1::uuid[])', [vehicleIds]);
      await client.query('DELETE FROM "TireSet" WHERE "id" = $1::uuid', [tireSetId]);
      await client.end();
    }
    await prisma?.$disconnect();
  });

  it('tačno jedan od dva paralelna zahtjeva uspije; drugi dobije TIRE_ALREADY_MOUNTED', async () => {
    const mount = mountTireSet;
    if (!mount) throw new Error('TireInstallationsService nije inicijalizovan.');
    const mountedAt = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const results = await Promise.allSettled(
      vehicleIds.map((vehicleId) =>
        mount({
          setId: tireSetId,
          vehicleId,
          mountedAt,
          mountedOdometerKm: 0,
          positions: ['FL', 'FR', 'RL', 'RR'],
        }),
      ),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status !== 'rejected') throw new Error('Očekivano je jedno odbijanje montaže.');
    expect(rejected[0].reason).toMatchObject({ code: 'TIRE_ALREADY_MOUNTED' });

    if (!client) throw new Error('Testna PostgreSQL konekcija nije inicijalizovana.');
    const active = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count"
         FROM "TireInstallation"
        WHERE "setId" = $1::uuid AND "dismountedAt" IS NULL AND "deletedAt" IS NULL`,
      [tireSetId],
    );
    expect(active.rows[0]?.count).toBe('1');
  });
});
