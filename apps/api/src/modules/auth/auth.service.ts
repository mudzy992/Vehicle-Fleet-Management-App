/**
 * `AuthService` — prijava, sesije, odjava i profil (docs/05 §5, docs/07 §7).
 *
 * Šta ovaj servis radi, i zašto baš tako:
 *
 * 1. **`login`** — provjera kredencijala (`argon2id`, `PasswordService`),
 *    zaključavanje nakon `AUTH_MAX_FAILED_ATTEMPTS` neuspjeha na
 *    `AUTH_LOCKOUT_MINUTES`, zatim **provjera tipa klijenta** (N-05/P1):
 *    Super Admin na mobilnom → `403 MOBILE_ACCESS_FORBIDDEN` + SECURITY_EVENT.
 *    Svaki pokušaj (uspješan ili ne) piše se u `AuthAttempt` (retencija 180 dana).
 * 2. **`refresh`** — rotacija: stari token se označi `revokedAt` + `replacedById`,
 *    novi se izda u **istoj porodici** (`familyId`). Ponovna upotreba već
 *    iskorištenog tokena = krađa → revokacija **svih** sesija korisnika,
 *    `tokenVersion++` (DB + Redis) i SECURITY_EVENT `REFRESH_REUSE_DETECTED`.
 * 3. **`logout`** — revokacija svih sesija + `tokenVersion++`, jer access token
 *    živi još do 10 min; bez bump-a bi ostao upotrebljiv (docs/05 §5.3).
 * 4. **`me`** — profil + **efektivna prava iz baze** (ne iz claimova), da web
 *    `usePermission()` radi i nakon revokacije.
 * 5. **`changePassword`** — provjera stare lozinke, politika za novu
 *    (`PasswordService.assertPolicy`), `mustChangePassword=false`,
 *    `tokenVersion++` i revokacija svih sesija (odjava na svim uređajima).
 *
 * HTTP je u kontroleru: servis vraća token + opcije cookie-ja, a kontroler ih
 * postavlja. Zato je servis testabilan bez Express-a.
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ClientType } from '@vfm/shared';
import { SUPER_ADMIN_ROLE } from '@vfm/shared';
import type {
  AuthTokenResponse,
  AuthUser,
  ChangePasswordInput,
  DeviceInfo,
  LoginInput,
  LogoutInput,
  RefreshInput,
} from '@vfm/shared/schemas';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import {
  SECURITY_EVENT_SINK,
  reportSecurityEvent,
  type SecurityEvent,
  type SecurityEventSink,
} from '../../common/audit/security-event.js';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PermissionsService } from './permissions/permissions.service.js';
import type { UserPermissionsSnapshot } from './permissions/permissions.types.js';
import type { UserStatus } from '@vfm/shared';
import { PasswordService } from './services/password.service.js';
import { TokenService, type RefreshCookieOptions } from './services/token.service.js';

/** Kontekst zahtjeva (IP, UA, `requestId`) — koristi se za audit i `AuthAttempt`. */
export interface AuthRequestContext {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string;
  readonly path?: string;
  readonly method?: string;
}

/** Rezultat prijave/rotacije: tijelo odgovora + refresh token za httpOnly cookie. */
export interface AuthSessionResult {
  /**
   * Tijelo odgovora (`authTokenResponseSchema`). Za mobilne klijente sadrži i
   * `refreshToken` (oni nemaju httpOnly cookie); za web **nikad**.
   */
  readonly response: AuthTokenResponse;
  /** Tip klijenta sesije — kontroler po njemu odlučuje da li postaviti cookie. */
  readonly clientType: ClientType;
  /** Sirovi refresh token (za cookie ili tijelo). */
  readonly refreshToken: string;
  readonly refreshCookieOptions: RefreshCookieOptions;
}

/** Jedna aktivna sesija (odgovor `GET /auth/sessions`). */
export interface ActiveSession {
  readonly id: string;
  readonly clientType: ClientType;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceInfo: DeviceInfo | null;
}

/** Razlog revokacije sesije (samo za logove — kolona `revokedReason` ne postoji). */
export type RevokeReason =
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'REFRESH_ROTATION'
  | 'REFRESH_REUSE'
  | 'SESSION_LIMIT'
  | 'ADMIN_FORCE_LOGOUT';

/** Kolone korisnika koje servisu trebaju (bez `passwordHash` u payload-u). */
const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  status: true,
  mustChangePassword: true,
  tokenVersion: true,
  timezone: true,
  locale: true,
  lastLoginAt: true,
  failedLoginCount: true,
  lockedUntil: true,
} as const;

/**
 * Polja korisnika koja servis koristi (strukturno kompatibilno s Prisma
 * rezultatima; `passwordHash` se nikad ne vraća u payload).
 */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
  readonly status: UserStatus;
  readonly mustChangePassword: boolean;
  readonly tokenVersion: number;
  /** Postavke prikaza (docs/07 §2.1 `/auth/me`: "… + postavke"). */
  readonly timezone: string;
  readonly locale: string;
  readonly lastLoginAt: Date | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    @Optional() @Inject(SECURITY_EVENT_SINK) private readonly securityEvents?: SecurityEventSink,
  ) {}

  // ---------------------------------------------------------------------------
  //  POST /auth/login
  // ---------------------------------------------------------------------------

  async login(input: LoginInput, context: AuthRequestContext = {}): Promise<AuthSessionResult> {
    const env = getEnv();
    const now = new Date();

    const user = await this.prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
      select: { ...USER_SELECT, passwordHash: true },
    });

    if (!user) {
      // Bez otkrivanja postojanja naloga: isti odgovor i isto trajanje.
      await this.passwords.equalizeTiming(input.password);
      await this.recordAttempt({
        email: input.email,
        userId: null,
        success: false,
        clientType: input.clientType,
        reason: 'UNKNOWN_USER',
        context,
      });
      this.report({
        type: 'LOGIN_FAILED',
        email: input.email,
        clientType: input.clientType,
        reason: 'UNKNOWN_USER',
        ...this.eventContext(context),
      });
      throw VfmErrors.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
      await this.recordAttempt({
        email: user.email,
        userId: user.id,
        success: false,
        clientType: input.clientType,
        reason: 'ACCOUNT_LOCKED',
        context,
      });
      this.report({
        type: 'ACCOUNT_LOCKED',
        userId: user.id,
        email: user.email,
        clientType: input.clientType,
        reason: 'ACCOUNT_LOCKED',
        ...this.eventContext(context),
      });
      throw VfmErrors.accountLocked(retryAfterSeconds);
    }

    if (user.status !== 'ACTIVE') {
      await this.recordAttempt({
        email: user.email,
        userId: user.id,
        success: false,
        clientType: input.clientType,
        reason: `STATUS_${user.status}`,
        context,
      });
      this.report({
        type: 'LOGIN_FAILED',
        userId: user.id,
        email: user.email,
        clientType: input.clientType,
        reason: `STATUS_${user.status}`,
        ...this.eventContext(context),
      });
      throw VfmErrors.accountInactive();
    }

    const passwordValid = await this.passwords.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      const failedLoginCount = user.failedLoginCount + 1;
      const locked = failedLoginCount >= env.AUTH_MAX_FAILED_ATTEMPTS;
      const lockedUntil = locked ? new Date(now.getTime() + env.AUTH_LOCKOUT_MINUTES * 60_000) : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount, lockedUntil },
      });

      await this.recordAttempt({
        email: user.email,
        userId: user.id,
        success: false,
        clientType: input.clientType,
        reason: locked ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
        context,
      });
      this.report({
        type: locked ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        userId: user.id,
        email: user.email,
        clientType: input.clientType,
        reason: locked
          ? `ZAKLJUCAN_NAKON_${failedLoginCount}_POKUSAJA`
          : `POGRESNA_LOZINKA_${failedLoginCount}`,
        ...this.eventContext(context),
      });

      throw locked
        ? VfmErrors.accountLocked(env.AUTH_LOCKOUT_MINUTES * 60)
        : VfmErrors.invalidCredentials();
    }

    const snapshot = await this.permissions.snapshot(user.id, { ignoreCache: true });
    if (!snapshot) {
      // Nalog je obrisan/uklonjen između čitanja korisnika i čitanja prava.
      throw VfmErrors.unauthenticated('Nalog više nije dostupan.');
    }

    // N-05 / P1: tip klijenta se provjerava pri prijavi I u guard-u po zahtjevu.
    this.assertClientTypeAllowed({
      snapshot,
      clientType: input.clientType,
      userId: user.id,
      email: user.email,
      context,
      attemptReason: 'CLIENT_TYPE_NOT_ALLOWED',
    });

    if (this.passwords.needsRehash(user.passwordHash)) {
      const upgraded = await this.passwords.hash(input.password);
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
      this.logger.log(`Hash lozinke korisnika ${user.id} nadograđen na trenutne parametre.`);
    }

    const session = await this.createSession({
      userId: user.id,
      clientType: input.clientType,
      deviceInfo: asDeviceInfo(input.deviceInfo),
      familyId: randomUUID(),
      context,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    await this.enforceMaxSessions(user.id, session.id);

    await this.recordAttempt({
      email: user.email,
      userId: user.id,
      success: true,
      clientType: input.clientType,
      reason: null,
      context,
    });

    return this.issueTokens({
      user,
      snapshot,
      session,
      clientType: input.clientType,
      lastLoginAt: now,
    });
  }

  // ---------------------------------------------------------------------------
  //  POST /auth/refresh — rotacija + reuse detection
  // ---------------------------------------------------------------------------

  async refresh(
    input: RefreshInput,
    context: AuthRequestContext = {},
    cookieToken?: string,
  ): Promise<AuthSessionResult> {
    const token = input.refreshToken ?? cookieToken;
    if (!token) {
      throw VfmErrors.unauthenticated('Nedostaje refresh token (httpOnly cookie ili tijelo zahtjeva).');
    }

    const tokenHash = await this.tokens.hashToken(token);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        clientType: true,
        deviceInfo: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!session) {
      this.report({
        type: 'TOKEN_REVOKED',
        clientType: input.clientType,
        reason: 'UNKNOWN_REFRESH_TOKEN',
        ...this.eventContext(context),
      });
      throw VfmErrors.tokenRevoked();
    }

    // Reuse detection: token je već iskorišten → smatra se krađom (docs/05 §5.2).
    if (session.revokedAt) {
      await this.revokeAllSessions(session.userId, 'REFRESH_REUSE');
      await this.rotateTokenVersion(session.userId);

      this.report({
        type: 'REFRESH_REUSE_DETECTED',
        userId: session.userId,
        clientType: session.clientType,
        reason: `PORODICA_${session.familyId}`,
        ...this.eventContext(context),
      });
      this.logger.warn(
        `Refresh reuse: korisnik ${session.userId} — sve sesije su revoked, tokenVersion povećan.`,
      );
      throw VfmErrors.refreshReuseDetected();
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw VfmErrors.tokenExpired();
    }

    const user = await this.prisma.user.findFirst({
      where: { id: session.userId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) throw VfmErrors.unauthenticated('Nalog više nije dostupan.');
    if (user.status !== 'ACTIVE') throw VfmErrors.accountInactive();

    const snapshot = await this.permissions.snapshot(user.id);
    if (!snapshot) throw VfmErrors.unauthenticated('Nalog više nije dostupan.');

    const clientType: ClientType = input.clientType ?? session.clientType;

    // docs/05 §6.2 (2. sloj): sesija izdata za WEB ne može izdati mobilni token
    // i obrnuto — `ct` je vezan za sesiju, ne za zahtjev.
    if (clientType !== session.clientType) {
      await this.recordAttempt({
        email: user.email,
        userId: user.id,
        success: false,
        clientType,
        reason: 'CLIENT_TYPE_MISMATCH',
        context,
      });
      this.report({
        type: 'MOBILE_SCOPE_NOT_ALLOWED',
        userId: user.id,
        email: user.email,
        clientType,
        roles: [...snapshot.roles],
        reason: `SESIJA_IZDATA_ZA:${session.clientType}`,
        ...this.eventContext(context),
      });
      throw VfmErrors.mobileScopeNotAllowed();
    }

    this.assertClientTypeAllowed({
      snapshot,
      clientType,
      userId: user.id,
      email: user.email,
      context,
      attemptReason: 'CLIENT_TYPE_NOT_ALLOWED',
    });

    const next = await this.createSession({
      userId: user.id,
      clientType,
      deviceInfo: asDeviceInfo(session.deviceInfo),
      familyId: session.familyId,
      context,
    });

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), replacedById: next.id, lastUsedAt: new Date() },
    });
    await this.enforceMaxSessions(user.id, next.id);

    return this.issueTokens({ user, snapshot, session: next, clientType });
  }

  // ---------------------------------------------------------------------------
  //  POST /auth/logout — revokacija svih sesija + tokenVersion++
  // ---------------------------------------------------------------------------

  async logout(
    userId: string,
    input: LogoutInput = {},
    context: AuthRequestContext = {},
    currentSessionId?: string,
  ): Promise<{ revokedSessions: number }> {
    // docs/07 §7: `POST /auth/logout` gasi **trenutnu** sesiju (ostali uređaji
    // rade dalje). Koju: refresh token iz cookie-ja/tijela, inače `sid` iz JWT-a.
    // `tokenVersion` se NE diže — to radi `logoutAll` (docs/05 §5.3).
    const tokenHash = input.refreshToken ? await this.tokens.hashToken(input.refreshToken) : undefined;

    const result = await this.prisma.refreshSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(tokenHash ? { tokenHash } : { id: currentSessionId }),
      },
      data: { revokedAt: new Date() },
    });

    this.logger.log(
      `Odjava korisnika ${userId}: revoked=${result.count} sesija` +
        `${tokenHash ? ' (prema refresh tokenu)' : ' (prema sid iz access tokena)'}` +
        ` (${context.requestId ?? '-'}).`,
    );
    return { revokedSessions: result.count };
  }

  /**
   * `POST /auth/logout-all` — odjava sa **svih** uređaja (docs/07 §7,
   * `auth:manage_sessions`): sve sesije se revokuju i `tokenVersion` raste, pa
   * postojeći access tokeni padaju na sljedećem zahtjevu (P1/P3).
   */
  async logoutAll(userId: string, context: AuthRequestContext = {}): Promise<{ revokedSessions: number }> {
    const revokedSessions = await this.revokeAllSessions(userId, 'LOGOUT');
    await this.rotateTokenVersion(userId);

    this.logger.log(
      `Odjava sa svih uređaja za korisnika ${userId}: revoked=${revokedSessions} (${context.requestId ?? '-'}).`,
    );
    return { revokedSessions };
  }

  // ---------------------------------------------------------------------------
  //  GET /auth/me — profil + efektivna prava iz baze
  // ---------------------------------------------------------------------------

  async me(userId: string, clientType: ClientType = 'WEB'): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) throw VfmErrors.unauthenticated('Nalog nije pronađen.');
    if (user.status !== 'ACTIVE') throw VfmErrors.accountInactive();

    const snapshot = await this.permissions.snapshot(userId);
    if (!snapshot) throw VfmErrors.unauthenticated('Prava korisnika nisu dostupna.');

    return this.buildUserPayload(user, snapshot, clientType);
  }

  // ---------------------------------------------------------------------------
  //  POST /auth/change-password
  // ---------------------------------------------------------------------------

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    context: AuthRequestContext = {},
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, passwordHash: true, status: true },
    });
    if (!user) throw VfmErrors.unauthenticated('Nalog nije pronađen.');
    if (user.status !== 'ACTIVE') throw VfmErrors.accountInactive();

    const currentValid = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!currentValid) {
      this.report({
        type: 'LOGIN_FAILED',
        userId: user.id,
        email: user.email,
        reason: 'CHANGE_PASSWORD_WRONG_CURRENT',
        ...this.eventContext(context),
      });
      throw VfmErrors.invalidCredentials();
    }

    // Politika + bloklista: `assertPolicy` baca `VALIDATION_ERROR` s detaljima.
    this.passwords.assertPolicy(input.newPassword, { email: user.email });

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });

    // Redoslijed je bitan: prvo DB `tokenVersion++` (izvor istine), zatim Redis
    // brojač na tu vrijednost, pa revokacija sesija i brisanje keša prava.
    await this.rotateTokenVersion(user.id);
    await this.revokeAllSessions(user.id, 'PASSWORD_CHANGE');
    await this.permissions.invalidateUser(user.id);
  }

  // ---------------------------------------------------------------------------
  //  Sesije
  // ---------------------------------------------------------------------------

  /**
   * Revokuje **sve** aktivne sesije korisnika (admin "force logout", reuse
   * detection, odjava, promjena lozinke). Vraća broj revokovanih sesija.
   */
  async revokeAllSessions(userId: string, reason: RevokeReason): Promise<number> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.log(`Revokovano ${result.count} sesija korisnika ${userId} (razlog: ${reason}).`);
    }
    return result.count;
  }

  /**
   * Aktivne (ne-revokovane, ne-istekle) sesije korisnika — za UI i admin akcije.
   *
   * Datumi se vraćaju kao ISO stringovi (UTC): klijent ih prikazuje u
   * `Europe/Sarajevo` (R-08), a JSON ne smije ovisiti o serializaciji `Date`.
   */
  async listActiveSessions(userId: string): Promise<readonly ActiveSession[]> {
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        clientType: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        ipAddress: true,
        userAgent: true,
        deviceInfo: true,
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      clientType: session.clientType,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      deviceInfo: asDeviceInfo(session.deviceInfo),
    }));
  }

  /**
   * Revokuje **jednu** sesiju (korisnik odjavljuje pojedini uređaj).
   *
   * Tuđa sesija se ne može revokovati: `where` uključuje `userId`, pa pokušaj
   * vraća `404 NOT_FOUND` bez otkrivanja da sesija postoji.
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw VfmErrors.notFound('sesija');

    // Sesija je ugašena, ali access token te sesije živi do isteka — bump
    // `tokenVersion` odmah poništava sve izdate tokene (docs/05 §5.3).
    await this.rotateTokenVersion(userId);
    this.logger.log(`Sesija ${sessionId} korisnika ${userId} je revokovana (pojedinačna odjava).`);
  }

  // ---------------------------------------------------------------------------
  //  Interno
  // ---------------------------------------------------------------------------

  /** Kreira `RefreshSession` i vraća ID + sirovi token (token se nikad ne čuva). */
  private async createSession(options: {
    userId: string;
    clientType: ClientType;
    deviceInfo: DeviceInfo | null;
    familyId: string;
    context: AuthRequestContext;
  }): Promise<{ id: string; token: string }> {
    const generated = this.tokens.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.tokens.refreshTokenTtlSeconds() * 1000);

    const session = await this.prisma.refreshSession.create({
      data: {
        id: randomUUID(),
        userId: options.userId,
        tokenHash: generated.tokenHash,
        familyId: options.familyId,
        clientType: options.clientType,
        expiresAt,
        ipAddress: options.context.ipAddress ?? null,
        userAgent: options.context.userAgent ?? null,
        ...(options.deviceInfo ? { deviceInfo: options.deviceInfo } : {}),
      },
      select: { id: true },
    });

    return { id: session.id, token: generated.token };
  }

  /**
   * Drži broj aktivnih sesija na `AUTH_MAX_SESSIONS_PER_USER`: najstarije
   * viškove revokuje (nova sesija se nikad ne revokuje).
   */
  private async enforceMaxSessions(userId: string, keepSessionId: string): Promise<void> {
    const max = getEnv().AUTH_MAX_SESSIONS_PER_USER;

    const active = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    // `active` je poredan po `createdAt asc` → višak su **najstarije** sesije.
    const others = active.filter((session) => session.id !== keepSessionId);
    const keep = Math.max(0, max - 1);
    const excess = others.length > keep ? others.slice(0, others.length - keep) : [];
    if (excess.length === 0) return;

    await this.prisma.refreshSession.updateMany({
      where: { id: { in: excess.map((session) => session.id) } },
      data: { revokedAt: new Date() },
    });
    this.logger.log(
      `Korisnik ${userId} ima više od ${max} sesija — revokovano ${excess.length} najstarijih (SESSION_LIMIT).`,
    );
  }

  /** Potpisuje access token i priprema refresh cookie (tijelo odgovora je `response`). */
  private async issueTokens(options: {
    user: UserRecord;
    snapshot: UserPermissionsSnapshot;
    session: { id: string; token: string };
    clientType: ClientType;
    /** `login` upravo upisao `lastLoginAt` — payload mora pokazati novi iznos. */
    lastLoginAt?: Date | null;
  }): Promise<AuthSessionResult> {
    const { user, snapshot, session, clientType } = options;

    const signed = await this.tokens.signAccessToken({
      userId: user.id,
      roles: snapshot.roles,
      tokenVersion: snapshot.tokenVersion,
      permissionsVersion: snapshot.permissionsVersion,
      clientType,
      sessionId: session.id,
    });

    const payload = await this.buildUserPayload(user, snapshot, clientType, options.lastLoginAt);
    // Mobilni klijenti ne mogu čuvati httpOnly cookie → token ide u tijelo.
    const includeInBody = clientType !== 'WEB';

    return {
      response: {
        accessToken: signed.accessToken,
        tokenType: signed.tokenType,
        expiresIn: signed.expiresIn,
        refreshExpiresIn: this.tokens.refreshTokenTtlSeconds(),
        sessionId: session.id,
        ...(includeInBody ? { refreshToken: session.token } : {}),
        user: payload,
      },
      clientType,
      refreshToken: session.token,
      refreshCookieOptions: this.tokens.refreshCookieOptions(),
    };
  }

  /** Profil + efektivna prava (union grantova važećih uloga). */
  private async buildUserPayload(
    user: UserRecord,
    snapshot: UserPermissionsSnapshot,
    clientType: ClientType,
    lastLoginAtOverride?: Date | null,
  ): Promise<AuthUser> {
    const effective = await this.permissions.effective(user.id, clientType);
    const activeRoles = await this.loadActiveRoles(user.id);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      status: user.status,
      // `authUserSchema.roles` je mutabilan niz (zod), loader vraća `readonly`.
      roles: activeRoles.map((role) => ({ ...role })),
      permissions: effective ? [...effective.list] : [],
      permissionsVersion: snapshot.permissionsVersion,
      tokenVersion: snapshot.tokenVersion,
      mustChangePassword: user.mustChangePassword,
      timezone: user.timezone,
      locale: user.locale,
      isSuperAdmin: snapshot.roles.includes(SUPER_ADMIN_ROLE),
      allowedClientTypes: [...snapshot.allowedClientTypes],
      lastLoginAt: (lastLoginAtOverride ?? user.lastLoginAt)?.toISOString() ?? null,
    };
  }

  /** Važeće uloge korisnika (isti predikati kao `PrismaPermissionsLoader`). */
  private async loadActiveRoles(
    userId: string,
  ): Promise<ReadonlyArray<{ id: string; code: string; name: string }>> {
    const now = new Date();

    const entries = await this.prisma.userRole.findMany({
      where: {
        userId,
        revokedAt: null,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
        ],
        role: { deletedAt: null },
      },
      select: { role: { select: { id: true, code: true, name: true } } },
      orderBy: { role: { priority: 'asc' } },
    });

    return entries.map((entry) => ({ id: entry.role.id, code: entry.role.code, name: entry.role.name }));
  }

  /**
   * N-05 / P1: Super Admin je web-only; ostale uloge poštuju
   * `Role.allowedClientTypes`. Kršenje → SECURITY_EVENT + 403.
   */
  private assertClientTypeAllowed(options: {
    snapshot: UserPermissionsSnapshot;
    clientType: ClientType;
    userId: string;
    email: string;
    context: AuthRequestContext;
    attemptReason: string;
  }): void {
    const { snapshot, clientType, userId, email, context } = options;
    if (snapshot.allowedClientTypes.includes(clientType)) return;

    const isSuperAdmin = snapshot.roles.includes(SUPER_ADMIN_ROLE);
    const isMobile = clientType === 'MOBILE_ANDROID' || clientType === 'MOBILE_IOS';

    void this.recordAttempt({
      email,
      userId,
      success: false,
      clientType,
      reason: options.attemptReason,
      context,
    });

    if (isSuperAdmin && isMobile) {
      this.report({
        type: 'MOBILE_ACCESS_FORBIDDEN',
        userId,
        email,
        clientType,
        roles: [...snapshot.roles],
        reason: 'SUPER_ADMIN_WEB_ONLY',
        ...this.eventContext(context),
      });
      throw VfmErrors.mobileAccessForbidden();
    }

    this.report({
      type: 'MOBILE_SCOPE_NOT_ALLOWED',
      userId,
      email,
      clientType,
      roles: [...snapshot.roles],
      reason: `DOZVOLJENI_TIPOVI:${snapshot.allowedClientTypes.join(',') || 'nijedan'}`,
      ...this.eventContext(context),
    });
    throw VfmErrors.mobileScopeNotAllowed();
  }

  /**
   * `User.tokenVersion++` u bazi **i** preslikavanje Redis brojača na tu
   * vrijednost (`bumpTokenVersion(userId, dbVersion)`).
   *
   * Zašto oba: guard čita Redis (brzo, trenutno), ali se Redis može flushovati
   * ili restartovati — tad verzija mora stići iz baze. Kad bi Redis brojao od
   * nule, bio bi ispod DB verzije i stari tokeni bi ostali važeći.
   */
  private async rotateTokenVersion(userId: string): Promise<number> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });

    await this.permissions.bumpTokenVersion(userId, updated.tokenVersion);
    return updated.tokenVersion;
  }

  /** `AuthAttempt` je sporedna putanja — greška ne smije srušiti prijavu. */
  private async recordAttempt(attempt: {
    email: string;
    userId: string | null;
    success: boolean;
    clientType: ClientType;
    reason: string | null;
    context: AuthRequestContext;
  }): Promise<void> {
    try {
      await this.prisma.authAttempt.create({
        data: {
          id: randomUUID(),
          email: attempt.email,
          userId: attempt.userId,
          success: attempt.success,
          clientType: attempt.clientType,
          ipAddress: attempt.context.ipAddress ?? null,
          userAgent: attempt.context.userAgent ?? null,
          failureReason: attempt.reason,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Upis AuthAttempt nije uspio (${error instanceof Error ? error.message : String(error)}) — prijava se nastavlja.`,
      );
    }
  }

  private report(event: SecurityEvent): void {
    reportSecurityEvent(this.securityEvents, event);
  }

  /** Zajednički dio SECURITY_EVENT-a iz konteksta zahtjeva. */
  private eventContext(context: AuthRequestContext): Pick<
    SecurityEvent,
    'requestId' | 'ip' | 'userAgent' | 'path' | 'method'
  > {
    return {
      requestId: context.requestId,
      ip: context.ipAddress ?? undefined,
      userAgent: context.userAgent ?? undefined,
      path: context.path,
      method: context.method,
    };
  }
}

/**
 * `deviceInfo` je JSONB: u `RefreshSession` ide samo objekat (inače `null`).
 *
 * Prisma vraća `Prisma.JsonValue`, a nazad traži `InputJsonValue` — zato se
 * ne-objekti (npr. JSON `null` ili broj) odbacuju umjesto da ruše upis.
 */
function asDeviceInfo(value: unknown): DeviceInfo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  // Whitelist polja iz `deviceInfoSchema`: sve ostalo (npr. JSON `null`, brojevi,
  // nepoznati ključevi iz stare sesije) se odbacuje — Prisma `Json` ne prima
  // `undefined`, a audit ne treba smeće.
  const source = value as Record<string, unknown>;
  const info: Record<string, string> = {};
  for (const key of ['model', 'osVersion', 'appVersion'] as const) {
    const field = source[key];
    if (typeof field === 'string' && field.length > 0) info[key] = field;
  }

  return Object.keys(info).length === 0 ? null : info;
}
