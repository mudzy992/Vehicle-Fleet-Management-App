/**
 * Health modul — probe za Docker/Coolify i dijagnostiku.
 *
 * `TerminusModule` pruža `HealthCheckService` i `HealthIndicatorService`
 * (Terminus 12 API — bez `HealthIndicator` bazne klase).
 */
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';
import { DatabaseHealthIndicator } from './database.health-indicator.js';
import { DiskHealthIndicator } from './disk.health-indicator.js';

@Module({
  imports: [
    TerminusModule.forRoot({
      // Greške se ne loguju dvaput (filter već loguje); Terminus samo vraća status.
      errorLogStyle: 'pretty',
      logger: false,
    }),
  ],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, DatabaseHealthIndicator, DiskHealthIndicator],
})
export class HealthModule {}
