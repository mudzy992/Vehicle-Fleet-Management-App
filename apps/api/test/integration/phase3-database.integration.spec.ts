import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * P13 provjere PostgreSQL ograničenja. Koristi isključivo namjenski testni DB;
 * cijeli test radi u transakciji koja se uvijek vraća (ROLLBACK).
 *
 * Pokretanje: PHASE3_TEST_DATABASE_URL="postgresql://.../vfm_test" pnpm --filter @vfm/api test:integration
 */
const databaseUrl = process.env.PHASE3_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('Faza 3 — PostgreSQL integracijski ugovori (P13)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  it('odbija preklapanje registracija i osiguranja te deduplicira podsjetnike', async () => {
    const vehicleId = randomUUID();
    const registrationId = randomUUID();
    const insuranceId = randomUUID();

    await client.query('BEGIN');
    try {
      const vehicleForm = await publishedForm('VEHICLE');
      const registrationForm = await publishedForm('REGISTRATION');
      const insuranceForm = await publishedForm('INSURANCE');
      if (!vehicleForm || !registrationForm || !insuranceForm) {
        throw new Error(
          'Testna baza nema objavljene VEHICLE, REGISTRATION i INSURANCE forme (pokrenuti seed).',
        );
      }

      await client.query(
        `INSERT INTO "Vehicle" ("id", "internalNo", "make", "model", "fuelType", "formSchemaId", "formSchemaVersionId")
         VALUES ($1, $2, 'Test', 'P13', 'DIESEL', $3, $4)`,
        [vehicleId, `P13-${vehicleId.slice(0, 8)}`, vehicleForm.schemaId, vehicleForm.versionId],
      );

      await client.query(
        `INSERT INTO "RegistrationRecord" ("id", "vehicleId", "formSchemaId", "formSchemaVersionId", "registrationNumber", "validFrom", "validUntil")
         VALUES ($1, $2, $3, $4, $5, DATE '2035-01-01', DATE '2035-12-31')`,
        [
          registrationId,
          vehicleId,
          registrationForm.schemaId,
          registrationForm.versionId,
          `P13-${registrationId.slice(0, 8)}`,
        ],
      );
      await expectOverlap(
        `INSERT INTO "RegistrationRecord" ("id", "vehicleId", "formSchemaId", "formSchemaVersionId", "registrationNumber", "validFrom", "validUntil")
         VALUES ($1, $2, $3, $4, $5, DATE '2035-12-31', DATE '2036-12-31')`,
        [
          randomUUID(),
          vehicleId,
          registrationForm.schemaId,
          registrationForm.versionId,
          `P13-${randomUUID().slice(0, 8)}`,
        ],
      );

      await client.query(
        `INSERT INTO "InsuranceRecord" ("id", "vehicleId", "formSchemaId", "formSchemaVersionId", "validFrom", "validUntil")
         VALUES ($1, $2, $3, $4, DATE '2035-01-01', DATE '2035-12-31')`,
        [insuranceId, vehicleId, insuranceForm.schemaId, insuranceForm.versionId],
      );
      await expectOverlap(
        `INSERT INTO "InsuranceRecord" ("id", "vehicleId", "formSchemaId", "formSchemaVersionId", "validFrom", "validUntil")
         VALUES ($1, $2, $3, $4, DATE '2035-12-31', DATE '2036-12-31')`,
        [randomUUID(), vehicleId, insuranceForm.schemaId, insuranceForm.versionId],
      );

      const policy = await client.query<{ id: string }>(`SELECT "id" FROM "ReminderPolicy" LIMIT 1`);
      if (!policy.rows[0]) throw new Error('Testna baza nema ReminderPolicy red (pokrenuti seed).');
      const dedupeKey = `P13:${randomUUID()}`;
      const reminderId = randomUUID();
      await client.query(
        `INSERT INTO "ScheduledReminder" ("id", "policyId", "kind", "entityType", "entityId", "fireAt", "dedupeKey")
         VALUES ($1, $2, 'REGISTRATION', 'Vehicle', $3, NOW(), $4)`,
        [reminderId, policy.rows[0].id, vehicleId, dedupeKey],
      );
      await client.query('SAVEPOINT duplicate_reminder');
      let duplicateCode: string | undefined;
      try {
        await client.query(
          `INSERT INTO "ScheduledReminder" ("id", "policyId", "kind", "entityType", "entityId", "fireAt", "dedupeKey")
           VALUES ($1, $2, 'REGISTRATION', 'Vehicle', $3, NOW(), $4)`,
          [randomUUID(), policy.rows[0].id, vehicleId, dedupeKey],
        );
      } catch (error) {
        duplicateCode = (error as { code?: string }).code;
        await client.query('ROLLBACK TO SAVEPOINT duplicate_reminder');
      }
      expect(duplicateCode).toBe('23505');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  async function publishedForm(subject: string): Promise<{ schemaId: string; versionId: string } | null> {
    const result = await client.query<{ schemaId: string; versionId: string }>(
      `SELECT s."id" AS "schemaId", v."id" AS "versionId"
         FROM "FormSchema" s
         JOIN "FormSchemaVersion" v ON v."formSchemaId" = s."id"
        WHERE s."subject"::text = $1 AND v."status"::text = 'PUBLISHED'
        ORDER BY v."version" DESC LIMIT 1`,
      [subject],
    );
    return result.rows[0] ?? null;
  }

  async function expectOverlap(sql: string, values: unknown[]): Promise<void> {
    await client.query('SAVEPOINT expected_period_overlap');
    let code: string | undefined;
    try {
      await client.query(sql, values);
    } catch (error) {
      code = (error as { code?: string }).code;
      await client.query('ROLLBACK TO SAVEPOINT expected_period_overlap');
    }
    expect(code).toBe('23P01');
  }
});

if (!databaseUrl) {
  describe('Faza 3 — PostgreSQL integracijski ugovori (P13)', () => {
    it.skip('postavlja PHASE3_TEST_DATABASE_URL na namjensku testnu bazu da pokrene provjere', () => {});
  });
}
