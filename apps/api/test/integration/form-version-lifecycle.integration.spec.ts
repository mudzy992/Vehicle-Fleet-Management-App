/**
 * Copy → PUT izmjena → publish nad stvarnim PostgreSQL-om (trigger + JSONB).
 * Pokreće se samo uz PHASE3_TEST_DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FormSchemasService } from '../../src/modules/form-schemas/form-schemas.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  fieldKeysOf,
  inspectionDefinition,
  withFirstSectionFields,
} from '../helpers/form-definition-fixture.js';

const databaseUrl = process.env.PHASE3_TEST_DATABASE_URL;
const ACTOR = '018f0000-0000-7000-8000-0000000000aa';

describe.skipIf(!databaseUrl)('Form versioning — PostgreSQL workflow', () => {
  let prisma: {
    $disconnect(): Promise<void>;
    formSchema: {
      updateMany(args: unknown): Promise<unknown>;
      deleteMany(args: unknown): Promise<unknown>;
    };
  };
  let service: FormSchemasService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PHASE3_TEST_DATABASE_URL nije postavljen.');
    const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
      import('@prisma/adapter-pg'),
      import('../../src/generated/prisma/client.js'),
    ]);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    }) as unknown as typeof prisma;
    service = new FormSchemasService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await prisma.formSchema.updateMany({
        where: { id: { in: createdIds } },
        data: { currentPublishedVersionId: null },
      });
      await prisma.formSchema.deleteMany({ where: { id: { in: createdIds } } });
    }
    await prisma?.$disconnect();
  });

  it('izmjena polja na kopiji preživljava objavu', async () => {
    const created = await service.create(
      {
        key: `wf_${randomUUID().slice(0, 8)}`,
        name: 'Workflow DB',
        subject: 'OTHER',
        definition: inspectionDefinition(),
      },
      ACTOR,
    );
    createdIds.push(created.data.id);
    const firstId = created.data.versions[0]!.id;
    await service.publish(created.data.id, firstId, { changeNote: 'Prva verzija' }, ACTOR);

    const draft = await service.createVersion(created.data.id, { copyFromVersionId: firstId }, ACTOR);
    const edited = withFirstSectionFields(inspectionDefinition(), (fields) => {
      fields.splice(
        fields.findIndex((field) => field['key'] === 'napomena'),
        1,
      );
      fields.push({
        key: 'inspektor',
        type: 'TEXT',
        label: 'Inspektor',
        order: 9,
        required: false,
        visibleWhen: null,
        disabled: false,
        visibleOnForm: true,
        storeInFormData: true,
      });
    });
    await service.updateVersion(created.data.id, draft.data.id, { definition: edited });
    const published = await service.publish(created.data.id, draft.data.id, {
      changeNote: 'Uklonjena napomena',
    });
    const reloaded = await service.getVersion(created.data.id, draft.data.id);
    const previous = await service.getVersion(created.data.id, firstId);

    expect(fieldKeysOf(published.data.definition).sort()).toEqual(['inspektor', 'ocjena']);
    expect(fieldKeysOf(reloaded.definition).sort()).toEqual(['inspektor', 'ocjena']);
    expect(fieldKeysOf(previous.definition).sort()).toEqual(['napomena', 'ocjena']);
    expect(reloaded.contentHash).not.toBe(previous.contentHash);
    expect(reloaded.status).toBe('PUBLISHED');
    expect(previous.status).toBe('RETIRED');
  });
});
