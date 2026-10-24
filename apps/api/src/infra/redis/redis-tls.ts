import { readFileSync } from 'node:fs';
import type { RedisOptions } from 'ioredis';
import type { RedisConnectionConfig } from '@vfm/shared/env';

/** Ako je zadat CA fajl, koristi ga za TLS trust; inače Node koristi svoj podrazumijevani trust store. */
export function redisTlsOptions(
  config: Pick<RedisConnectionConfig, 'tls' | 'caCertPath'>,
): NonNullable<RedisOptions['tls']> | undefined {
  if (!config.tls) return undefined;
  return {
    rejectUnauthorized: true,
    ...(config.caCertPath ? { ca: readFileSync(config.caCertPath) } : {}),
  };
}
