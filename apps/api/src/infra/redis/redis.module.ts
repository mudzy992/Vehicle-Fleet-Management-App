/**
 * Redis modul — globalno dostupan (cache, locks, rate limit, idempotencija, SSE).
 *
 * `@Global()` jer Redis koriste skoro svi domenski moduli (od Faze 1 nadalje),
 * a želimo **jednu** konekciju po ACL korisniku, ne po modulu.
 */
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { DistributedLockService } from './distributed-lock.service.js';
import { IdempotencyService } from './idempotency.service.js';

@Global()
@Module({
  providers: [RedisService, DistributedLockService, IdempotencyService],
  exports: [RedisService, DistributedLockService, IdempotencyService],
})
export class RedisModule {}
