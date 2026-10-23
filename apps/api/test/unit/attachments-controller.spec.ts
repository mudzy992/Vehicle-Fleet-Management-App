import { describe, expect, it, vi } from 'vitest';
import { AttachmentsController } from '../../src/modules/attachments/attachments.controller.js';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from '../../src/common/decorators/auth.decorators.js';

vi.mock('../../src/prisma/prisma.service.js', () => ({ PrismaService: class PrismaService {} }));

describe('AttachmentsController — P14 pristup sadržaju', () => {
  it('potpisani sadržaj nije javna ruta i zahtijeva attachment:view', () => {
    const handler = AttachmentsController.prototype.signedContent;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual({
      permissions: ['attachment:view'],
      mode: 'ALL',
      scope: 'OWN',
    });
  });
});
