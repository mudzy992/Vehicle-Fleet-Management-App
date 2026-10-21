/**
 * VFM API — ulazna tačka.
 *
 * Redoslijed middleware-a (docs/05 §7 — "guard order"):
 *   RequestId → helmet/CORS → body limit → Throttler → JwtAuth → TokenVersion →
 *   PermissionsVersion → ClientType → Permissions → ZodValidation → Idempotency →
 *   handler → Audit → envelope
 *
 * U Fazi 0 postavljeni su: RequestId, CORS, body limit, globalni error filter,
 * health endpointi i graceful shutdown. Auth/RBAC/Throttler dolaze u Fazi 1.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IDEMPOTENCY_HEADER, REQUEST_ID_HEADER } from '@vfm/shared';
import { AppModule } from './app.module.js';
import { getEnv } from './config/env.js';
import { trustProxyHops } from '@vfm/shared/env';
import { setupLogger } from './config/logger.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor.js';

async function bootstrap(): Promise<void> {
  // 1) Validacija ENV-a PRIJE bilo čega drugog (fail fast).
  const env = getEnv();

  // 2) Strukturirano logovanje (mora prije NestFactory da se boot logovi vide).
  const logger = setupLogger({
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
    serviceName: env.APP_NAME,
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bufferLogs: false,
    bodyParser: true,
  });

  // 3) Iza Traefik/nginx reverznog proxy-a (Coolify) — prava IP adresa za rate limit i audit.
  //    `TRUST_PROXY=loopback` (default) → 1 hop; `all` → vjeruj svim proxy headerima.
  app.set('trust proxy', trustProxyHops(env));

  // 4) Globalni prefiks + verzioniranje URL-om (`/api/v1/...`).
  //    Health endpointi su NAMJERNO izvan prefiksa i verzioniranja jer ih zovu
  //    Docker/Coolify probe: `wget -q -S http://localhost:3000/health/live`.
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live', 'health/ready', 'health/startup'] });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });

  // 5) CORS — allowlista iz ENV-a (R-03: https://vehicle.ba101.top).
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER, 'X-Client-Type', IDEMPOTENCY_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER, 'X-Permissions-Version'],
    maxAge: 600,
  });

  // 6) Osnovni sigurnosni headeri (Faza 1 dodaje puni helmet set).
  const helmetLite = (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    void req;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  };
  app.use(helmetLite);

  // 7) Validacija: u Fazi 0 nema DTO-ova, pa nema ni globalnog pipe-a.
  //    Faza 1 uvodi `ZodValidationPipe` (bez `class-validator`):
  //      app.useGlobalPipes(new ZodValidationPipe({ whitelist: true }));
  //    Zod šeme su već spremne u `@vfm/shared` (paginationQuerySchema, plateSchema, …).

  // 8) Jedinstveni error envelope + korelacijski ID.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor());

  // 9) Graceful shutdown: BullMQ workeri i Redis konekcije se uredno zatvaraju.
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);

  logger.log(
    `VFM API spreman na http://${env.API_HOST}:${env.API_PORT}${env.API_PREFIX} ` +
      `(env=${env.NODE_ENV}/${env.APP_ENV}, profil=${env.ENV_PROFILE})`,
    'Bootstrap',
  );
}

bootstrap().catch((error: unknown) => {
  // Boot greška mora biti jasno vidljiva u Coolify logovima.
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  Logger.error(`Pokretanje API-ja nije uspjelo:\n${message}`, 'Bootstrap');
  process.exit(1);
});
