import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultGrantsForRole,
  evaluateEffectivePermissions,
  type PermissionGrant,
  type RoleCode,
} from '@vfm/shared';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard.js';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter.js';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user.js';
import { AttachmentsController } from '../../src/modules/attachments/attachments.controller.js';
import { AttachmentsService } from '../../src/modules/attachments/attachments.service.js';
import { PermissionsService } from '../../src/modules/auth/permissions/permissions.service.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

const ATTACHMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const attachment = {
  id: ATTACHMENT_ID,
  ownerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ownerType: 'VEHICLE',
  stage: 'GENERAL',
  fileName: 'izvjestaj.txt',
  storageKey: 'test/izvjestaj.txt',
  mimeType: 'text/plain',
  ext: 'txt',
  sizeBytes: 6,
  sha256: '0'.repeat(64),
  width: null,
  height: null,
  exifStripped: false,
  uploadedById: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
};

function actorFor(scenario: string): AuthenticatedUser {
  const role: RoleCode = scenario === 'OBICNI_KORISNIK' ? 'OBICNI_KORISNIK' : 'CUSTOM';
  const grants: readonly PermissionGrant[] =
    scenario === 'VIEW_ALL_ONLY'
      ? [{ permission: 'attachment:view', scope: 'ALL' }]
      : defaultGrantsForRole(role);
  return {
    id: `p14-${scenario.toLowerCase()}`,
    roles: [role],
    roleIds: [],
    clientType: 'WEB',
    sessionId: 'p14-attachment-session',
    jti: 'p14-attachment-token',
    tokenVersion: 1,
    permissionsVersion: 0,
    isSuperAdmin: false,
    mustChangePassword: false,
    status: 'ACTIVE',
    allowedClientTypes: ['WEB'],
    permissions: evaluateEffectivePermissions({ roles: [role], grants, clientType: 'WEB' }),
  };
}

describe('P14 — attachment HTTP rute i PermissionsGuard', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = {
    get: vi.fn(async () => attachment),
    signUrl: vi.fn(async () => ({ url: '/signed-content', expiresAt: '2026-12-01T00:00:00.000Z' })),
    verifySignedToken: vi.fn(() => true),
    content: vi.fn(async () => ({ attachment, buffer: Buffer.from('secret') })),
    remove: vi.fn(async () => ({ before: attachment, after: null, data: null })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service.verifySignedToken.mockReturnValue(true);
  });

  beforeAll(async () => {
    const permissions = {
      snapshot: vi.fn(async () => ({ permissionsVersion: 0 })),
      currentPermissionsVersion: vi.fn(async () => 0),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AttachmentsController],
      providers: [
        Reflector,
        PermissionsGuard,
        { provide: PermissionsService, useValue: permissions },
        { provide: AttachmentsService, useValue: service },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(
      (
        request: { headers: Record<string, string | string[] | undefined>; user?: AuthenticatedUser },
        _response: unknown,
        next: () => void,
      ) => {
        const rawScenario = request.headers['x-sweep-role'];
        const scenario = Array.isArray(rawScenario) ? rawScenario[0] : rawScenario;
        if (scenario) request.user = actorFor(scenario);
        next();
      },
    );
    app.useGlobalGuards(app.get(PermissionsGuard));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('odbija direktan pristup URL-u i sadržaju bez attachment:view prije poziva servisa', async () => {
    const options = { headers: { 'x-sweep-role': 'CUSTOM' } };
    const urlResponse = await fetch(`${baseUrl}/attachments/${ATTACHMENT_ID}/url`, options);
    const contentResponse = await fetch(
      `${baseUrl}/attachments/${ATTACHMENT_ID}/content/valid-token`,
      options,
    );

    expect(urlResponse.status).toBe(403);
    expect(contentResponse.status).toBe(403);
    expect((await contentResponse.json()).error.code).toBe('PERMISSION_DENIED');
    expect(service.get).not.toHaveBeenCalled();
    expect(service.verifySignedToken).not.toHaveBeenCalled();
    expect(service.content).not.toHaveBeenCalled();
  });

  it('attachment:view:ALL ne daje attachment:delete; VIEW korisnik ne ulazi u handler', async () => {
    const response = await fetch(`${baseUrl}/attachments/${ATTACHMENT_ID}`, {
      method: 'DELETE',
      headers: { 'x-sweep-role': 'VIEW_ALL_ONLY' },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('PERMISSION_DENIED');
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('odbijeni potpisani token vraća 401 i ne vraća bajtove', async () => {
    service.verifySignedToken.mockReturnValue(false);
    const response = await fetch(`${baseUrl}/attachments/${ATTACHMENT_ID}/content/not-valid`, {
      headers: { 'x-sweep-role': 'OBICNI_KORISNIK' },
    });

    expect(response.status).toBe(401);
    expect(service.verifySignedToken).toHaveBeenCalledWith(ATTACHMENT_ID, 'not-valid', 'p14-obicni_korisnik');
    expect(service.content).not.toHaveBeenCalled();
  });

  it('korisnik s attachment:view može doći do autentifikovanog sadržaja', async () => {
    const response = await fetch(`${baseUrl}/attachments/${ATTACHMENT_ID}/content`, {
      headers: { 'x-sweep-role': 'OBICNI_KORISNIK' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    await expect(response.text()).resolves.toBe('secret');
    expect(service.content).toHaveBeenCalledOnce();
  });
});
