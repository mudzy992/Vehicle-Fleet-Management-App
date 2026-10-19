/**
 * Envelope interceptor — svi uspješni odgovori dobijaju oblik:
 *
 * ```json
 * { "data": …, "meta": { "requestId": "…", "timestamp": "…" } }
 * ```
 *
 * Izuzeci (NE omataju se):
 * - health endpointi (`/health/*`) — Docker/Coolify probe očekuju sirovi odgovor
 *   i status 200/503 bez omotača;
 * - binarni odgovori (PDF/Excel export) i stream-ovi;
 * - odgovori koji već imaju `data` ili `error` ključ (idempotentnost omotača).
 */
import type {
  CallHandler,
  ExecutionContext} from '@nestjs/common';
import {
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { toUtcIso } from '@vfm/shared';
import type { RequestWithId } from '../middleware/request-id.middleware.js';

/** URL prefiksi koji se ne omataju. */
const UNWRAPPED_PATH_PREFIXES = ['/health'] as const;

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId & Request>();
    const response = http.getResponse<Response>();

    if (shouldSkipEnvelope(request)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((payload) => {
        if (payload === undefined || payload === null) {
          return { data: null, meta: buildMeta(request) };
        }

        // Binarni sadržaj (export PDF/XLSX) prolazi bez izmjene.
        if (isBinaryPayload(payload)) {
          return payload;
        }

        // Već omotan odgovor (npr. ručno konstruisan envelope) se ne duplira.
        if (isAlreadyEnveloped(payload)) {
          return { ...payload, meta: { ...buildMeta(request), ...(payload.meta ?? {}) } };
        }

        return { data: payload, meta: buildMeta(request) };
      }),
    );

    function buildMeta(req: RequestWithId): { requestId?: string; timestamp: string } {
      void response;
      return {
        ...(req.id ? { requestId: req.id } : {}),
        timestamp: toUtcIso(new Date()),
      };
    }
  }
}

function shouldSkipEnvelope(request: RequestWithId | undefined): boolean {
  const path = request?.path ?? request?.url ?? '';
  return UNWRAPPED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isBinaryPayload(payload: unknown): boolean {
  return (
    Buffer.isBuffer(payload) ||
    payload instanceof Uint8Array ||
    isStreamLike(payload) ||
    typeof payload === 'string'
  );
}

function isStreamLike(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { pipe?: unknown }).pipe === 'function'
  );
}

function isAlreadyEnveloped(payload: unknown): payload is { data: unknown; meta?: object } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const keys = Object.keys(payload as object);
  return keys.includes('data') && (keys.length === 1 || keys.includes('meta') || keys.includes('error'));
}
