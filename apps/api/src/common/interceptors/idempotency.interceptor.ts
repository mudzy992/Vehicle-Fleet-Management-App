/**
 * `IdempotencyInterceptor` — globalni replay mutacijskih HTTP zahtjeva (P-06).
 *
 * Interceptor je registrovan **između** envelope-a i audita:
 *
 * ```text
 * ApiEnvelope → Idempotency → Audit → handler
 * ```
 *
 * Taj redoslijed je namjeran: replay vraća sirovi odgovor handlera envelope-u,
 * ali ne poziva Audit ni handler drugi put. Time ponovljeni mrežni zahtjev ne
 * pravi drugi domenski upis, outbox događaj ni audit zapis.
 *
 * Aktivacija je opt-in po zahtjevu: bez `Idempotency-Key` zaglavlja ponašanje
 * API-ja se ne mijenja. Ključ vrijedi u opsegu autentifikovanog korisnika, a
 * otisak obuhvata metodu, punu putanju (s query dijelom) i JSON tijelo.
 *
 * Izuzeća su sigurnosna, ne slučajna:
 * - javne rute nemaju korisnički opseg za ključ;
 * - `/auth/*` ima cookie/token nuspojave koje se ne smiju keširati;
 * - multipart upload se ne može vjerno hashirati prije Multer obrade;
 * - odgovor s lozinkom/tokenom/tajnom se nikad ne upisuje u Redis.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
// ⚠️ Value import: `Reflector` se injektira (DI metadata).
import { Reflector } from '@nestjs/core';
import { from, of, throwError, type Observable } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { IDEMPOTENCY_HEADER } from '@vfm/shared';
import { IdempotencyService, type IdempotencyDecision } from '../../infra/redis/idempotency.service.js';
import { VfmErrors, VfmException } from '../errors/vfm-error.js';
import type { VfmRequest } from '../types/authenticated-user.js';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IDEMPOTENCY_HEADER_NAME = IDEMPOTENCY_HEADER.toLowerCase();
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,128}$/u;
const MAX_SENSITIVE_SCAN_DEPTH = 10;

/** HTTP zahtjev s poljima koja Express puni prije Nest pipe-ova. */
export interface IdempotencyHttpRequest extends VfmRequest {
  readonly body?: unknown;
  readonly originalUrl?: string;
}

interface IdempotencyHttpResponse {
  statusCode?: number;
  status?: (code: number) => unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<IdempotencyHttpRequest>();
    const method = request.method.toUpperCase();
    const userId = request.user?.id;

    if (!MUTATION_METHODS.has(method) || !userId || !this.isEligible(request)) {
      return next.handle();
    }

    const key = this.readIdempotencyKey(request);
    if (!key) return next.handle();

    const target = request.originalUrl ?? request.url;
    const decision = await this.idempotency.reserve(userId, key, {
      method,
      target,
      body: request.body ?? null,
    });

    if (decision.action === 'conflict') {
      throw new VfmException('IDEMPOTENCY_KEY_REUSED');
    }

    if (decision.action === 'in-progress') {
      throw new VfmException(
        'VERSION_CONFLICT',
        'Zahtjev s istim Idempotency-Key zaglavljem je još u obradi. Pokušajte ponovo za koji trenutak.',
        undefined,
        { retryAfterSeconds: 1, idempotencyState: 'in-progress' },
      );
    }

    if (decision.action === 'replay') {
      const record = decision.record;
      if (record?.status) {
        this.setResponseStatus(http.getResponse<IdempotencyHttpResponse>(), record.status);
      }
      return of(record?.body ?? null);
    }

    const reservationToken = decision.reservationToken;
    if (!reservationToken) {
      throw VfmErrors.dependencyUnavailable('Redis idempotencija');
    }

    const status = this.responseStatusFor(context, method);

    return next.handle().pipe(
      mergeMap((data) =>
        from(this.finishReservation(userId, key, decision, status, data)).pipe(map(() => data)),
      ),
      catchError((error: unknown) =>
        from(this.releaseQuietly(userId, key, reservationToken)).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  /** Rute i formati kod kojih globalni replay nije siguran ili nije vjeran. */
  private isEligible(request: IdempotencyHttpRequest): boolean {
    const contentType = headerOf(request, 'content-type')?.toLowerCase() ?? '';
    if (contentType.startsWith('multipart/form-data')) return false;

    const target = request.originalUrl ?? request.url;
    const pathname = target.split('?')[0] ?? target;
    const segments = pathname.split('/').filter(Boolean);
    return !segments.includes('auth');
  }

  private readIdempotencyKey(request: IdempotencyHttpRequest): string | undefined {
    const raw = request.headers[IDEMPOTENCY_HEADER_NAME];
    if (raw === undefined) return undefined;

    if (Array.isArray(raw) || !IDEMPOTENCY_KEY_PATTERN.test(raw)) {
      throw VfmErrors.validationError([
        {
          path: [IDEMPOTENCY_HEADER],
          message: 'Idempotency-Key mora biti jedna vrijednost od 1 do 128 vidljivih ASCII znakova.',
          code: 'IDEMPOTENCY_KEY',
        },
      ]);
    }

    return raw;
  }

  private responseStatusFor(context: ExecutionContext, method: string): number {
    const metadataStatus = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
    if (typeof metadataStatus === 'number' && Number.isFinite(metadataStatus)) return metadataStatus;
    return method === 'POST' ? 201 : 200;
  }

  /**
   * Uspješan handler se kešira prije nego odgovor napusti interceptor.
   * Greška Redis upisa ne smije već izvršenu domensku mutaciju pretvoriti u
   * HTTP grešku — tada se rezervacija oslobađa i problem ostaje u logu.
   */
  private async finishReservation(
    userId: string,
    key: string,
    decision: IdempotencyDecision,
    status: number,
    data: unknown,
  ): Promise<void> {
    const reservationToken = decision.reservationToken;
    if (!reservationToken) return;

    try {
      if (!isCacheableHttpBody(data) || containsSensitiveIdempotencyField(data)) {
        await this.idempotency.release(userId, key, reservationToken);
        return;
      }

      const completed = await this.idempotency.complete(
        userId,
        key,
        reservationToken,
        decision.requestHash,
        status,
        data,
      );
      if (!completed) {
        await this.idempotency.release(userId, key, reservationToken);
      }
    } catch (error) {
      this.logger.warn(
        `Idempotency zapis nije završen: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.releaseQuietly(userId, key, reservationToken);
    }
  }

  private async releaseQuietly(userId: string, key: string, reservationToken: string): Promise<void> {
    try {
      await this.idempotency.release(userId, key, reservationToken);
    } catch (error) {
      this.logger.warn(
        `Idempotency rezervacija nije oslobođena: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private setResponseStatus(response: IdempotencyHttpResponse, status: number): void {
    if (typeof response.status === 'function') {
      response.status(status);
      return;
    }
    response.statusCode = status;
  }
}

/**
 * Odgovor koji nosi tajnu ne smije završiti u 24-satnom Redis replay zapisu.
 * Provjera je namjerno konzervativna: bolje je ne keširati legitimni odgovor
 * s poljem poput `passwordChangedAt` nego sačuvati privremenu lozinku ili token.
 */
export function containsSensitiveIdempotencyField(value: unknown): boolean {
  return scanSensitive(value, new WeakSet<object>(), 0);
}

function scanSensitive(value: unknown, seen: WeakSet<object>, depth: number): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (depth > MAX_SENSITIVE_SCAN_DEPTH || seen.has(value)) return true;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) => scanSensitive(entry, seen, depth + 1));
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveFieldName(key) || scanSensitive(entry, seen, depth + 1)) return true;
  }
  return false;
}

function isSensitiveFieldName(field: string): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/gu, '');
  if (normalized === 'tokenversion') return false;
  return (
    normalized.includes('password') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('privatekey') ||
    normalized === 'authorization' ||
    normalized === 'signedurl' ||
    normalized.endsWith('apikey')
  );
}

function isCacheableHttpBody(value: unknown): boolean {
  return !(
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array ||
    typeof value === 'string' ||
    isStreamLike(value)
  );
}

function isStreamLike(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && typeof (value as { pipe?: unknown }).pipe === 'function'
  );
}

function headerOf(request: VfmRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
