/**
 * RequestId middleware — prvi u lancu (docs/05 §7).
 *
 * - Prihvata postojeći `X-Request-Id` iz reverznog proxyja (Traefik/nginx) ili
 *   generiše novi UUID v4.
 * - Kači ID na request objekat (`req.id`) i vraća ga u odgovoru, tako da se
 *   klijent, logovi i audit zapis mogu korelirati.
 * - Validira ulazni ID (dozvoljeni znakovi i dužina) da se spriječi log
 *   injection kroz zaglavlje.
 */
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER } from '@vfm/shared';
import type { NextFunction, Request, Response } from 'express';

/** Maksimalna dužina prihvaćenog request ID-a. */
export const REQUEST_ID_MAX_LENGTH = 64;

/** Dozvoljeni znakovi: heksadecimalni UUID i `-_` (Traefik/CDN formati). */
const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]+$/u;

export interface RequestWithId extends Request {
  id?: string;
  readonly receivedAt?: number;
}

/** Pročišćava ulazni request ID; vraća `undefined` ako nije upotrebljiv. */
export function sanitizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > REQUEST_ID_MAX_LENGTH) return undefined;
  if (!SAFE_REQUEST_ID.test(trimmed)) return undefined;
  return trimmed;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const header = Array.isArray(req.headers[REQUEST_ID_HEADER.toLowerCase()])
      ? req.headers[REQUEST_ID_HEADER.toLowerCase()]?.[0]
      : req.headers[REQUEST_ID_HEADER.toLowerCase()];

    const requestId = sanitizeRequestId(header) ?? randomUUID();

    req.id = requestId;
    Object.defineProperty(req, 'receivedAt', { value: Date.now(), enumerable: false });

    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
