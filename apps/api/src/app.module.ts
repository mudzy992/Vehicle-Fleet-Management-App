/**
 * Korijenski Nest modul (Faza 0).
 *
 * Sadržaj: infrastruktura (Redis, redovi, health) + zajednički middleware.
 * Domenski moduli (auth, vehicles, tasks, forms…) dolaze u Fazama 1–7 i
 * registriraju se ovdje.
 */
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ApiEnvelopeInterceptor } from './common/interceptors/api-envelope.interceptor.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [DatabaseModule, RedisModule, QueueModule, HealthModule],
  controllers: [],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // RequestId ide prvi (docs/05 §7): svi logovi i audit zapisi ga nasljeđuju.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
