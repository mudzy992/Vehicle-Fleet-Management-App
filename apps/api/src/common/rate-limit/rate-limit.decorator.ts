/**
 * Dekoratori za rate limiting (docs/07 §5).
 *
 * `RateLimitGuard` je globalan i bez metadata koristi opseg `global`
 * (300/60 s po IP-u). Rute s posebnim limitom to eksplicitno naglašavaju:
 *
 * ```ts
 * @Post('login')
 * @Public()
 * @RateLimit('login')          // 5 / 15 min po IP-u (brute force zaštita)
 * login(@Body(new ZodValidationPipe(loginSchema)) input: LoginInput) { … }
 *
 * @Post('attachments')
 * @RateLimit('upload', { limit: 10 })   // strože po ruti (ENV je gornja granica)
 * ```
 */
import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { RateLimitScope } from './rate-limit.service.js';

/** Metadata ključ za limiter. */
export const RATE_LIMIT_METADATA_KEY = 'vfm:rateLimit';

export interface RateLimitMetadata {
  readonly scope: RateLimitScope;
  /** Preklopljen limit (ne smije biti veći od ENV limita — guard to ograničava). */
  readonly limit?: number;
  /** Preklopljen prozor u sekundama. */
  readonly windowSeconds?: number;
  /** Preskoči limiter za ovu rutu (npr. `/health/*`). */
  readonly skip?: boolean;
}

/** Postavlja opseg (i opciono strože limite) za rutu. */
export const RateLimit = (
  scope: RateLimitScope,
  options: { limit?: number; windowSeconds?: number } = {},
): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_METADATA_KEY, {
    scope,
    ...options,
  } satisfies RateLimitMetadata);

/** Isključuje limiter za rutu (health endpointi koje zove Docker/Coolify). */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_METADATA_KEY, { scope: 'global', skip: true } satisfies RateLimitMetadata);

/** Čita limiter metadata (handler ima prednost nad controllerom). */
export function rateLimitMetadataFor(
  reflector: Reflector,
  context: ExecutionContext,
): RateLimitMetadata | undefined {
  return reflector.getAllAndOverride<RateLimitMetadata | undefined>(RATE_LIMIT_METADATA_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}
