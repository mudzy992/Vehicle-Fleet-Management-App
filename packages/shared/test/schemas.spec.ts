import { describe, expect, it } from 'vitest';
import {
  CHANGE_PASSWORD_MIN_DIFFERENCE_MESSAGE,
  COMMON_PASSWORDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_CHARACTER_CLASSES,
  PASSWORD_MIN_LENGTH,
  changePasswordSchema,
  clientTypeSchema,
  deviceInfoSchema,
  forgotPasswordSchema,
  hasRepetitiveSequence,
  isClientTypeAllowed,
  isCommonPassword,
  loginSchema,
  logoutSchema,
  passwordCharacterClassCount,
  passwordPolicyIssues,
  passwordSchema,
  refreshSchema,
  resetPasswordSchema,
  archiveTaskTypeSchema,
  assignTaskSchema,
  cancelTaskSchema,
  claimTaskSchema,
  completeTaskSchema,
  createTaskSchema,
  createTaskTypeSchema,
  reopenTaskSchema,
  releaseTaskSchema,
  replaceTaskCompletionRequirementsSchema,
  taskAvailableQuerySchema,
  taskDetailSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  updateTaskSchema,
  taskCompletionRequirementInputSchema,
  taskCompletionRequirementsResponseSchema,
  taskTypeDetailSchema,
  taskTypeListQuerySchema,
  taskTypeListResponseSchema,
  updateTaskTypeSchema,
} from '../dist/schemas.js';
import { ROLE_ALLOWED_CLIENT_TYPES, SUPER_ADMIN_ROLE } from '../dist/index.js';
import * as envEntry from '../dist/env-schema.js';
import * as schemasEntry from '../dist/schemas.js';

/**
 * DTO šeme API ugovora (docs/07 §2.1) i politika lozinke (docs/05 §7).
 *
 * Ovi testovi čuvaju tri stvari:
 * 1. **T-11 (mass assignment):** DTO je `.strict()` → nepoznato polje = greška.
 * 2. **R-05:** nema 2FA polja.
 * 3. **N-05/P1:** `clientType` je dio login DTO-a i Super Admin je web-only.
 */

/** Jaka lozinka koja prolazi politiku (nije česta, nema sekvenci, 3+ klase). */
const STRONG = 'Kafana-7731-Lopta';
/** Lozinka koja je u listi najčešćih. */
const COMMON = 'lozinka123';

describe('politika lozinke (docs/05 §7)', () => {
  it('granice su min 12 / max 128 znakova i min 3 od 4 klase', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(PASSWORD_MIN_CHARACTER_CLASSES).toBe(3);
  });

  it('passwordCharacterClassCount broji mala/velika slova, cifre i simbole', () => {
    expect(passwordCharacterClassCount('abcdefghijkl')).toBe(1);
    expect(passwordCharacterClassCount('Abcdefghijkl')).toBe(2);
    expect(passwordCharacterClassCount('Abcdefghijk1')).toBe(3);
    expect(passwordCharacterClassCount('Abcdefghij1!')).toBe(4);
    expect(passwordCharacterClassCount('')).toBe(0);
  });

  it('isCommonPassword prepoznaje česte lozinke i varijante s ciframa', () => {
    expect(isCommonPassword('123456')).toBe(true);
    expect(isCommonPassword('Password')).toBe(true);
    expect(isCommonPassword('lozinka123')).toBe(true);
    // Varijanta "osnova + cifre": "Admin2026" → osnova "admin" je na listi.
    expect(isCommonPassword('Admin2026')).toBe(true);
    expect(isCommonPassword('šifra123')).toBe(true);
    expect(isCommonPassword(STRONG)).toBe(false);
    // Dodatna (organizacijska) blocklista se poštuje.
    expect(isCommonPassword('VozniPark2026', ['voznipark2026'])).toBe(true);
  });

  it('COMMON_PASSWORDS je normalizovan (mala slova, bez duplikata, bez praznina)', () => {
    const unique = new Set(COMMON_PASSWORDS);
    expect(unique.size).toBe(COMMON_PASSWORDS.length);
    for (const entry of COMMON_PASSWORDS) {
      expect(entry.length, entry).toBeGreaterThan(2);
      expect(entry, entry).toBe(entry.trim().toLowerCase());
    }
  });

  it('hasRepetitiveSequence hvata ponavljanje i sekvence od 6+ znakova', () => {
    expect(hasRepetitiveSequence('aaaaaa')).toBe(true);
    expect(hasRepetitiveSequence('abcdef')).toBe(true);
    expect(hasRepetitiveSequence('654321')).toBe(true);
    expect(hasRepetitiveSequence('aaaaa')).toBe(false);
    expect(hasRepetitiveSequence(STRONG)).toBe(false);
  });

  it('passwordPolicyIssues vraća razlog po problemu (poruke na bosanskom)', () => {
    expect(passwordPolicyIssues(STRONG)).toEqual([]);

    const short = passwordPolicyIssues('abcdef');
    expect(short.map((issue) => issue.code)).toContain('too_short');
    expect(short.map((issue) => issue.code)).toContain('insufficient_character_classes');

    const long = passwordPolicyIssues(`${STRONG}${'x'.repeat(PASSWORD_MAX_LENGTH)}`);
    expect(long.map((issue) => issue.code)).toContain('too_long');

    expect(passwordPolicyIssues(COMMON).map((issue) => issue.code)).toContain('common_password');
    expect(passwordPolicyIssues('aaaaaabbbbbbCCC1').map((issue) => issue.code)).toContain(
      'repetitive_sequence',
    );
    // Dvije klase (velika + mala slova) → ispod tražene 3.
    expect(passwordPolicyIssues('Abcdefghijkl').map((issue) => issue.code)).toContain(
      'insufficient_character_classes',
    );
  });

  it('passwordPolicyIssues odbija lozinke s ličnim podacima (e-mail, ime)', () => {
    const issues = passwordPolicyIssues('Ana-Anic-1977', {
      email: 'ana.anic@example.ba',
      firstName: 'Ana',
      lastName: 'Anic',
    });
    expect(issues.map((issue) => issue.code)).toContain('contains_personal_data');

    // Isti e-mail kao local-part → također odbijeno.
    const byEmail = passwordPolicyIssues('X7-ana.anic-99', {
      email: 'ana.anic@example.ba',
    });
    expect(byEmail.map((issue) => issue.code)).toContain('contains_personal_data');

    // Bez konteksta ista lozinka prolazi.
    expect(passwordPolicyIssues('Ana-Anic-1977')).toEqual([]);
  });

  it('passwordSchema (Zod) odbija slabu lozinku i navodi issueCode u params', () => {
    expect(passwordSchema.safeParse(STRONG).success).toBe(true);
    expect(passwordSchema.safeParse('kratka').success).toBe(false);

    const result = passwordSchema.safeParse(COMMON);
    expect(result.success).toBe(false);
    if (result.success) return;
    const codes = result.error.issues.map(
      (issue) => ((issue as { params?: { issueCode?: string } }).params ?? {}).issueCode,
    );
    expect(codes).toContain('common_password');
  });
});

describe('auth DTO šeme (docs/07 §2.1)', () => {
  it('loginSchema: e-mail se normalizuje na mala slova, clientType default WEB', () => {
    const parsed = loginSchema.parse({
      email: 'Ana.Anic@Example.ba',
      password: COMMON,
    });
    expect(parsed.email).toBe('ana.anic@example.ba');
    expect(parsed.clientType).toBe('WEB');
    expect(parsed.deviceInfo).toBeUndefined();
  });

  it('loginSchema prihvata mobilni clientType + deviceInfo (P1 provjera je na serveru)', () => {
    const parsed = loginSchema.parse({
      email: 'a@example.ba',
      password: 'x',
      clientType: 'MOBILE_ANDROID',
      deviceInfo: { model: 'Pixel 7', osVersion: '15', appVersion: '1.0.0' },
    });
    expect(parsed.clientType).toBe('MOBILE_ANDROID');
    expect(parsed.deviceInfo?.model).toBe('Pixel 7');
  });

  it('loginSchema NE primjenjuje politiku lozinke (stare lozinke moraju raditi)', () => {
    // Lozinka od 3 znaka je "slaba", ali pri loginu je legitiman pokušaj →
    // odbija se kao INVALID_CREDENTIALS, ne kao VALIDATION_ERROR.
    const parsed = loginSchema.parse({ email: 'a@example.ba', password: 'abc' });
    expect(parsed.password).toBe('abc');
    // Preduga lozinka se ipak odbija (DoS zaštita, max 128).
    expect(loginSchema.safeParse({ email: 'a@example.ba', password: 'a'.repeat(129) }).success).toBe(false);
  });

  it('T-11: DTO šeme su strict → nepoznato polje je greška', () => {
    expect(loginSchema.safeParse({ email: 'a@example.ba', password: 'abc', isAdmin: true }).success).toBe(
      false,
    );
    expect(refreshSchema.safeParse({ refreshToken: 'x'.repeat(40), roles: ['SUPER_ADMIN'] }).success).toBe(
      false,
    );
    expect(deviceInfoSchema.safeParse({ model: 'Pixel', imei: '123' }).success).toBe(false);
  });

  it('R-05: nijedan auth DTO ne poznaje 2FA polja', () => {
    for (const schema of [loginSchema, refreshSchema, logoutSchema, changePasswordSchema]) {
      const parsed = schema.safeParse({
        email: 'a@example.ba',
        password: 'abc',
        currentPassword: 'abc',
        newPassword: STRONG,
        twoFactorCode: '123456',
      });
      expect(parsed.success, '2FA polje ne smije proći').toBe(false);
    }
  });

  it('refreshSchema/logoutSchema: token je opciono (web koristi httpOnly cookie)', () => {
    expect(refreshSchema.parse({}).refreshToken).toBeUndefined();
    expect(refreshSchema.parse({ refreshToken: 'a'.repeat(64) }).refreshToken).toHaveLength(64);
    expect(refreshSchema.safeParse({ refreshToken: 'kratko' }).success).toBe(false);
    expect(logoutSchema.parse({}).refreshToken).toBeUndefined();
  });

  it('changePasswordSchema traži jaku novu lozinku različitu od trenutne', () => {
    expect(
      changePasswordSchema.parse({ currentPassword: 'stara-lozinka-1', newPassword: STRONG }).newPassword,
    ).toBe(STRONG);

    const same = changePasswordSchema.safeParse({
      currentPassword: STRONG,
      newPassword: STRONG,
    });
    expect(same.success).toBe(false);
    if (!same.success) {
      expect(same.error.issues[0]?.message).toBe(CHANGE_PASSWORD_MIN_DIFFERENCE_MESSAGE);
      expect(same.error.issues[0]?.path).toEqual(['newPassword']);
    }

    expect(changePasswordSchema.safeParse({ currentPassword: 'stara', newPassword: COMMON }).success).toBe(
      false,
    );
  });

  it('forgotPasswordSchema i resetPasswordSchema (jednokratni token)', () => {
    expect(forgotPasswordSchema.parse({ email: 'A@Example.ba' }).email).toBe('a@example.ba');
    expect(forgotPasswordSchema.safeParse({ email: 'nije-email' }).success).toBe(false);
    expect(resetPasswordSchema.parse({ token: 'a'.repeat(32), newPassword: STRONG }).newPassword).toBe(
      STRONG,
    );
    expect(resetPasswordSchema.safeParse({ token: 'kratak', newPassword: STRONG }).success).toBe(false);
  });

  it('clientTypeSchema prihvata tačno CLIENT_TYPES iz @vfm/shared', () => {
    for (const value of ['WEB', 'MOBILE_ANDROID', 'MOBILE_IOS', 'SERVICE']) {
      expect(clientTypeSchema.parse(value)).toBe(value);
    }
    expect(clientTypeSchema.safeParse('DESKTOP').success).toBe(false);
    expect(clientTypeSchema.safeParse('').success).toBe(false);
  });

  it('isClientTypeAllowed: Super Admin je web-only (N-05/P1)', () => {
    const allowed = ROLE_ALLOWED_CLIENT_TYPES[SUPER_ADMIN_ROLE];
    expect(isClientTypeAllowed('WEB', allowed)).toBe(true);
    expect(isClientTypeAllowed('MOBILE_ANDROID', allowed)).toBe(false);
    expect(isClientTypeAllowed('MOBILE_IOS', allowed)).toBe(false);

    const normal = ROLE_ALLOWED_CLIENT_TYPES.OBICNI_KORISNIK;
    expect(isClientTypeAllowed('MOBILE_ANDROID', normal)).toBe(true);
    expect(isClientTypeAllowed('SERVICE', [])).toBe(false);
  });
});

describe('vrste zadataka i zahtjevi završetka (docs/07 §7.6)', () => {
  const taskTypeId = '11111111-1111-4111-8111-111111111111';
  const formSchemaId = '22222222-2222-4222-8222-222222222222';
  const requirementId = '33333333-3333-4333-8333-333333333333';

  it('kreiranje primjenjuje defaultove i normalizuje boju', () => {
    const parsed = createTaskTypeSchema.parse({
      code: ' DELIVERY ',
      name: ' Dostava dokumentacije ',
      colorHex: '#abc123',
      formSchemaId,
    });

    expect(parsed).toMatchObject({
      code: 'DELIVERY',
      name: 'Dostava dokumentacije',
      colorHex: '#ABC123',
      requiresVehicle: true,
      requiresOdometer: false,
      requiresPhotos: false,
      defaultPriority: 'NORMAL',
      defaultAssignMode: 'OPEN_CLAIM',
      allowMultipleClaimants: false,
      sortOrder: 100,
      formSchemaId,
    });
  });

  it('kreiranje odbija neispravan kod/boju/rok, kilometražu bez vozila i nepoznata polja', () => {
    const base = { code: 'TEST_TYPE', name: 'Test vrsta' };
    for (const patch of [
      { code: 'niska_slova' },
      { code: 'A' },
      { name: 'x' },
      { colorHex: 'plava' },
      { dueOffsetHours: 0 },
      { dueOffsetHours: 8761 },
      { sortOrder: 10001 },
      { requiresVehicle: false, requiresOdometer: true },
      { active: false },
      { formSchemaId: 'nije-uuid' },
    ]) {
      expect(createTaskTypeSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
  });

  it('PATCH je djelimičan, dozvoljava null brisanje i odbija prazan zahtjev ili novi kod', () => {
    expect(
      updateTaskTypeSchema.parse({
        description: null,
        colorHex: '#00aa55',
        requiresVehicle: false,
        requiresOdometer: false,
        dueOffsetHours: null,
        formSchemaId: null,
      }),
    ).toEqual({
      description: null,
      colorHex: '#00AA55',
      requiresVehicle: false,
      requiresOdometer: false,
      dueOffsetHours: null,
      formSchemaId: null,
    });
    expect(updateTaskTypeSchema.safeParse({}).success).toBe(false);
    expect(updateTaskTypeSchema.safeParse({ code: 'NOVI_KOD' }).success).toBe(false);
    expect(updateTaskTypeSchema.safeParse({ requiresVehicle: false, requiresOdometer: true }).success).toBe(
      false,
    );
  });

  it('arhiva i lista prihvataju samo dokumentovane query vrijednosti', () => {
    expect(archiveTaskTypeSchema.parse({})).toEqual({});
    expect(archiveTaskTypeSchema.parse({ reason: ' Više se ne koristi ' }).reason).toBe('Više se ne koristi');
    expect(archiveTaskTypeSchema.safeParse({ reason: 'x' }).success).toBe(false);
    expect(archiveTaskTypeSchema.safeParse({ force: true }).success).toBe(false);

    expect(
      taskTypeListQuerySchema.parse({
        q: 'pranje',
        activeOnly: 'true',
        requiresVehicle: 'false',
        page: '2',
        pageSize: '10',
        sortBy: 'name',
        sortOrder: 'desc',
      }),
    ).toMatchObject({
      q: 'pranje',
      activeOnly: true,
      requiresVehicle: false,
      page: 2,
      pageSize: 10,
      sortBy: 'name',
      sortOrder: 'desc',
    });
    expect(taskTypeListQuerySchema.safeParse({ activeOnly: 'yes' }).success).toBe(false);
    expect(taskTypeListQuerySchema.safeParse({ includeArchived: 'true' }).success).toBe(false);
  });

  it('zahtjev završetka ima defaultove i odbija fotografije u opcionalnom zahtjevu', () => {
    expect(taskCompletionRequirementInputSchema.parse({ fieldKey: ' photosAfter ' })).toEqual({
      fieldKey: 'photosAfter',
      required: true,
      stage: 'ON_COMPLETE',
      minPhotos: 0,
    });
    expect(taskCompletionRequirementInputSchema.safeParse({ fieldKey: 'PhotosAfter' }).success).toBe(false);
    expect(
      taskCompletionRequirementInputSchema.safeParse({
        fieldKey: 'photosAfter',
        required: false,
        minPhotos: 1,
      }).success,
    ).toBe(false);
    expect(
      taskCompletionRequirementInputSchema.safeParse({ fieldKey: 'photosAfter', minPhotos: 21 }).success,
    ).toBe(false);
  });

  it('zamjena zahtjeva odbija dupli ključ, a odgovori ostaju strict', () => {
    expect(replaceTaskCompletionRequirementsSchema.parse({ requirements: [] })).toEqual({
      requirements: [],
    });
    expect(
      replaceTaskCompletionRequirementsSchema.safeParse({
        requirements: [{ fieldKey: 'photosAfter' }, { fieldKey: 'photosAfter' }],
      }).success,
    ).toBe(false);

    const requirement = {
      id: requirementId,
      taskTypeId,
      fieldKey: 'photosAfter',
      required: true,
      stage: 'ON_COMPLETE',
      minPhotos: 2,
    };
    expect(
      taskCompletionRequirementsResponseSchema.parse({ taskTypeId, requirements: [requirement] })
        .requirements,
    ).toEqual([requirement]);

    const view = {
      id: taskTypeId,
      code: 'WASH',
      name: 'Pranje vozila',
      description: null,
      iconName: 'car-wash',
      colorHex: '#2563EB',
      requiresVehicle: true,
      requiresOdometer: false,
      requiresPhotos: true,
      defaultPriority: 'NORMAL',
      defaultAssignMode: 'OPEN_CLAIM',
      allowMultipleClaimants: false,
      dueOffsetHours: 24,
      formSchemaId,
      formSchemaKey: 'pranje_vozila',
      formSchemaName: 'Pranje vozila',
      formSchemaVersion: 1,
      active: true,
      sortOrder: 10,
      completionRequirementCount: 1,
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z',
    };
    expect(taskTypeDetailSchema.parse({ ...view, completionRequirements: [requirement] })).toMatchObject({
      code: 'WASH',
    });
    expect(
      taskTypeListResponseSchema.parse({ items: [view], page: 1, pageSize: 25, total: 1, totalPages: 1 })
        .items,
    ).toHaveLength(1);
    expect(
      taskTypeDetailSchema.safeParse({ ...view, completionRequirements: [], deletedAt: null }).success,
    ).toBe(false);
  });
});

describe('zadaci (docs/07 §2.11)', () => {
  const taskId = '11111111-1111-4111-8111-111111111111';
  const taskTypeId = '22222222-2222-4222-8222-222222222222';
  const vehicleId = '33333333-3333-4333-8333-333333333333';
  const invitedId = '44444444-4444-4444-8444-444444444444';
  const observerId = '55555555-5555-4555-8555-555555555555';
  const assigneeId = '66666666-6666-4666-8666-666666666666';
  const formSchemaId = '77777777-7777-4777-8777-777777777777';
  const formSchemaVersionId = '88888888-8888-4888-8888-888888888888';

  it('kreiranje trimuje tekst, daje prazne liste/formu i čuva direktnog izvršioca', () => {
    const open = createTaskSchema.parse({
      taskTypeId,
      vehicleId,
      title: '  Pranje vozila  ',
      description: '  Vanjsko pranje  ',
      invitedUserIds: [invitedId],
      observerUserIds: [observerId],
    });
    expect(open).toMatchObject({
      title: 'Pranje vozila',
      description: 'Vanjsko pranje',
      invitedUserIds: [invitedId],
      observerUserIds: [observerId],
      formData: {},
    });

    const direct = createTaskSchema.parse({ taskTypeId, assigneeUserId: assigneeId });
    expect(direct.assignMode).toBeUndefined();
    expect(direct.assigneeUserId).toBe(assigneeId);
    expect(direct.invitedUserIds).toEqual([]);
  });

  it('kreiranje odbija duplikate, preklapanja uloga i nespojive načine dodjele', () => {
    const base = { taskTypeId };
    for (const patch of [
      { invitedUserIds: [invitedId, invitedId] },
      { observerUserIds: [observerId, observerId] },
      { invitedUserIds: [invitedId], observerUserIds: [invitedId] },
      { assigneeUserId: assigneeId, invitedUserIds: [invitedId] },
      { assigneeUserId: assigneeId, observerUserIds: [assigneeId] },
      { assignMode: 'ASSIGN_DIRECT' },
      { assignMode: 'OPEN_CLAIM', assigneeUserId: assigneeId },
      { assignMode: 'BROADCAST', invitedUserIds: [invitedId] },
      { title: 'x' },
      { dueAt: 'nije-datum' },
      { status: 'COMPLETED' },
    ]) {
      expect(createTaskSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
  });

  it('PATCH, otkazivanje i reopen nose CAS verziju i ne primaju serverska polja', () => {
    expect(updateTaskSchema.parse({ version: 2, title: ' Novi naslov ', dueAt: null })).toEqual({
      version: 2,
      title: 'Novi naslov',
      dueAt: null,
    });
    expect(updateTaskSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 2, status: 'CANCELLED' }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: -1, title: 'Naslov' }).success).toBe(false);

    expect(cancelTaskSchema.parse({ version: 0, reason: ' Vozilo je na servisu ' })).toEqual({
      version: 0,
      reason: 'Vozilo je na servisu',
    });
    expect(cancelTaskSchema.safeParse({ version: 0, reason: 'x' }).success).toBe(false);
    expect(reopenTaskSchema.parse({ version: 3 })).toEqual({ version: 3 });
    expect(reopenTaskSchema.safeParse({ version: 3, status: 'OPEN' }).success).toBe(false);
    expect(releaseTaskSchema.parse({ version: 4, reason: '  Druga ekipa  ' })).toEqual({
      version: 4,
      reason: 'Druga ekipa',
    });
    expect(releaseTaskSchema.safeParse({ version: 4, reason: 'x' }).success).toBe(false);
    expect(releaseTaskSchema.safeParse({ version: 4, status: 'OPEN' }).success).toBe(false);
    expect(assignTaskSchema.parse({ version: 5, mode: 'ASSIGN_DIRECT', userIds: [assigneeId] })).toEqual({
      version: 5,
      mode: 'ASSIGN_DIRECT',
      userIds: [assigneeId],
    });
    expect(assignTaskSchema.safeParse({ version: 5, mode: 'ASSIGN_DIRECT', userIds: [] }).success).toBe(
      false,
    );
    expect(assignTaskSchema.safeParse({ version: 5, mode: 'BROADCAST', userIds: [assigneeId] }).success).toBe(
      false,
    );
    expect(
      assignTaskSchema.safeParse({ version: 5, mode: 'OPEN_CLAIM', userIds: [assigneeId, assigneeId] })
        .success,
    ).toBe(false);
    expect(
      assignTaskSchema.safeParse({ version: 5, mode: 'OPEN_CLAIM', userIds: [], assignMode: 'OPEN_CLAIM' })
        .success,
    ).toBe(false);
  });

  it('lista parsira filtere i odbija obrnut interval roka', () => {
    expect(
      taskListQuerySchema.parse({
        status: 'OPEN',
        vehicleId,
        taskTypeId,
        mine: 'true',
        overdueOnly: 'false',
        dueFrom: '2026-10-21T00:00:00Z',
        dueTo: '2026-10-22T00:00:00Z',
        page: '2',
      }),
    ).toMatchObject({ status: 'OPEN', mine: true, overdueOnly: false, page: 2 });
    expect(
      taskListQuerySchema.safeParse({
        dueFrom: '2026-10-22T00:00:00Z',
        dueTo: '2026-10-21T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(taskListQuerySchema.safeParse({ includeDeleted: 'true' }).success).toBe(false);
  });

  it('claim prima samo opcioni nacrt forme, a available query ne prima serverski status', () => {
    expect(claimTaskSchema.parse({})).toEqual({ formData: {} });
    expect(claimTaskSchema.parse({ formData: { washType: 'FULL' } })).toEqual({
      formData: { washType: 'FULL' },
    });
    expect(claimTaskSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(claimTaskSchema.safeParse({ assigneeUserId: assigneeId }).success).toBe(false);

    expect(
      taskAvailableQuerySchema.parse({
        vehicleId,
        taskTypeId,
        priority: 'HIGH',
        overdueOnly: 'true',
        dueFrom: '2026-10-21T00:00:00Z',
        dueTo: '2026-10-22T00:00:00Z',
        page: '3',
      }),
    ).toMatchObject({ priority: 'HIGH', overdueOnly: true, page: 3 });
    expect(taskAvailableQuerySchema.safeParse({ status: 'OPEN' }).success).toBe(false);
    expect(taskAvailableQuerySchema.safeParse({ mine: 'true' }).success).toBe(false);
    expect(
      taskAvailableQuerySchema.safeParse({
        dueFrom: '2026-10-22T00:00:00Z',
        dueTo: '2026-10-21T00:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('završetak nosi CAS verziju, završnu formu, priloge, komentar i kilometražu', () => {
    const attachmentId = '99999999-9999-4999-8999-999999999999';
    expect(completeTaskSchema.parse({ version: 4 })).toEqual({
      version: 4,
      formData: {},
      attachmentIds: [],
    });
    expect(
      completeTaskSchema.parse({
        version: 5,
        formData: { photosAfter: [attachmentId] },
        attachmentIds: [attachmentId],
        comment: '  Završeno  ',
        odometerKm: 148230,
        reason: '  Provjereno na terenu  ',
      }),
    ).toEqual({
      version: 5,
      formData: { photosAfter: [attachmentId] },
      attachmentIds: [attachmentId],
      comment: 'Završeno',
      odometerKm: 148230,
      reason: 'Provjereno na terenu',
    });

    for (const patch of [
      {},
      { version: -1 },
      { version: 1, formValues: {} },
      { version: 1, status: 'COMPLETED' },
      { version: 1, completedById: assigneeId },
      { version: 1, attachmentIds: [attachmentId, attachmentId] },
      { version: 1, odometerKm: -1 },
      { version: 1, odometerKm: 1.5 },
      { version: 1, reason: 'x' },
    ]) {
      expect(completeTaskSchema.safeParse(patch).success).toBe(false);
    }
  });

  it('odgovori zadatka su strict i nose snapshot forme, dodjele i događaje', () => {
    const detail = {
      id: taskId,
      code: 'Z-2026-000001',
      title: 'Pranje vozila',
      description: null,
      vehicleId,
      vehicleInternalNo: 'V-001',
      vehicleMake: 'Škoda',
      vehicleModel: 'Octavia',
      vehiclePlateNumber: 'A01-A-001',
      taskTypeId,
      taskTypeCode: 'WASH',
      taskTypeName: 'Pranje vozila',
      taskTypeIconName: 'car-wash',
      taskTypeColorHex: '#2563EB',
      priority: 'NORMAL',
      status: 'OPEN',
      assignMode: 'OPEN_CLAIM',
      createdById: observerId,
      createdByName: 'Amina Administrator',
      assigneeUserId: null,
      assigneeName: null,
      claimedAt: null,
      completedAt: null,
      completedById: null,
      dueAt: '2026-10-22T10:00:00.000Z',
      dueDate: '2026-10-22',
      isOverdue: false,
      cancelledAt: null,
      cancelReason: null,
      reopenedAt: null,
      releasedAt: null,
      durationMinutes: null,
      odometerKm: null,
      totalCost: null,
      fuelLiters: null,
      fuelAmount: null,
      fuelConsumptionL100: null,
      formSchemaId,
      formSchemaKey: 'pranje_vozila',
      formSchemaName: 'Pranje vozila',
      formSchemaVersionId,
      formSchemaVersion: 1,
      version: 0,
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z',
      formData: { washType: 'FULL' },
      assignments: [
        {
          id: formSchemaVersionId,
          userId: invitedId,
          userName: 'Emina Pozvana',
          role: 'INVITED',
          assignedById: observerId,
          assignedAt: '2026-10-21T10:00:00.000Z',
          revokedAt: null,
          note: null,
        },
      ],
      events: [
        {
          id: formSchemaId,
          action: 'CREATED',
          actorId: observerId,
          actorName: 'Amina Administrator',
          actorRole: 'ADMINISTRATOR',
          at: '2026-10-21T10:00:00.000Z',
          clientType: 'WEB',
          requestId: 'req-1',
          data: { code: 'Z-2026-000001' },
          formSchemaVersionId,
        },
      ],
      attachmentIds: [],
      commentCount: 0,
    };

    expect(taskDetailSchema.parse(detail).assignments).toHaveLength(1);
    const {
      formData: _formData,
      assignments: _assignments,
      events: _events,
      attachmentIds: _attachmentIds,
      commentCount: _commentCount,
      ...view
    } = detail;
    expect(
      taskListResponseSchema.parse({ items: [view], page: 1, pageSize: 25, total: 1, totalPages: 1 }).items,
    ).toHaveLength(1);
    expect(taskDetailSchema.safeParse({ ...detail, deletedAt: null }).success).toBe(false);
  });
});

describe('@vfm/shared/env i dalje izvozi API-ugovor šeme (kompatibilnost)', () => {
  // Napomena: poredi se **ponašanje**, ne identitet objekta — vitest učita dist
  // module kroz dva različita zapisa u module graphu, pa `toBe` nije pouzdan.
  // U običnom Node-u (`require`) identitet jeste zadovoljen.
  const pairs: [string, keyof typeof envEntry, keyof typeof schemasEntry][] = [
    ['passwordSchema', 'passwordSchema', 'passwordSchema'],
    ['emailSchema', 'emailSchema', 'emailSchema'],
    ['paginationQuerySchema', 'paginationQuerySchema', 'paginationQuerySchema'],
    ['plateSchema', 'plateSchema', 'plateSchema'],
    ['uuidSchema', 'uuidSchema', 'uuidSchema'],
    ['locationSchema', 'locationSchema', 'locationSchema'],
    ['requestIdSchema', 'requestIdSchema', 'requestIdSchema'],
  ];

  it('obje ulazne tačke izvoze iste šeme', () => {
    for (const [name, envKey, schemaKey] of pairs) {
      expect(envEntry[envKey], `${name} nedostaje u @vfm/shared/env`).toBeDefined();
      expect(schemasEntry[schemaKey], `${name} nedostaje u @vfm/shared/schemas`).toBeDefined();
    }
    expect(envEntry.SORT_ORDERS).toEqual(schemasEntry.SORT_ORDERS);
  });

  it('šeme se ponašaju identično na istim ulazima', () => {
    const samples: unknown[] = [
      'a@example.ba',
      'A@EXAMPLE.BA',
      'nije-email',
      STRONG,
      COMMON,
      'kratka',
      { page: '2', pageSize: '50', sortOrder: 'desc' },
      { page: 0 },
      'T12-E-456',
      'XX',
      '3f2b7a1e-0000-4000-8000-000000000000',
      'nije-uuid',
    ];
    for (const [, envKey, schemaKey] of pairs) {
      const fromEnv = envEntry[envKey] as { safeParse(value: unknown): { success: boolean } };
      const fromSchemas = schemasEntry[schemaKey] as {
        safeParse(value: unknown): { success: boolean };
      };
      for (const sample of samples) {
        expect(fromEnv.safeParse(sample).success, `${String(envKey)} ↔ ${JSON.stringify(sample)}`).toBe(
          fromSchemas.safeParse(sample).success,
        );
      }
    }
  });
});
