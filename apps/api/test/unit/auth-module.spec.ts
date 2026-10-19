import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { __resetEnvCache } from '../../src/config/env.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { PASSWORD_BLOCKLIST, PasswordService } from '../../src/modules/auth/services/password.service.js';
import { TokenService } from '../../src/modules/auth/services/token.service.js';

/**
 * DI smoke testovi za `AuthModule` (Faza 1).
 *
 * Cilj: dokazati da se servisi za autentifikaciju mogu konstruisati kroz Nest
 * kontejner (bez ručnog `new`) — posebno da `@Optional()` blocklista ne lomi
 * instanciranje i da `TokenService` radi s ENV-om iz profila `test`.
 */

const ACCESS_SECRET = 'di-test-access-secret-0123456789abcdef0123456789';
let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  __resetEnvCache();
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = savedSecret;
  __resetEnvCache();
});

describe('AuthModule — dependency injection', () => {
  it('rezolvuje PasswordService i TokenService bez neriješenih zavisnosti', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();

    const passwordService = moduleRef.get(PasswordService);
    const tokenService = moduleRef.get(TokenService);

    expect(passwordService).toBeInstanceOf(PasswordService);
    expect(tokenService).toBeInstanceOf(TokenService);

    await moduleRef.close();
  });

  it('krajnji tok kroz DI: hash → verify → sign → verify access tokena', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    const passwordService = moduleRef.get(PasswordService);
    const tokenService = moduleRef.get(TokenService);

    const password = passwordService.randomPassword();
    const hashed = await passwordService.hash(password);
    await expect(passwordService.verify(hashed, password)).resolves.toBe(true);

    const signed = tokenService.signAccessToken({
      userId: '018f0000-0000-7000-8000-0000000000a1',
      roles: ['Administrator'],
      tokenVersion: 1,
      permissionsVersion: 1,
      clientType: 'WEB',
      sessionId: '018f0000-0000-7000-8000-0000000000b2',
    });

    expect(tokenService.verifyAccessToken(signed.accessToken)).toMatchObject({
      sub: '018f0000-0000-7000-8000-0000000000a1',
      roles: ['Administrator'],
      ct: 'WEB',
    });

    await moduleRef.close();
  });

  it('provider PASSWORD_BLOCKLIST se poštuje (override bez izmjene koda servisa)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(PASSWORD_BLOCKLIST)
      .useValue(['mojaTajna'])
      .compile();

    const passwordService = moduleRef.get(PasswordService);

    expect(passwordService.validatePolicy('MojaTajna!2026').map((issue) => issue.code)).toContain(
      'common_password',
    );
    // Ugrađena lista i dalje važi.
    expect(passwordService.validatePolicy('Password123456!').map((issue) => issue.code)).toContain(
      'common_password',
    );

    await moduleRef.close();
  });

  it('default provider (prazna lista) ne mijenja ugrađenu blocklistu', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    const passwordService = moduleRef.get(PasswordService);

    expect(passwordService.validatePolicy('Kamion!Zima2026x')).toEqual([]);

    await moduleRef.close();
  });
});
