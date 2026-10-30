/**
 * Globalni filter izuzetaka — pretvara sve greške u jedinstveni envelope
 * (`docs/07-API_SPECIFIKACIJA.md` §1.5):
 *
 * ```json
 * { "error": { "code": "TASK_ALREADY_CLAIMED", "message": "…", "requestId": "…" } }
 * ```
 *
 * Pravila:
 * - Klijent switch-uje po `code`, nikad po tekstu poruke.
 * - Interna greška (500) **ne** otkriva stack/SQL/interni detalj klijentu;
 *   detalji idu isključivo u log.
 * - Sigurnosno relevantne greške (`securityRelevant`) se logiraju na `warn`
 *   i (od Faze 1) upisuju u `AuditLog` s kategorijom `SECURITY`.
 */
import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES, isErrorCode } from '@vfm/shared';
import { VfmException } from '../errors/vfm-error.js';
import type { ApiErrorBody, ApiErrorDetail, ErrorCode } from '@vfm/shared';
import type { RequestWithId } from '../middleware/request-id.middleware.js';

// `VfmException` i `VfmErrors` žive u `common/errors/vfm-error.ts` (koriste ih i
// guard-ovi, servisi i pipe-ovi). Ovaj re-export čuva postojeće importe
// (`../filters/all-exceptions.filter.js`) netaknutim.
export { VfmErrors, VfmException } from '../errors/vfm-error.js';

/** Normalizuje Nest `HttpException` u naš katalog kodova gdje je moguće. */
function mapHttpStatusToCode(status: number): ErrorCode | string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'TOKEN_EXPIRED';
    case HttpStatus.FORBIDDEN:
      return 'PERMISSION_DENIED';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'VERSION_CONFLICT';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'FORM_VALIDATION_FAILED';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'DEPENDENCY_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}

@Catch()
export class AllExceptionsFilter {
  /**
   * Namjerno **bez konstruktor-zavisnosti**: filter se registruje kroz
   * `APP_FILTER` (`useClass`), pa bi Nest pokušao injektovati svaki parametar —
   * a `pino` logger nije Nest provider. Koristi se Nest `Logger`, koji je pod
   * `setupLogger()` preusmjeren na pino.
   */
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    // Response je već poslan (npr. stream) — ne diraj ga.
    if (response.headersSent) {
      this.logException(exception, request, 0, true);
      return;
    }

    const { status, body, securityRelevant, internalDetail } = this.build(exception, request);

    this.logException(exception, request, status, securityRelevant, internalDetail);

    response.status(status).json(body);
  }

  private build(
    exception: unknown,
    request: RequestWithId | undefined,
  ): {
    status: number;
    body: { error: ApiErrorBody };
    securityRelevant: boolean;
    internalDetail?: unknown;
  } {
    const requestId = request?.id;

    // 1) Naša domenska greška
    if (exception instanceof VfmException) {
      const meta = ERROR_CODES[exception.code];
      const extra = exception.extra ?? {};
      return {
        status: meta.httpStatus,
        securityRelevant: meta.securityRelevant,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details && exception.details.length > 0 ? { details: exception.details } : {}),
            ...(requestId ? { requestId } : {}),
            ...extra,
          } as ApiErrorBody,
        },
      };
    }

    // 2) Health probe: Terminus vraća `{status, info, error, details}` i Docker/
    //    Coolify moraju vidjeti TE detalje (koja zavisnost je pala), a ne
    //    generički envelope. Zato se originalni odgovor propušta neizmijenjen.
    if (exception instanceof HttpException && isHealthPath(request)) {
      return {
        status: exception.getStatus(),
        securityRelevant: false,
        body: exception.getResponse() as { error: ApiErrorBody },
      };
    }

    // 3) Nest/Express HttpException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = mapHttpStatusToCode(status);
      const payload = exception.getResponse();
      const details = extractValidationDetails(payload);
      const message =
        details.length > 0
          ? 'Zahtjev nije ispravan.'
          : typeof payload === 'string'
            ? payload
            : (payload as { message?: string | string[] })?.message
              ? Array.isArray((payload as { message: string[] }).message)
                ? (payload as { message: string[] }).message.join('; ')
                : (payload as { message: string }).message
              : isErrorCode(code)
                ? ERROR_CODES[code].messageBs
                : exception.message;

      return {
        status,
        securityRelevant: isErrorCode(code) ? ERROR_CODES[code].securityRelevant : false,
        body: {
          error: {
            code,
            message,
            ...(details.length > 0 ? { details } : {}),
            ...(requestId ? { requestId } : {}),
          },
        },
      };
    }

    // 4) Zod greška (iz `ZodValidationPipe`, Faza 1+)
    if (isZodLikeError(exception)) {
      const details = exception.issues.map((issue) => ({
        // Brojevi (indeksi nizova) ostaju brojevi — klijent lakše pokaže polje.
        path: issue.path.map((segment): string | number => {
          if (typeof segment === 'number') return segment;
          if (typeof segment === 'object' && segment !== null && 'key' in segment) {
            const key = (segment as { key: unknown }).key;
            return typeof key === 'number' ? key : String(key);
          }
          return String(segment);
        }),
        message: issue.message,
        code: typeof issue.code === 'string' ? issue.code : undefined,
      }));
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        securityRelevant: false,
        body: {
          error: {
            code: 'FORM_VALIDATION_FAILED',
            message: ERROR_CODES.FORM_VALIDATION_FAILED.messageBs,
            details,
            ...(requestId ? { requestId } : {}),
          },
        },
      };
    }

    // 5) Sve ostalo → 500 bez otkrivanja detalja
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      securityRelevant: false,
      internalDetail: exception,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: ERROR_CODES.INTERNAL_ERROR.messageBs,
          ...(requestId ? { requestId } : {}),
        },
      },
    };
  }

  private logException(
    exception: unknown,
    request: RequestWithId | undefined,
    status: number,
    securityRelevant: boolean,
    internalDetail?: unknown,
  ): void {
    const rawPath = request?.originalUrl ?? request?.url;
    const context = {
      requestId: request?.id,
      method: request?.method,
      // Errori idu na INFO; izostavi query string kako URL tokeni/filtri ne bi
      // postali šire vidljivi u produkcijskom log agregatoru.
      path: rawPath?.split('?')[0],
      status,
    };

    if (status >= 500 || internalDetail) {
      this.logger.error(
        {
          msg: 'Neobrađena serverska greška',
          ...context,
          err: toErrorInfo(internalDetail ?? exception),
        },
        'ExceptionFilter',
      );
      return;
    }

    if (securityRelevant) {
      this.logger.warn(
        { msg: 'Sigurnosno relevantan zahtjev odbijen', ...context, reason: describeError(exception) },
        'ExceptionFilter',
      );
      return;
    }

    if (status >= 400) {
      // INFO je podrazumijevani produkcijski nivo; DEBUG je često isključen,
      // pa bi requestId iz klijentskog error envelope-a inače bio nepretraživ.
      const errorType =
        exception instanceof VfmException
          ? exception.code
          : exception instanceof Error
            ? exception.name
            : typeof exception;
      this.logger.log({ msg: 'Klijentska greška', ...context, errorType }, 'ExceptionFilter');
    }
  }
}

/** Health rute imaju sirov odgovor (bez envelope-a) — vidi `ApiEnvelopeInterceptor`. */
function isHealthPath(request: RequestWithId | undefined): boolean {
  const path = request?.path ?? request?.url ?? '';
  return path.startsWith('/health');
}

/** Izvlači `details` iz Nest validacijskog odgovora (class-validator). */
function extractValidationDetails(payload: unknown): ApiErrorDetail[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const message = (payload as { message?: unknown }).message;
  if (Array.isArray(message)) {
    return message.map((entry) => ({ path: [], message: String(entry) }));
  }
  return [];
}

interface ZodLikeIssue {
  readonly path: readonly unknown[];
  readonly message: string;
  readonly code?: unknown;
}

interface ZodLikeError {
  readonly issues: readonly ZodLikeIssue[];
}

function isZodLikeError(value: unknown): value is ZodLikeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { issues?: unknown }).issues) &&
    (value as { name?: unknown }).name === 'ZodError'
  );
}

function toErrorInfo(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return { message: String(value) };
}

function describeError(value: unknown): string {
  if (value instanceof VfmException) return value.code;
  if (value instanceof Error) return value.message;
  return String(value);
}
