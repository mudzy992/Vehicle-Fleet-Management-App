/**
 * `AuthController` — `/api/v1/auth/*` (docs/07 §7).
 *
 * | Ruta                       | Guard-ovi            | Audit      |
 * | -------------------------- | -------------------- | ---------- |
 * | `POST /login`              | `@Public` + `login` limiter | `LOGIN` (SECURITY) |
 * | `POST /refresh`            | `@Public`            | `LOGIN` (INFO) |
 * | `POST /logout`             | JWT + clientType     | `LOGOUT` (SECURITY) |
 * | `POST /logout-all`         | + `auth:manage_sessions` | `LOGOUT` (SECURITY) |
 * | `GET  /me`                 | JWT + clientType + permissions | — (često, bez audit-a) |
 * | `GET  /sessions`           | + `auth:manage_sessions` | — |
 * | `DELETE /sessions/:id`     | + `auth:manage_sessions` | `LOGOUT` (SECURITY) |
 * | `POST /change-password`    | + `auth:change_password` | `UPDATE` na `User` (SECURITY) |
 * | `POST /reset-password`     | `@Public` + `login` limiter | `UPDATE` na `User` (SECURITY) |
 *
 * HTTP detalji koji **ne** idu u servis:
 * - refresh token se postavlja u httpOnly cookie (`COOKIE_NAME`, default
 *   `vfm_refresh`) i briše pri odjavi/promjeni lozinke;
 * - web čita token iz cookie-ja, mobilni iz tijela (`refreshSchema.refreshToken`);
 * - `ZodValidationPipe` validira tijelo (bez `class-validator`), a
 *   `ApiEnvelopeInterceptor` pakira odgovor u `{ data, meta }`.
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type {
  AuthTokenResponse,
  AuthUser,
  ChangePasswordInput,
  ConsumePasswordResetInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
} from '@vfm/shared/schemas';
import {
  changePasswordSchema,
  consumePasswordResetSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  sessionIdSchema,
} from '@vfm/shared/schemas';
import { AuditContext } from '../../common/audit/audit.types.js';
import { securityContextFromRequest } from '../../common/audit/security-event.js';
import { Audit, CurrentUser, Public, RequirePermissions } from '../../common/decorators/auth.decorators.js';
import { VfmErrors } from '../../common/errors/vfm-error.js';
import type { AuthenticatedUser, VfmRequest } from '../../common/types/authenticated-user.js';
import { readCookie } from '../../common/http/read-cookie.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { getEnv } from '../../config/env.js';
import { AuthService, type ActiveSession, type AuthRequestContext, type AuthSessionResult } from './auth.service.js';
import { TokenService } from './services/token.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Prijava. Rate limit `login` (5 / 15 min po IP-u) je prvi sloj zaštite od
   * brute force-a; drugi je `failedLoginCount` + `lockedUntil` u bazi.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit('login')
  @Audit('LOGIN', { severity: 'SECURITY', resource: 'auth', diff: false })
  async login(
    @Body(new ZodValidationPipe(loginSchema, 'body')) input: LoginInput,
    @Req() request: VfmRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokenResponse> {
    const result = await this.auth.login(input, this.contextOf(request));
    this.applyRefreshToken(response, result);
    return result.response;
  }

  /** Rotacija refresh tokena (web: cookie, mobilni: tijelo zahtjeva). */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Audit('LOGIN', { severity: 'INFO', resource: 'auth', diff: false })
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema, 'body', { allowEmpty: true })) input: RefreshInput,
    @Req() request: VfmRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokenResponse> {
    const cookieToken = readCookie(request, getEnv().COOKIE_NAME);
    const result = await this.auth.refresh(input, this.contextOf(request), cookieToken);
    this.applyRefreshToken(response, result);
    return result.response;
  }

  /** Odjava **trenutne** sesije (ostali uređaji ostaju prijavljeni). */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit('LOGOUT', { severity: 'SECURITY', resource: 'auth', diff: false })
  async logout(
    @Body(new ZodValidationPipe(logoutSchema, 'body', { allowEmpty: true })) input: LogoutInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const current = this.requireUser(user);
    const cookieToken = input.refreshToken ? undefined : readCookie(request, getEnv().COOKIE_NAME);
    await this.auth.logout(
      current.id,
      cookieToken ? { refreshToken: cookieToken } : input,
      this.contextOf(request),
      current.sessionId,
    );
    this.clearRefreshCookie(response);
  }

  /**
   * Odjava sa svih uređaja: revokuje sve sesije i diže `tokenVersion`, jer bi
   * access tokeni inače ostali važeći do 10 min (docs/05 §5.3, `auth:manage_sessions`).
   */
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('auth:manage_sessions')
  @Audit('LOGOUT', { severity: 'SECURITY', resource: 'auth', diff: false })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const current = this.requireUser(user);
    await this.auth.logoutAll(current.id, this.contextOf(request));
    this.clearRefreshCookie(response);
  }

  /** Profil + efektivna prava (izvor za web `usePermission()`). */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser | undefined): Promise<AuthUser> {
    const current = this.requireUser(user);
    return this.auth.me(current.id, current.clientType);
  }

  /**
   * Reset lozinke jednokratnim tokenom (token izdaje admin kroz
   * `POST /users/:id/reset-password`; u Fazi 5 ide e-mailom kroz outbox).
   *
   * Javna ruta s `login` limiterom: token je 43 znaka i važi 30 min, ali
   * ograničenje po IP-u sprječava i ono malo vjerovatnog pogađanja.
   * Uspjeh revokuje **sve** sesije i diže `tokenVersion` → stari tokeni padaju.
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit('login')
  @Audit('UPDATE', { severity: 'SECURITY', resource: 'User', diff: false })
  async resetPassword(
    @Body(new ZodValidationPipe(consumePasswordResetSchema, 'body')) input: ConsumePasswordResetInput,
    @Req() request: VfmRequest,
  ): Promise<{ userId: string; email: string }> {
    const result = await this.auth.resetPasswordWithToken(input, this.contextOf(request));

    AuditContext.from(request)
      .setEntityId(result.userId)
      .setResource('User')
      .set('flow', 'RESET_TOKEN');

    return result;
  }

  /**
   * Promjena lozinke: stara lozinka je obavezna, nova prolazi politiku
   * (`PasswordService.assertPolicy`), a sve sesije se revokuju.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('auth:change_password')
  @Audit('UPDATE', { severity: 'SECURITY', resource: 'User', diff: false })
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema, 'body')) input: ChangePasswordInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() request: VfmRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const current = this.requireUser(user);
    await this.auth.changePassword(current.id, input, this.contextOf(request));
    this.clearRefreshCookie(response);
  }

  /** Aktivne sesije trenutnog korisnika (ekran Postavke → Uređaji). */
  @Get('sessions')
  @RequirePermissions('auth:manage_sessions')
  async sessions(@CurrentUser() user: AuthenticatedUser | undefined): Promise<readonly ActiveSession[]> {
    const current = this.requireUser(user);
    return this.auth.listActiveSessions(current.id);
  }

  /** Odjava jednog uređaja (tuđa sesija → `404 NOT_FOUND`). */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('auth:manage_sessions')
  @Audit('LOGOUT', { severity: 'SECURITY', resource: 'auth', diff: false })
  async revokeSession(
    @Param('id', new ZodValidationPipe(sessionIdSchema, 'params')) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<void> {
    const current = this.requireUser(user);
    await this.auth.revokeSession(current.id, id);
  }

  // ---------------------------------------------------------------------------
  //  Interno
  // ---------------------------------------------------------------------------

  /** Ruta bez `@Public()` prolazi `JwtAuthGuard`, ali tip ostavlja `undefined`. */
  private requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
    if (!user) throw VfmErrors.unauthenticated();
    return user;
  }

  /** IP/UA/`requestId` za audit i `AuthAttempt` (isti izvor kao guard-ovi). */
  private contextOf(request: VfmRequest): AuthRequestContext {
    const context = securityContextFromRequest(request);
    return {
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId,
      path: context.path,
      method: context.method,
    };
  }

  /**
   * Web: refresh token ide u httpOnly cookie (i **ne** u tijelo). Mobilni
   * klijenti: token je u tijelu odgovora, cookie se ne postavlja (docs/05 §5.2).
   */
  private applyRefreshToken(response: Response, result: AuthSessionResult): void {
    if (result.clientType === 'WEB') {
      response.cookie(getEnv().COOKIE_NAME, result.refreshToken, result.refreshCookieOptions);
      return;
    }
    // Mobilni zahtjev može doći s postojećim cookie-jem (npr. hibridni webview) —
    // očisti ga da ne ostane stari token u pregledničkom spremištu.
    response.clearCookie(getEnv().COOKIE_NAME, this.tokens.clearRefreshCookieOptions());
  }

  private clearRefreshCookie(response: Response): void {
    // `clearCookie` mora poslati **iste** atribute (path/domain/secure),
    // inače pregledač cookie ne obriše.
    response.clearCookie(getEnv().COOKIE_NAME, this.tokens.clearRefreshCookieOptions());
  }
}
