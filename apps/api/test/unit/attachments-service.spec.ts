/**
 * `AttachmentsService` — upload/vezivanje/serviranje priloga (Faza 3, docs/07 §2.12).
 *
 * Testovi koriste stvarni temp direktorij (pohrana je dio ugovora — fajl mora
 * stvarno postojati na disku), a bazu zamjenjuje minimalni fake delegat.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AttachmentsService,
  type AttachmentStorageOptions,
  type UploadedFileLike,
} from '../../src/modules/attachments/attachments.service.js';
import { sha256Hex } from '../../src/modules/attachments/attachment-files.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from([0xff, 0xe1, 0x00, 0x08]),
  Buffer.from('Exif', 'latin1'),
  Buffer.from([0xff, 0xda, 0x00, 0x02, 0x42]),
]);
const PDF = Buffer.from('%PDF-1.7\n% sadrzaj\n', 'latin1');

interface FakeRow extends Record<string, unknown> {
  id: string;
  ownerType: string;
  ownerId: string;
  deletedAt: Date | null;
}

type Where = Record<string, unknown>;

function matches(row: FakeRow, where: Where): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'deletedAt' && value === null && row.deletedAt !== null) return false;
    if (key === 'deletedAt' && value instanceof Date && row.deletedAt !== value) return false;
    if (key === 'deletedAt') continue;
    if (row[key] !== value) return false;
  }
  return true;
}

class FakeAttachmentsPrisma {
  readonly rows: FakeRow[] = [];
  vehicleCreatorId = 'user-1';
  private seq = 0;

  readonly attachment = {
    findFirst: async (args: { where: Where }) => {
      const row = this.rows.find((item) => matches(item, args.where));
      return row ? { ...row } : null;
    },
    findMany: async (args: { where: Where; skip?: number; take?: number }) => {
      const filtered = this.rows.filter((row) => matches(row, args.where));
      const sorted = [...filtered].sort(
        (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
      );
      return sorted
        .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? sorted.length))
        .map((row) => ({ ...row }));
    },
    count: async (args: { where: Where }) => this.rows.filter((row) => matches(row, args.where)).length,
    create: async (args: { data: Record<string, unknown> }) => {
      this.seq += 1;
      const row: FakeRow = {
        createdAt: new Date(Date.UTC(2026, 9, 20, 8, 0, this.seq)),
        deletedAt: null,
        width: null,
        height: null,
        taskId: null,
        formFieldKey: null,
        stage: 'GENERAL',
        ...args.data,
      } as unknown as FakeRow;
      this.rows.push(row);
      return { ...row };
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.rows.find((item) => item.id === args.where.id);
      if (!row) throw new Error('red ne postoji');
      Object.assign(row, args.data);
      return { ...row };
    },
  };
  readonly vehicle = {
    findFirst: async (args: { where: { id: string; deletedAt?: null } }) =>
      args.where.deletedAt === null ? { id: args.where.id, createdById: this.vehicleCreatorId } : null,
  };
  readonly insuranceRecord = {
    findFirst: async (args: { where: { id: string; deletedAt?: null } }) =>
      args.where.deletedAt === null ? { createdById: 'user-1', vehicleId: 'vehicle-1' } : null,
  };
  readonly task = {
    findFirst: async (args: { where: { id: string; deletedAt?: null } }) =>
      args.where.deletedAt === null
        ? {
            createdById: 'task-creator',
            assigneeUserId: 'task-assignee',
            vehicleId: 'vehicle-scoped',
            status: 'IN_PROGRESS',
          }
        : null,
  };
}

const ADMIN = {
  id: 'user-admin',
  permissions: {
    isSuperAdmin: false,
    permissions: new Map([
      ['attachment:view', 'ALL'],
      ['attachment:upload', 'ALL'],
      ['attachment:delete', 'OWN'],
      ['vehicle:update', 'ALL'],
    ]),
  },
};
const USER = {
  id: 'user-1',
  permissions: {
    isSuperAdmin: false,
    permissions: new Map([
      ['attachment:view', 'OWN'],
      ['attachment:upload', 'ALL'],
      ['attachment:delete', 'OWN'],
      ['vehicle:update', 'OWN'],
      ['insurance:update', 'OWN'],
    ]),
  },
};
const OTHER = {
  id: 'user-2',
  permissions: {
    isSuperAdmin: false,
    permissions: new Map([
      ['attachment:view', 'OWN'],
      ['attachment:upload', 'ALL'],
      ['attachment:delete', 'OWN'],
      ['vehicle:update', 'OWN'],
    ]),
  },
};

function file(buffer: Buffer, name = 'foto.jpg', mimetype = 'image/jpeg'): UploadedFileLike {
  return { buffer, originalname: name, mimetype, size: buffer.length };
}

function catchVfm(promise: Promise<unknown>): Promise<{ code: string; extra?: unknown }> {
  return promise.then(
    () => {
      throw new Error('očekivana greška nije bačena');
    },
    (error: { code: string }) => error,
  );
}

describe('AttachmentsService', () => {
  let root: string;
  let fake: FakeAttachmentsPrisma;
  let svc: AttachmentsService;
  let options: Partial<AttachmentStorageOptions>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vfm-att-'));
    options = {
      rootPath: root,
      tempPath: join(root, 'tmp'),
      maxSizeBytes: 1024,
      allowedMime: ['image/jpeg', 'image/png', 'application/pdf'],
      validateMagicBytes: true,
      signingSecret: 'test-secret',
      signedUrlTtlSeconds: 60,
      publicPrefix: '/api/v1',
    };
    fake = new FakeAttachmentsPrisma();
    svc = new AttachmentsService(fake as never, options);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('upload: magic bytes, SHA-256, EXIF uklonjen i fajl stvarno na disku', async () => {
    const result = await svc.upload(file(JPEG), USER);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.ext).toBe('jpg');
    expect(result.sha256).toHaveLength(64);
    // Veličina je veličina **spremljenog** fajla (nakon uklanjanja EXIF-a).
    const stored = await readFile(join(root, String(fake.rows[0]!.storageKey)));
    expect(result.sizeBytes).toBe(stored.length);
    expect(stored.length).toBeLessThan(JPEG.length);
    expect(fake.rows[0]!.exifStripped).toBe(true);
    expect(fake.rows[0]!.ownerType).toBe('OTHER');
    expect(fake.rows[0]!.ownerId).toBe(USER.id);

    expect(stored.includes(Buffer.from('Exif', 'latin1'))).toBe(false);
    expect(sha256Hex(stored)).toBe(result.sha256);
  });

  it('upload PDF-a ne dira sadržaj (`exifStripped: false`)', async () => {
    const result = await svc.upload(file(PDF, 'ugovor.pdf', 'application/pdf'), USER);

    expect(result.mimeType).toBe('application/pdf');
    expect(fake.rows[0]!.exifStripped).toBe(false);
    expect(await readFile(join(root, String(fake.rows[0]!.storageKey)))).toEqual(PDF);
  });

  it('prevelik fajl → `413 PAYLOAD_TOO_LARGE` i ništa se ne upisuje', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(2048)]);
    const error = await catchVfm(svc.upload(file(big), USER));

    expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(fake.rows).toHaveLength(0);
  });

  it('nepoznat sadržaj → `415 UNSUPPORTED_MEDIA_TYPE` (Content-Type se ne vjeruje)', async () => {
    const error = await catchVfm(
      svc.upload(file(Buffer.from('MZ\x90\x00 nije slika', 'latin1'), 'foto.jpg', 'image/jpeg'), USER),
    );

    expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(fake.rows).toHaveLength(0);
  });

  it('tip koji nije na `ATTACHMENT_ALLOWED_MIME` → `415`', async () => {
    const svcStrict = new AttachmentsService(fake as never, {
      ...options,
      allowedMime: ['application/pdf'],
    });
    const error = await catchVfm(svcStrict.upload(file(JPEG), USER));

    expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('prazan fajl → `VALIDATION_ERROR`', async () => {
    const error = await catchVfm(svc.upload(undefined, USER));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('isti sadržaj drugi put vraća **postojeći** zapis (idempotentno)', async () => {
    const first = await svc.upload(file(JPEG), USER);
    const second = await svc.upload(file(JPEG, 'kopija.jpg'), USER);

    expect(second.id).toBe(first.id);
    expect(fake.rows).toHaveLength(1);
  });

  it('`complete` veže prilog na vlasnika i vraća `before`/`after` za audit', async () => {
    const uploaded = await svc.upload(file(JPEG), USER);
    const outcome = await svc.complete(
      uploaded.id,
      {
        id: uploaded.id,
        ownerType: 'VEHICLE',
        ownerId: '018f0000-0000-7000-8000-000000000001',
        stage: 'GENERAL',
      },
      USER,
    );

    expect(outcome.data.ownerType).toBe('VEHICLE');
    expect(outcome.before).toMatchObject({ ownerType: 'OTHER' });
    expect(outcome.after).toMatchObject({ ownerType: 'VEHICLE' });
  });

  it('complete odbija vezivanje upload-a na vozilo izvan vehicle:update scope-a', async () => {
    const uploaded = await svc.upload(file(JPEG), OTHER);
    fake.vehicleCreatorId = USER.id;

    const error = await catchVfm(
      svc.complete(
        uploaded.id,
        {
          id: uploaded.id,
          ownerType: 'VEHICLE',
          ownerId: '018f0000-0000-7000-8000-000000000001',
          stage: 'GENERAL',
        },
        OTHER,
      ),
    );

    expect(error.code).toBe('SCOPE_DENIED');
    expect(fake.rows[0]).toMatchObject({ ownerType: 'OTHER', ownerId: OTHER.id });
  });

  it('tuđi prilog bez `ALL` opsega → `PERMISSION_DENIED`', async () => {
    const uploaded = await svc.upload(file(JPEG), USER);
    const error = await catchVfm(
      svc.complete(
        uploaded.id,
        {
          id: uploaded.id,
          ownerType: 'VEHICLE',
          ownerId: '018f0000-0000-7000-8000-000000000001',
          stage: 'GENERAL',
        },
        OTHER,
      ),
    );

    expect(error.code).toBe('PERMISSION_DENIED');
  });

  it('task:update VEHICLE_IDS ne nadjačava pravila za izmjenu zadatka', async () => {
    const actor = {
      id: 'user-manager',
      permissions: {
        isSuperAdmin: false,
        permissions: new Map([
          ['attachment:upload', 'ALL'],
          ['task:update', 'VEHICLE_IDS'],
        ]),
        grants: [{ permission: 'task:update', scope: 'VEHICLE_IDS', scopeVehicleIds: ['vehicle-scoped'] }],
      },
    };
    const uploaded = await svc.upload(file(JPEG), actor);

    await expect(
      svc.complete(
        uploaded.id,
        {
          id: uploaded.id,
          ownerType: 'TASK',
          ownerId: '018f0000-0000-7000-8000-000000000004',
          stage: 'GENERAL',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('task:complete sa VEHICLE_IDS i dalje zahtijeva da akter bude izvršilac', async () => {
    const actor = {
      id: 'user-manager',
      permissions: {
        isSuperAdmin: false,
        permissions: new Map([
          ['attachment:upload', 'ALL'],
          ['task:complete', 'VEHICLE_IDS'],
        ]),
        grants: [{ permission: 'task:complete', scope: 'VEHICLE_IDS', scopeVehicleIds: ['vehicle-scoped'] }],
      },
    };
    const uploaded = await svc.upload(file(JPEG), actor);

    await expect(
      svc.complete(
        uploaded.id,
        {
          id: uploaded.id,
          ownerType: 'TASK',
          ownerId: '018f0000-0000-7000-8000-000000000004',
          stage: 'ON_COMPLETE',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('task:complete_override dopušta vezivanje unutar VEHICLE_IDS opsega', async () => {
    const actor = {
      id: 'user-manager',
      permissions: {
        isSuperAdmin: false,
        permissions: new Map([
          ['attachment:upload', 'ALL'],
          ['task:complete_override', 'VEHICLE_IDS'],
        ]),
        grants: [
          {
            permission: 'task:complete_override',
            scope: 'VEHICLE_IDS',
            scopeVehicleIds: ['vehicle-scoped'],
          },
        ],
      },
    };
    const uploaded = await svc.upload(file(JPEG), actor);

    const result = await svc.complete(
      uploaded.id,
      {
        id: uploaded.id,
        ownerType: 'TASK',
        ownerId: '018f0000-0000-7000-8000-000000000004',
        stage: 'ON_COMPLETE',
      },
      actor,
    );

    expect(result.data.ownerType).toBe('TASK');
    expect(result.data.taskId).toBe('018f0000-0000-7000-8000-000000000004');
  });

  it('odbija taskId koji pokušava povezati prilog s drugim zapisom', async () => {
    const uploaded = await svc.upload(file(JPEG), ADMIN);

    await expect(
      svc.complete(
        uploaded.id,
        {
          id: uploaded.id,
          ownerType: 'VEHICLE',
          ownerId: '018f0000-0000-7000-8000-000000000001',
          stage: 'GENERAL',
          taskId: '018f0000-0000-7000-8000-000000000004',
        },
        ADMIN,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('attachment:view:ALL ne daje pravo vezivanja na zapis bez write scope-a', async () => {
    const viewer = {
      id: 'user-viewer',
      permissions: {
        isSuperAdmin: false,
        permissions: new Map([
          ['attachment:view', 'ALL'],
          ['attachment:upload', 'ALL'],
        ]),
      },
    };
    const uploaded = await svc.upload(file(JPEG), viewer);

    await expect(
      svc.complete(
        uploaded.id,
        {
          id: uploaded.id,
          ownerType: 'VEHICLE',
          ownerId: '018f0000-0000-7000-8000-000000000001',
          stage: 'GENERAL',
        },
        viewer,
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('zamjena zahtijeva i dalje važeći write scope ciljnog zapisa', async () => {
    const actor = {
      id: 'user-1',
      permissions: {
        isSuperAdmin: false,
        permissions: new Map([
          ['attachment:upload', 'ALL'],
          ['vehicle:update', 'OWN'],
        ]),
      },
    };
    const uploaded = await svc.upload(file(JPEG), actor);
    await svc.complete(
      uploaded.id,
      {
        id: uploaded.id,
        ownerType: 'VEHICLE',
        ownerId: '018f0000-0000-7000-8000-000000000001',
        stage: 'GENERAL',
      },
      actor,
    );
    actor.permissions.permissions.delete('vehicle:update');

    await expect(
      svc.replace(uploaded.id, file(PDF, 'new.pdf', 'application/pdf'), actor),
    ).rejects.toMatchObject({
      code: 'SCOPE_DENIED',
    });
  });

  it('attachment:view:ALL ne dopušta dovršiti tuđi upload', async () => {
    const viewer = {
      id: 'user-viewer',
      permissions: {
        isSuperAdmin: false,
        permissions: new Map([
          ['attachment:view', 'ALL'],
          ['attachment:upload', 'ALL'],
          ['vehicle:update', 'ALL'],
        ]),
      },
    };
    const uploaded = await svc.upload(file(JPEG), USER);

    await expect(
      svc.complete(
        uploaded.id,
        {
          id: uploaded.id,
          ownerType: 'VEHICLE',
          ownerId: '018f0000-0000-7000-8000-000000000001',
          stage: 'GENERAL',
        },
        viewer,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('Super Admin smije mijenjati tuđi prilog', async () => {
    const uploaded = await svc.upload(file(JPEG), USER);
    const outcome = await svc.complete(
      uploaded.id,
      {
        id: uploaded.id,
        ownerType: 'DRIVER',
        ownerId: '018f0000-0000-7000-8000-000000000002',
        stage: 'GENERAL',
      },
      { id: 'root', isSuperAdmin: true },
    );

    expect(outcome.data.ownerType).toBe('DRIVER');
  });

  it('lista po vlasniku poštuje opseg (`OWN` vidi samo svoje)', async () => {
    const uploaded = await svc.upload(file(JPEG), USER);
    await svc.complete(
      uploaded.id,
      {
        id: uploaded.id,
        ownerType: 'VEHICLE',
        ownerId: '018f0000-0000-7000-8000-000000000001',
        stage: 'GENERAL',
      },
      USER,
    );

    const query = {
      ownerType: 'VEHICLE' as const,
      ownerId: '018f0000-0000-7000-8000-000000000001',
      page: 1,
      pageSize: 25,
      sortOrder: 'desc' as const,
    };

    expect((await svc.list(query, USER)).total).toBe(1);
    expect((await svc.list(query, OTHER)).total).toBe(0);
    expect((await svc.list(query, ADMIN)).total).toBe(1);
  });

  it('`content` vraća tačno one bajtove koji su spremljeni', async () => {
    const uploaded = await svc.upload(file(PDF, 'ugovor.pdf', 'application/pdf'), USER);
    const { buffer, attachment } = await svc.content(uploaded.id, USER);

    expect(buffer).toEqual(PDF);
    expect(attachment.fileName).toBe('ugovor.pdf');
    expect(attachment.sizeBytes).toBe(PDF.length);
  });

  it('putanja van storage-a je odbijena (`..`)', async () => {
    fake.rows.push({
      id: '018f0000-0000-7000-8000-000000000003',
      ownerType: 'OTHER',
      ownerId: USER.id,
      stage: 'GENERAL',
      fileName: 'x.jpg',
      storageKey: '../../etc/passwd',
      mimeType: 'image/jpeg',
      ext: 'jpg',
      sizeBytes: BigInt(1),
      sha256: 'a'.repeat(64),
      width: null,
      height: null,
      exifStripped: false,
      uploadedById: USER.id,
      taskId: null,
      formFieldKey: null,
      createdAt: new Date(),
      deletedAt: null,
    });

    const error = await catchVfm(svc.content('018f0000-0000-7000-8000-000000000003', USER));
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('potpisani URL: važeći token prolazi, istekao i izmijenjen ne', async () => {
    const uploaded = await svc.upload(file(JPEG), USER);
    const signed = svc.signUrl(uploaded.id, USER.id, new Date('2026-10-20T08:00:00.000Z'));

    expect(
      svc.verifySignedToken(uploaded.id, signed.token, USER.id, new Date('2026-10-20T08:00:30.000Z')),
    ).toBe(true);
    expect(
      svc.verifySignedToken(uploaded.id, signed.token, USER.id, new Date('2026-10-20T08:02:00.000Z')),
    ).toBe(false);
    expect(
      svc.verifySignedToken(uploaded.id, `${signed.token}x`, USER.id, new Date('2026-10-20T08:00:30.000Z')),
    ).toBe(false);
    expect(
      svc.verifySignedToken(uploaded.id, signed.token, OTHER.id, new Date('2026-10-20T08:00:30.000Z')),
    ).toBe(false);
    expect(
      svc.verifySignedToken(
        '018f0000-0000-7000-8000-000000000009',
        signed.token,
        USER.id,
        new Date('2026-10-20T08:00:30.000Z'),
      ),
    ).toBe(false);
  });

  it('`replace` pravi novu verziju, staru soft-briše i čuva vlasnika', async () => {
    const uploaded = await svc.upload(file(PDF, 'ugovor.pdf', 'application/pdf'), USER);
    await svc.complete(
      uploaded.id,
      {
        id: uploaded.id,
        ownerType: 'INSURANCE',
        ownerId: '018f0000-0000-7000-8000-000000000004',
        stage: 'GENERAL',
      },
      USER,
    );

    const replacement = await svc.replace(uploaded.id, file(JPEG), USER);

    expect(replacement.data.id).not.toBe(uploaded.id);
    expect(replacement.data.ownerType).toBe('INSURANCE');
    expect(fake.rows.find((row) => row.id === uploaded.id)!.deletedAt).toBeInstanceOf(Date);
    expect(fake.rows.filter((row) => row.deletedAt === null)).toHaveLength(1);
  });

  it('attachment:view ALL ne proširuje attachment:delete OWN na tuđi prilog', async () => {
    const uploaded = await svc.upload(file(JPEG), USER);
    const error = await catchVfm(svc.remove(uploaded.id, ADMIN));
    expect(error.code).toBe('SCOPE_DENIED');
    expect(fake.rows.find((row) => row.id === uploaded.id)?.deletedAt).toBeNull();
  });

  it('`remove` je soft-delete — fajl ostaje na disku, zapis nestaje iz API-ja', async () => {
    const uploaded = await svc.upload(file(JPEG), USER);
    const outcome = await svc.remove(uploaded.id, USER);

    expect(outcome.before).toMatchObject({ id: uploaded.id });
    expect(await catchVfm(svc.get(uploaded.id, USER))).toMatchObject({ code: 'NOT_FOUND' });
  });
});
