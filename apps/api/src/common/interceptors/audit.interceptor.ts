/**
 * `AuditInterceptor` — bilježi značajne akcije (docs/05 §9).
 *
 * Aktivira se **samo** na rutama s `@Audit(...)` (npr. izmjena matrice prava,
 * kreiranje korisnika, export) — guard-ovi zasebno prijavljuju sigurnosne
 * događaje (`SECURITY_EVENT_SINK`), pa se 401/403 ne dupliraju.
 *
 * Interceptor ne može znati stanje **prije** izmjene, pa servis to dodaje kroz
 * `AuditContext`:
 * ```ts
 * AuditContext.from(request).setBefore(existingRole).setEntityId(role.id);
 * ```
 *
 * Pravila:
 * - audit **nikad** ne smije srušiti zahtjev (greška sink-a se guta i logira),
 * - osjetljiva polja (lozinke, hashovi, tokeni) se redaktuju iz `before`/`after`,
 * - diff se računa samo kad postoji `before` (UPDATE/DELETE),
 * - odbijen zahtjev se također bilježi, s kodom greške i `SECURITY` severity-om
 *   za sigurnosno relevantne kodove.
 */
import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
// ⚠️ Value import: `Reflector` se injektira (DI metadata).
import { Reflector } from '@nestjs/core';
import { isObservable, throwError, type Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import type { AuditAction, AuditSeverity, ErrorCode } from '@vfm/shared';
import { VfmException } from '../errors/vfm-error.js';
import { auditMetadataFor, type AuditMetadata } from '../decorators/auth.decorators.js';
import type { VfmRequest } from '../types/authenticated-user.js';
import {
  AUDIT_SINK,
  AuditContext,
  buildAuditDiff,
  redactRecord,
  severityForError,
  type AuditRecord,
  type AuditSink,
} from '../audit/audit.types.js';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(AUDIT_SINK) private readonly sink?: AuditSink,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = auditMetadataFor(this.reflector, context);
    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<VfmRequest>();
    const started = Date.now();
    const at = new Date().toISOString();

    return next.handle().pipe(
      tap((data) => this.write(context, request, metadata, data, undefined, started, at)),
      catchError((error: unknown) => {
        // Odbijen zahtjev se također bilježi, pa se greška propagira dalje
        // (filter je pretvara u API envelope).
        this.write(context, request, metadata, undefined, error, started, at);
        return throwError(() => error);
      }),
    );
  }

  /** Gradi zapis i prijavljuje ga sink-u (bez bacanja). */
  private write(
    context: ExecutionContext,
    request: VfmRequest,
    metadata: AuditMetadata,
    data: unknown,
    error: unknown,
    started: number,
    at: string,
  ): void {
    try {
      const audit = AuditContext.from(request as unknown as object);
      const user = request.user;
      const errorCode = error ? (errorCodeOf(error) ?? 'INTERNAL_ERROR') : undefined;
      // Uspješna akcija zadržava severity iz `@Audit`; odbijena dobija SECURITY
      // ako je kod greške sigurnosno relevantan (docs/05 §9).
      const severity: AuditSeverity = errorCode ? severityForError(errorCode) : metadata.severity;

      const after = toRecord(data);
      const before = audit.before ? redactRecord(audit.before) : undefined;
      const diff = before && after ? buildAuditDiff(before, after) : [];

      const record: AuditRecord = {
        action: metadata.action as AuditAction,
        severity,
        resource: audit.resource ?? metadata.resource ?? controllerName(context),
        entityId: audit.entityId ?? idOf(after),
        userId: user?.id,
        userEmail: user?.email,
        roles: user?.roles,
        clientType: user?.clientType,
        requestId: request.id ?? headerOf(request, 'x-request-id'),
        ip: request.ip ?? headerOf(request, 'x-forwarded-for')?.split(',')[0]?.trim(),
        userAgent: headerOf(request, 'user-agent'),
        method: request.method,
        path: request.url,
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        meta: { ...audit.meta, ...(diff.length > 0 ? { diff } : {}) },
        success: !error,
        ...(errorCode ? { errorCode } : {}),
        durationMs: Date.now() - started,
        at,
      };

      const result = this.sink?.record(record) as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch (sinkError) {
      this.logger.error(
        `Audit zapis nije uspio: ${sinkError instanceof Error ? sinkError.message : String(sinkError)}`,
      );
    }
  }
}

/** Kod greške iz kataloga (VfmException) ili HTTP status (Nest izuzeci). */
function errorCodeOf(error: unknown): ErrorCode | string | undefined {
  if (error instanceof VfmException) return error.code;
  if (error instanceof HttpException) {
    const response = error.getResponse() as { code?: unknown } | string;
    if (typeof response === 'object' && typeof response.code === 'string') return response.code;
    return `HTTP_${error.getStatus()}`;
  }
  if (error === undefined || error === null) return undefined;
  return 'INTERNAL_ERROR';
}

/** Odgovor handler-a kao objekt (za `after`/diff) ili `undefined`. */
function toRecord(data: unknown): Readonly<Record<string, unknown>> | undefined {
  if (data === null || data === undefined) return undefined;
  if (typeof data !== 'object') return { value: data };
  if (Array.isArray(data)) return { items: data.length, list: data };
  if (isObservable(data)) return undefined;
  return redactRecord(data as Record<string, unknown>);
}

/** `id` iz odgovora (ako postoji) — za `entityId`. */
function idOf(record: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!record) return undefined;
  if (typeof record.id === 'string') return record.id;
  const nested = record.data;
  if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).id === 'string') {
    return (nested as Record<string, unknown>).id as string;
  }
  return undefined;
}

/** Naziv controller klase (fallback za `resource`). */
function controllerName(context: ExecutionContext): string {
  const target = context.getClass() as { name?: string } | undefined;
  return target?.name?.replace(/Controller$/u, '') ?? 'Unknown';
}

/** Čita zaglavlje (string ili niz). */
function headerOf(request: VfmRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
