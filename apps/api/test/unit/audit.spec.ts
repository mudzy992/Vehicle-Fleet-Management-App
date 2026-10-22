import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from '../../src/common/interceptors/audit.interceptor.js';
import { Audit } from '../../src/common/decorators/auth.decorators.js';
import {
  LoggingAuditSink,
  REDACTED_VALUE,
  AuditContext,
  buildAuditDiff,
  redactRecord,
  severityForError,
  type AuditRecord,
  type AuditSink,
} from '../../src/common/audit/audit.types.js';
import { VfmErrors, VfmException } from '../../src/common/errors/vfm-error.js';
import {
  FakeResponse,
  USER_ADMIN,
  authenticatedUser,
  fakeExecutionContext,
  fakeRequest,
} from '../helpers/rbac-fakes.js';
import type { VfmRequest } from '../../src/common/types/authenticated-user.js';

/**
 * Audit diff + `AuditInterceptor` (docs/05 §9).
 *
 * Ključna svojstva:
 * - bilježe se samo rute s `@Audit`, ali i **odbijeni** zahtjevi na njima,
 * - osjetljiva polja (lozinke, hashovi, tokeni) se redaktuju iz obje strane,
 * - diff sadrži samo stvarne promjene,
 * - greška audit sink-a nikad ne utiče na odgovor.
 */

/** Controller s audit metadata (stvarni dekoratori → stvarni `Reflector`). */
class RolesController {
  @Audit('ROLE_CHANGE', { resource: 'Role' })
  updateMatrix(): void {}

  @Audit('PERMISSION_CHANGE', { severity: 'SECURITY', resource: 'Role' })
  changePermissions(): void {}

  @Audit('EXPORT', { resource: 'Report' })
  export(): void {}

  @Audit('CREATE')
  bezResursa(): void {}

  bezAudita(): void {}
}

/** Sink koji bilježi zapise. */
class RecordingSink implements AuditSink {
  readonly records: AuditRecord[] = [];

  record(entry: AuditRecord): void {
    this.records.push(entry);
  }

  get last(): AuditRecord | undefined {
    return this.records[this.records.length - 1];
  }
}

/** Sink koji baca — audit ne smije srušiti zahtjev. */
class BrokenSink implements AuditSink {
  record(): never {
    throw new Error('AuditLog upis nije uspio (simulacija)');
  }
}

function contextFor(method: keyof RolesController, request: VfmRequest, interceptor: AuditInterceptor) {
  return {
    context: fakeExecutionContext({
      handler: RolesController.prototype[method] as (...args: never[]) => unknown,
      controller: RolesController,
      request,
      response: new FakeResponse(),
    }),
    interceptor,
  };
}

describe('buildAuditDiff', () => {
  it('vrati samo stvarno promijenjena polja (sortirana)', () => {
    const diff = buildAuditDiff(
      { name: 'Administrator', permissionsVersion: 3, active: true },
      { name: 'Administrator', permissionsVersion: 4, active: true },
    );

    expect(diff).toEqual([{ field: 'permissionsVersion', before: 3, after: 4 }]);
  });

  it('nema promjena → prazna lista', () => {
    expect(buildAuditDiff({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toEqual([]);
  });

  it('dodana i uklonjena polja se bilježe (null za nedostajuću stranu)', () => {
    const diff = buildAuditDiff({ kept: 1, removed: 'x' }, { kept: 1, added: true });

    expect(diff).toEqual([
      { field: 'added', before: null, after: true },
      { field: 'removed', before: 'x', after: null },
    ]);
  });

  it('null i undefined se ne tretiraju kao promjena', () => {
    expect(buildAuditDiff({ a: null }, {})).toEqual([]);
    expect(buildAuditDiff({}, { a: undefined })).toEqual([]);
  });

  it('Date i ISO string istog trenutka → bez promjene', () => {
    const at = '2026-10-19T10:00:00.000Z';

    expect(buildAuditDiff({ expiresAt: new Date(at) }, { expiresAt: at })).toEqual([]);
    expect(
      buildAuditDiff({ expiresAt: new Date(at) }, { expiresAt: new Date('2026-10-20T10:00:00Z') }),
    ).toHaveLength(1);
  });

  it('ugniježđeni objekti i nizovi se porede po sadržaju', () => {
    expect(buildAuditDiff({ meta: { a: 1 } }, { meta: { a: 1 } })).toEqual([]);
    expect(buildAuditDiff({ ids: ['a', 'b'] }, { ids: ['a', 'b'] })).toEqual([]);
    expect(buildAuditDiff({ ids: ['a', 'b'] }, { ids: ['a'] })).toEqual([
      { field: 'ids', before: ['a', 'b'], after: ['a'] },
    ]);
  });

  it('osjetljiva polja se redaktuju s obje strane → ne pojavljuju se u diffu', () => {
    const diff = buildAuditDiff(
      { email: 'a@firma.ba', passwordHash: '$argon2id$stari' },
      { email: 'a@firma.ba', passwordHash: '$argon2id$novi' },
    );

    expect(diff).toEqual([]);
  });

  it('bez before/after → prazna lista', () => {
    expect(buildAuditDiff(undefined, undefined)).toEqual([]);
  });
});

describe('redactRecord', () => {
  it('redaktuje lozinke, hasheve i tokene (case-insensitively)', () => {
    const redacted = redactRecord({
      email: 'admin@firma.ba',
      password: 'Sifra!Vfm2026',
      PasswordHash: '$argon2id$x',
      refreshToken: 'tok',
      tokenHash: 'abc',
    });

    expect(redacted).toMatchObject({
      email: 'admin@firma.ba',
      password: REDACTED_VALUE,
      PasswordHash: REDACTED_VALUE,
      refreshToken: REDACTED_VALUE,
      tokenHash: REDACTED_VALUE,
    });
  });

  it('redaktuje osjetljiva polja i unutar ugniježđenih objekata i nizova', () => {
    expect(
      redactRecord({
        result: { refreshToken: 'refresh-secret', nested: [{ access_token: 'access-secret' }] },
      }),
    ).toEqual({
      result: {
        refreshToken: REDACTED_VALUE,
        nested: [{ access_token: REDACTED_VALUE }],
      },
    });
  });

  it('undefined/null prolaze nepromijenjeni', () => {
    expect(redactRecord(undefined)).toBeUndefined();
  });
});

describe('severityForError', () => {
  it('sigurnosno relevantni kodovi → SECURITY', () => {
    expect(severityForError('PERMISSION_DENIED')).toBe('SECURITY');
    expect(severityForError('SCOPE_DENIED')).toBe('SECURITY');
    expect(severityForError('MOBILE_ACCESS_FORBIDDEN')).toBe('SECURITY');
    expect(severityForError('TOKEN_REVOKED')).toBe('SECURITY');
  });

  it('validacija i istek tokena → WARN', () => {
    expect(severityForError('VALIDATION_ERROR')).toBe('WARN');
    expect(severityForError('UNKNOWN_FIELD')).toBe('WARN');
    expect(severityForError('TOKEN_EXPIRED')).toBe('WARN');
  });

  it('nepoznat kod → WARN (ne puca)', () => {
    expect(severityForError('NEKI_BUDUCI_KOD')).toBe('WARN');
  });
});

describe('AuditContext', () => {
  it('vezan je za request (isti primjerak pri ponovnom pozivu)', () => {
    const request = fakeRequest({});

    const first = AuditContext.from(request);
    const second = AuditContext.from(request);

    expect(first).toBe(second);
  });

  it('setBefore/setEntityId/setResource/set su ulančani i čitljivi', () => {
    const request = fakeRequest({});

    const context = AuditContext.from(request)
      .setBefore({ name: 'stari' })
      .setEntityId('role-1')
      .setResource('Role')
      .set('permissionsVersion', 7);

    expect(context.before).toEqual({ name: 'stari' });
    expect(context.entityId).toBe('role-1');
    expect(context.resource).toBe('Role');
    expect(context.meta).toEqual({ permissionsVersion: 7 });
  });
});

describe('AuditInterceptor — uspješne akcije', () => {
  it('ruta bez @Audit se ne bilježi', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({ user: authenticatedUser() });
    const { context } = contextFor('bezAudita', request, interceptor);

    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => of({ id: 'x' }) })),
    ).resolves.toEqual({ id: 'x' });

    expect(sink.records).toEqual([]);
  });

  it('@Audit ruta: bilježi akciju, korisnika, requestId, klijent i trajanje', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({
      id: 'req-audit-1',
      method: 'PUT',
      url: '/api/v1/roles/role-1/permissions',
      user: authenticatedUser({ id: USER_ADMIN, roles: ['ADMINISTRATOR'] }),
    });
    const { context } = contextFor('changePermissions', request, interceptor);

    const data = await firstValueFrom(
      interceptor.intercept(context, {
        handle: () => of({ id: 'role-1', permissionsVersion: 4 }),
      }),
    );

    expect(data).toEqual({ id: 'role-1', permissionsVersion: 4 });
    expect(sink.records).toHaveLength(1);
    expect(sink.last).toMatchObject({
      action: 'PERMISSION_CHANGE',
      severity: 'SECURITY',
      resource: 'Role',
      entityId: 'role-1',
      userId: USER_ADMIN,
      clientType: 'WEB',
      requestId: 'req-audit-1',
      method: 'PUT',
      path: '/api/v1/roles/role-1/permissions',
      success: true,
      after: { id: 'role-1', permissionsVersion: 4 },
    });
    expect(sink.last?.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof sink.last?.at).toBe('string');
  });

  it('before iz AuditContext-a → diff u meta (izmjena matrice prava)', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({ user: authenticatedUser() });
    AuditContext.from(request)
      .setBefore({ id: 'role-1', name: 'Administrator', permissionsVersion: 3 })
      .setEntityId('role-1');
    const { context } = contextFor('updateMatrix', request, interceptor);

    await firstValueFrom(
      interceptor.intercept(context, {
        handle: () => of({ id: 'role-1', name: 'Administrator', permissionsVersion: 4 }),
      }),
    );

    const record = sink.last as AuditRecord;
    expect(record.before).toEqual({ id: 'role-1', name: 'Administrator', permissionsVersion: 3 });
    expect(record.after).toEqual({ id: 'role-1', name: 'Administrator', permissionsVersion: 4 });
    expect(record.meta?.diff).toEqual([{ field: 'permissionsVersion', before: 3, after: 4 }]);
  });

  it('osjetljiva polja iz odgovora se redaktuju (reset lozinke)', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({ user: authenticatedUser() });
    const { context } = contextFor('updateMatrix', request, interceptor);

    await firstValueFrom(
      interceptor.intercept(context, {
        handle: () => of({ id: 'user-1', passwordHash: '$argon2id$tajna', resetToken: 'jednokratni' }),
      }),
    );

    expect(sink.last?.after).toMatchObject({
      id: 'user-1',
      passwordHash: REDACTED_VALUE,
      resetToken: REDACTED_VALUE,
    });
  });

  it('resource iz @Audit ima prednost; bez njega pada na naziv controllera', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({ user: authenticatedUser() });

    const withResource = contextFor('export', request, interceptor).context;
    await firstValueFrom(
      interceptor.intercept(withResource, { handle: () => of({ file: 'izvjestaj.pdf' }) }),
    );
    expect(sink.last?.resource).toBe('Report');

    const withoutResource = contextFor('bezResursa', request, interceptor).context;
    await firstValueFrom(interceptor.intercept(withoutResource, { handle: () => of({ id: 'x' }) }));
    expect(sink.last?.resource).toBe('Roles');
  });

  it('IP i User-Agent se bilježe (X-Forwarded-For prvi hop)', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    // Bez `ip` polja → interceptor čita `X-Forwarded-For` (nginx/Coolify proxy).
    const request: VfmRequest = {
      id: 'req-ip-1',
      method: 'PUT',
      url: '/api/v1/roles/role-1',
      headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0' },
      user: authenticatedUser(),
    };
    const { context } = contextFor('updateMatrix', request, interceptor);

    await firstValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }));

    expect(sink.last?.ip).toBe('198.51.100.7');
    expect(sink.last?.userAgent).toBe('Mozilla/5.0');
  });
});

describe('AuditInterceptor — odbijene akcije', () => {
  it('PERMISSION_DENIED se bilježi (success=false, SECURITY) i greška se propagira', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({ user: authenticatedUser() });
    const { context } = contextFor('changePermissions', request, interceptor);

    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () =>
            throwError(() => VfmErrors.permissionDenied([{ path: ['role:update'], message: 'ne' }])),
        }),
      ),
    ).rejects.toBeInstanceOf(VfmException);

    expect(sink.last).toMatchObject({
      action: 'PERMISSION_CHANGE',
      severity: 'SECURITY',
      success: false,
      errorCode: 'PERMISSION_DENIED',
      userId: USER_ADMIN,
    });
  });

  it('VALIDATION_ERROR → severity WARN (nije sigurnosni događaj)', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({ user: authenticatedUser() });
    const { context } = contextFor('updateMatrix', request, interceptor);

    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => VfmErrors.validationError([{ path: ['name'], message: 'ne' }])),
        }),
      ),
    ).rejects.toBeInstanceOf(VfmException);

    expect(sink.last?.severity).toBe('WARN');
    expect(sink.last?.errorCode).toBe('VALIDATION_ERROR');
  });

  it('bez @Audit nema zapisa ni pri grešci (sigurnosne događaje hvataju guard-ovi)', async () => {
    const sink = new RecordingSink();
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({ user: authenticatedUser() });
    const { context } = contextFor('bezAudita', request, interceptor);

    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => throwError(() => new Error('boom')) })),
    ).rejects.toThrow('boom');

    expect(sink.records).toEqual([]);
  });

  it('greška sink-a se guta — zahtjev prolazi (audit ne ruši API)', async () => {
    const interceptor = new AuditInterceptor(new Reflector(), new BrokenSink());
    const request = fakeRequest({ user: authenticatedUser() });
    const { context } = contextFor('updateMatrix', request, interceptor);

    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => of({ id: 'role-1' }) })),
    ).resolves.toEqual({ id: 'role-1' });
  });

  it('async sink: reject se ne propagira', async () => {
    const sink: AuditSink = { record: () => Promise.reject(new Error('DB nedostupan')) };
    const interceptor = new AuditInterceptor(new Reflector(), sink);
    const request = fakeRequest({ user: authenticatedUser() });
    const { context } = contextFor('updateMatrix', request, interceptor);

    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) })),
    ).resolves.toEqual({ ok: true });
  });
});

describe('LoggingAuditSink (default dok Prisma nije dostupna)', () => {
  it('ne baca ni za SECURITY ni za INFO zapise', () => {
    const sink = new LoggingAuditSink();

    expect(() =>
      sink.record({
        action: 'PERMISSION_CHANGE',
        severity: 'SECURITY',
        resource: 'Role',
        userId: USER_ADMIN,
        success: true,
        durationMs: 12,
        at: new Date().toISOString(),
      }),
    ).not.toThrow();

    expect(() =>
      sink.record({
        action: 'EXPORT',
        severity: 'INFO',
        success: false,
        errorCode: 'PERMISSION_DENIED',
        durationMs: 3,
        at: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});
