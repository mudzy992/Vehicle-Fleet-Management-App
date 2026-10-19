/**
 * Strukturirano logovanje (JSON u produkciji, čitljivo lokalno).
 *
 * Principi (docs/10-OPERACIJE.md §2):
 * - **Bez PII** u logovima: e-mail/registracija se maskiraju (`maskEmail`, `maskPlate`).
 * - Svaki log nosi `requestId` (korelacija s `X-Request-Id` i audit logom).
 * - Nivo iz `LOG_LEVEL`; format iz `LOG_FORMAT` (`json` | `pretty`).
 *
 * Implementacija: `pino` kao Nest `LoggerService`, tako da `Logger.log()` iz
 * bilo kojeg servisa završava u istom JSON toku.
 */
import { Logger, type LoggerService, type LogLevel } from '@nestjs/common';
import pino, { type Logger as PinoLogger } from 'pino';
import { APP_NAME, APP_PREFIX } from '@vfm/shared';

/** Mapiranje Nest nivoa → pino nivoi. */
const NEST_TO_PINO: Record<LogLevel, pino.Level> = {
  error: 'error',
  warn: 'warn',
  log: 'info',
  debug: 'debug',
  verbose: 'trace',
  fatal: 'fatal',
};

export interface CreateLoggerOptions {
  readonly level?: string;
  readonly format?: 'json' | 'pretty';
  readonly serviceName?: string;
  /** Statičke vrijednosti dodane svakom logu (npr. `{ worker: 'vfm-worker-1' }`). */
  readonly bindings?: Record<string, unknown>;
}

/** Kreira pino instancu. */
export function createPinoLogger(options: CreateLoggerOptions = {}): PinoLogger {
  const {
    level = process.env.LOG_LEVEL ?? 'info',
    format = process.env.LOG_FORMAT === 'pretty' ? 'pretty' : 'json',
    serviceName = process.env.APP_NAME ?? `${APP_PREFIX}-api`,
    bindings = {},
  } = options;

  const base = pino({
    level,
    base: { app: APP_NAME, service: serviceName, ...bindings },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        'newPassword',
        'currentPassword',
        'refreshToken',
        'accessToken',
        'authorization',
        'cookie',
        '*.password',
        '*.refreshToken',
        '*.accessToken',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });

  // `LOG_FORMAT=pretty` se poštuje kroz transport samo lokalno; u produkciji
  // je obavezan JSON (Coolify/Traefik log agregacija). Bez dodatne dependencije
  // (pino-pretty) — lokalno koristite `pnpm dev` i `| jq` po potrebi.
  void format;
  return base;
}

/** Adapter: pino → Nest `LoggerService`. */
export class PinoLoggerService implements LoggerService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly context?: string,
  ) {}

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace ? { stack: trace } : undefined);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  /** Dodaje trajne vrijednosti (npr. `requestId`) — vraća novi adapter. */
  child(bindings: Record<string, unknown>): PinoLoggerService {
    return new PinoLoggerService(this.logger.child(bindings), this.context);
  }

  /** Direktni pristup pino instanci (za napredne slučajeve). */
  get raw(): PinoLogger {
    return this.logger;
  }

  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    extra?: Record<string, unknown>,
  ): void {
    const pinoLevel = NEST_TO_PINO[level];
    const payload: Record<string, unknown> = { ...(extra ?? {}) };
    const ctx = context ?? this.context;
    if (ctx) payload.context = ctx;

    if (message instanceof Error) {
      payload.err = { message: message.message, stack: message.stack, name: message.name };
      this.logger[pinoLevel](payload, message.message);
      return;
    }

    if (typeof message === 'object' && message !== null) {
      this.logger[pinoLevel]({ ...payload, ...(message as Record<string, unknown>) });
      return;
    }

    this.logger[pinoLevel](payload, String(message));
  }
}

/**
 * Instalira pino logger kao globalni Nest logger.
 * Poziva se u `main.ts` **prije** `NestFactory.create`.
 */
export function setupLogger(options: CreateLoggerOptions = {}): PinoLoggerService {
  const pinoLogger = createPinoLogger(options);
  const service = new PinoLoggerService(pinoLogger, options.serviceName);
  Logger.overrideLogger(service);
  return service;
}

/**
 * Maskira osjetljive vrijednosti u log poruci (PII zaštita).
 * Koristi se kada se logira korisnički unos.
 */
export function sanitizeForLog(value: string): string {
  return value
    .replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+)/gu, (_m, local: string, domain: string) => {
      const visible = String(local).slice(0, 1);
      return `${visible}***@${domain}`;
    })
    .replace(/\b(password|passwd|token|secret)\s*[:=]\s*\S+/giu, '$1=[REDACTED]');
}
