/**
 * `RateLimitGuard` — globalni limiter (docs/07 §5, docs/05 §7).
 *
 * Registrovan je **prije** `JwtAuthGuard`-a: odbijanje mora biti jeftinije od
 * obrade zahtjeva (argon2id verifikacija lozinke traje ~100 ms, pa bi bez ovoga
 * brute force na `/auth/login` trošio CPU servera).
 *
 * Identitet: `ip:{adresa}` (X-Forwarded-For prvi hop, jer API radi iza Traefik/nginx
 * proxy-ja). Kad je korisnik već autentificiran koristi se `user:{id}` — to važi
 * za rute gdje se limiter poziva eksplicitno iz handler-a (npr. upload po korisniku).
 *
 * Odgovor pri prekoračenju: `429 RATE_LIMITED` + `Retry-After` + `X-RateLimit-*`
 * zaglavlja, i SECURITY_EVENT (za `login` opseg posebno — indikacija napada).
 *
 * Kad Redis nije dostupan limiter propušta zahtjev (`degraded`) — drugi sloj
 * zaštite je zaključavanje naloga u bazi (`AUTH_MAX_FAILED_ATTEMPTS`).
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
// ⚠️ Value import: `Reflector` se injektira (DI metadata).
import { Reflector } from '@nestjs/core';
import { rateLimitMetadataFor, type RateLimitMetadata } from '../rate-limit/rate-limit.decorator.js';
import {
  RateLimitService,
  sanitizeIdentity,
  type RateLimitPolicy,
  type RateLimitScope,
} from '../rate-limit/rate-limit.service.js';
import { VfmErrors } from '../errors/vfm-error.js';
import type { VfmRequest } from '../types/authenticated-user.js';
import {
  SECURITY_EVENT_SINK,
  reportSecurityEvent,
  securityContextFromRequest,
  type SecurityEventSink,
} from '../audit/security-event.js';

/** Zaglavlja koja limiter postavlja na svaki odgovor. */
export const RATE_LIMIT_HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  retryAfter: 'Retry-After',
} as const;

/** Odgovor s opcionim `setHeader` (express ima, test fake ima). */
interface HeaderResponse {
  setHeader?: (name: string, value: string | number) => void;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
    @Optional() @Inject(SECURITY_EVENT_SINK) private readonly security?: SecurityEventSink,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = rateLimitMetadataFor(this.reflector, context);
    if (metadata?.skip) return true;
    if (!this.rateLimit.isEnabled) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<VfmRequest>();
    const response = http.getResponse<HeaderResponse>();

    const scope: RateLimitScope = metadata?.scope ?? 'global';
    const identity = requestIdentity(request);
    const policy = resolvePolicy(this.rateLimit.policyFor(scope), metadata);

    const result = await this.rateLimit.consume(scope, identity, policy);

    response?.setHeader?.(RATE_LIMIT_HEADERS.limit, result.limit);
    response?.setHeader?.(RATE_LIMIT_HEADERS.remaining, result.remaining);

    if (result.allowed) return true;

    response?.setHeader?.(RATE_LIMIT_HEADERS.retryAfter, result.retryAfterSeconds);

    reportSecurityEvent(this.security, {
      type: 'RATE_LIMITED',
      ...securityContextFromRequest(request),
      userId: request.user?.id,
      clientType: request.user?.clientType,
      reason: `${scope} limit ${result.limit}/${policy.windowSeconds}s premašen (brojač ${result.current})`,
    });

    throw VfmErrors.rateLimited(result.retryAfterSeconds);
  }
}

/**
 * Politika za rutu: metadata može samo **postrožiti** ENV limit (nikad ga
 * povećati) — greška u dekoratoru ne smije otvoriti rupu.
 */
export function resolvePolicy(fromEnv: RateLimitPolicy, metadata?: RateLimitMetadata): RateLimitPolicy {
  if (!metadata) return fromEnv;
  return {
    limit: metadata.limit === undefined ? fromEnv.limit : Math.min(metadata.limit, fromEnv.limit),
    windowSeconds: metadata.windowSeconds ?? fromEnv.windowSeconds,
  };
}

/** Identitet za ključ `vfm:rl:{scope}:{identity}`. */
export function requestIdentity(request: Pick<VfmRequest, 'ip' | 'headers' | 'user'>): string {
  if (request.user?.id) return `user-${sanitizeIdentity(request.user.id)}`;
  const forwarded = request.headers['x-forwarded-for'];
  const firstHop = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return `ip-${sanitizeIdentity(request.ip ?? firstHop ?? 'unknown')}`;
}
