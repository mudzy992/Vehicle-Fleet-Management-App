/**
 * `AttachmentsService` — upload, vezivanje i serviranje priloga (docs/07 §2.12).
 *
 * Pravila koja servis čuva (i koja testovi provjeravaju):
 *
 * 1. **Tip se određuje iz sadržaja.** `Content-Type` klijenta se ne vjeruje;
 *    tip dolazi iz magic bytes (`detectFileType`), a dozvoljeni tipovi su
 *    `ATTACHMENT_ALLOWED_MIME`. Sve ostalo je `415 UNSUPPORTED_MEDIA_TYPE`.
 * 2. **Veličina.** Preko `ATTACHMENT_MAX_SIZE_MB` → `413 PAYLOAD_TOO_LARGE`
 *    (prije nego fajl dodirne disk).
 * 3. **Metapodaci se skidaju prije spremanja** (`stripImageMetadata`) — GPS iz
 *    EXIF-a ne smije završiti u fajlu na disku; `exifStripped` govori da li je
 *    obrada stvarno urađena.
 * 4. **Idempotentnost.** `@@unique([ownerType, ownerId, sha256])`: ponovni
 *    upload istog sadržaja za istog vlasnika vraća **postojeći** zapis umjesto
 *    duplikata (mobilna aplikacija smije ponoviti zahtjev).
 * 5. **Potpisani URL.** `GET /url` daje token `exp.sig` (HMAC-SHA256 nad
 *    `id|actorId|exp`, tajna `FILE_SIGNING_SECRET`); ruta za sadržaj traži
 *    sesiju, `attachment:view`, opseg nad prilogom i token vezan za isti korisnik.
 *    Svaki pristup se audituje.
 * 6. **Fajl se nikad ne servira s diska direktno** (B-15) — samo kroz servis,
 *    uz provjeru da `storageKey` ne izlazi iz korijena storage-a.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ApiErrorDetail } from '@vfm/shared';
import { hasPermission } from '@vfm/shared';
import { maxFileSizeBytes } from '@vfm/shared/env';
import type {
  Attachment,
  AttachmentListQuery,
  AttachmentListResponse,
  AttachmentSignedUrl,
  AttachmentUploadResult,
  CompleteAttachmentInput,
} from '@vfm/shared/schemas';
import type { Prisma } from '../../generated/prisma/client.js';
import { VfmException, VfmErrors } from '../../common/errors/vfm-error.js';
import { toUtcIso } from '@vfm/shared';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  buildStorageKey,
  detectFileType,
  isSafeStorageKey,
  sha256Hex,
  stripImageMetadata,
} from './attachment-files.js';

/** Minimum onoga što multer preda handler-u (bez zavisnosti na `@types/multer`). */
export interface UploadedFileLike {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
}

/**
 * DI token za opcije pohrane.
 *
 * Zašto token, a ne goli parametar: Nest injektira samo klase ili tokene s
 * `@Inject`. Interfejs `AttachmentStorageOptions` ne postoji u runtime-u, pa je
 * aplikacija padala na startu („can't resolve dependencies … index [1]").
 */
export const ATTACHMENT_STORAGE_OPTIONS = 'VFM_ATTACHMENT_STORAGE_OPTIONS';

/** Konfiguracija pohrane — u testovima se zadaje eksplicitno. */
export interface AttachmentStorageOptions {
  /** Korijen storage-a (`VFM_STORAGE_CONTAINER_PATH`). */
  readonly rootPath: string;
  /** Temp direktorij na istom filesystemu (`ATTACHMENT_TEMP_PATH`). */
  readonly tempPath: string;
  readonly maxSizeBytes: number;
  readonly allowedMime: readonly string[];
  readonly validateMagicBytes: boolean;
  readonly signingSecret: string;
  readonly signedUrlTtlSeconds: number;
  /** Prefiks za potpisane URL-ove (`/api/v1`). */
  readonly publicPrefix: string;
}

/** Čita opcije iz ENV-a (jedno mjesto gdje se imena varijabli spajaju s kodom). */
export function attachmentOptionsFromEnv(env = getEnv()): AttachmentStorageOptions {
  return {
    rootPath: env.VFM_STORAGE_CONTAINER_PATH,
    tempPath: env.ATTACHMENT_TEMP_PATH,
    maxSizeBytes: maxFileSizeBytes(env),
    allowedMime: env.ATTACHMENT_ALLOWED_MIME,
    validateMagicBytes: env.ATTACHMENT_VALIDATE_MAGIC_BYTES,
    signingSecret: env.FILE_SIGNING_SECRET ?? 'dev-file-signing-secret',
    signedUrlTtlSeconds: env.FILE_SIGNED_URL_TTL_SECONDS,
    publicPrefix: '/api/v1',
  };
}

/** Snapshot za audit (`before`/`after`) — kontroler ga predaje `AuditContext`. */
export interface AttachmentMutation<T> {
  readonly data: T;
  readonly before?: Readonly<Record<string, unknown>>;
  readonly after?: Readonly<Record<string, unknown>>;
}

/** Minimalni oblik korisnika potreban servisu (lakše testiranje). */
export interface AttachmentActor {
  readonly id: string;
  readonly isSuperAdmin?: boolean;
  readonly permissions?: {
    readonly isSuperAdmin: boolean;
    readonly permissions: ReadonlyMap<string, string>;
    readonly grants?: readonly {
      readonly permission: string;
      readonly scope: string;
      readonly scopeVehicleIds?: readonly string[];
      readonly scopeDriverIds?: readonly string[];
    }[];
  };
}

const SELECT = {
  id: true,
  ownerType: true,
  ownerId: true,
  stage: true,
  fileName: true,
  storageKey: true,
  mimeType: true,
  ext: true,
  sizeBytes: true,
  sha256: true,
  width: true,
  height: true,
  exifStripped: true,
  uploadedById: true,
  taskId: true,
  formFieldKey: true,
  createdAt: true,
  deletedAt: true,
} as const;

interface AttachmentRow {
  id: string;
  ownerType: Attachment['ownerType'];
  ownerId: string;
  stage: Attachment['stage'];
  fileName: string;
  storageKey: string;
  mimeType: string;
  ext: string;
  sizeBytes: bigint;
  sha256: string;
  width: number | null;
  height: number | null;
  exifStripped: boolean;
  uploadedById: string;
  taskId: string | null;
  formFieldKey: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

@Injectable()
export class AttachmentsService {
  private readonly overrides?: Partial<AttachmentStorageOptions>;
  private resolved?: AttachmentStorageOptions;

  constructor(
    private readonly prisma: PrismaService,
    /** Opcione izmjene konfiguracije; bez njih se čita ENV (`@Optional`). */
    @Optional() @Inject(ATTACHMENT_STORAGE_OPTIONS) overrides?: Partial<AttachmentStorageOptions>,
  ) {
    this.overrides = overrides ?? undefined;
  }

  /**
   * Efektivne opcije — ENV se čita **lijeno** (pri prvom uploadu), ne u
   * konstruktoru: time DI ne zavisi od ENV-a, a testovi mogu dati svoje putanje.
   */
  private get options(): AttachmentStorageOptions {
    if (!this.resolved) {
      this.resolved = { ...attachmentOptionsFromEnv(), ...this.overrides };
    }
    return this.resolved;
  }

  /** Efektivne opcije (testovi provjeravaju limit veličine). */
  getOptions(): AttachmentStorageOptions {
    return this.options;
  }

  // --- Upload ----------------------------------------------------------------

  /**
   * Prima fajl, validira ga i sprema na disk + u bazu.
   *
   * Zapis je u tom trenutku vezan na uploadera (`ownerType: OTHER`,
   * `ownerId: actor.id`) — pravi vlasnik se postavlja kroz `complete`, da
   * prekinuti upload ne ostane „zakačen" za zapis koji još ne postoji.
   */
  async upload(file: UploadedFileLike | undefined, actor: AttachmentActor): Promise<AttachmentUploadResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new VfmException('VALIDATION_ERROR', 'Fajl nedostaje.', [detail('file', 'Obavezan')]);
    }

    if (file.buffer.length > this.options.maxSizeBytes) {
      throw VfmErrors.payloadTooLarge(this.options.maxSizeBytes);
    }

    const detected = this.options.validateMagicBytes
      ? detectFileType(file.buffer)
      : { mimeType: file.mimetype, ext: extensionOf(file.originalname) };

    if (!detected) {
      throw VfmErrors.unsupportedMediaType(this.options.allowedMime);
    }
    if (!this.options.allowedMime.includes(detected.mimeType)) {
      throw VfmErrors.unsupportedMediaType(this.options.allowedMime);
    }

    const { buffer, stripped } = stripImageMetadata(file.buffer, detected.mimeType);
    const sha256 = sha256Hex(buffer);

    // Idempotentnost: isti sadržaj za istog uploadera ne pravi novi red.
    const existing = await this.prisma.attachment.findFirst({
      where: { ownerType: 'OTHER', ownerId: actor.id, sha256, deletedAt: null },
      select: SELECT,
    });
    if (existing) {
      return toUploadResult(existing as AttachmentRow);
    }

    const storageKey = buildStorageKey(sha256, detected.ext);
    await this.writeFile(storageKey, buffer);

    const row = await this.prisma.attachment.create({
      data: {
        id: randomUUID(),
        ownerType: 'OTHER',
        ownerId: actor.id,
        stage: 'GENERAL',
        fileName: sanitizeFileName(file.originalname, detected.ext),
        storageKey,
        mimeType: detected.mimeType,
        ext: detected.ext,
        sizeBytes: BigInt(buffer.length),
        sha256,
        exifStripped: stripped,
        uploadedById: actor.id,
      } as unknown as Prisma.AttachmentUncheckedCreateInput,
      select: SELECT,
    });

    return toUploadResult(row as AttachmentRow);
  }

  /** Veže upload na vlasnika (`ownerType`/`ownerId`/`stage`). */
  async complete(
    id: string,
    input: CompleteAttachmentInput,
    actor: AttachmentActor,
  ): Promise<AttachmentMutation<Attachment>> {
    if (input.taskId !== undefined && (input.ownerType !== 'TASK' || input.taskId !== input.ownerId)) {
      throw VfmErrors.validationError([
        {
          path: ['taskId'],
          message: 'taskId mora odgovarati ownerId kada je vlasnik priloga TASK.',
          code: 'custom',
        },
      ]);
    }

    const current = await this.loadOrThrow(id);
    this.assertUploadScope(actor, current);
    await this.assertOwnerScope(actor, input);

    const updated = await this.prisma.attachment.update({
      where: { id },
      data: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        stage: input.stage,
        taskId: input.ownerType === 'TASK' ? input.ownerId : null,
        formFieldKey: input.formFieldKey ?? null,
      } as unknown as Prisma.AttachmentUncheckedUpdateInput,
      select: SELECT,
    });

    return {
      data: toAttachment(updated as AttachmentRow),
      before: { ownerType: current.ownerType, ownerId: current.ownerId, stage: current.stage },
      after: { ownerType: input.ownerType, ownerId: input.ownerId, stage: input.stage },
    };
  }

  // --- Čitanje ---------------------------------------------------------------

  async get(id: string, actor: AttachmentActor): Promise<Attachment> {
    const row = await this.loadOrThrow(id);
    this.assertViewScope(actor, row);
    return toAttachment(row);
  }

  async list(query: AttachmentListQuery, actor: AttachmentActor): Promise<AttachmentListResponse> {
    const where: Record<string, unknown> = {
      ownerType: query.ownerType,
      ownerId: query.ownerId,
      deletedAt: null,
    };
    // Bez `ALL` opsega korisnik vidi samo svoje upload-e (P14).
    if (!this.hasAllScope(actor)) where.uploadedById = actor.id;

    const [rows, total] = await Promise.all([
      this.prisma.attachment.findMany({
        where: where as unknown as Prisma.AttachmentWhereInput,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: SELECT,
      }),
      this.prisma.attachment.count({ where: where as unknown as Prisma.AttachmentWhereInput }),
    ]);

    return {
      items: (rows as AttachmentRow[]).map(toAttachment),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Sadržaj fajla (bajtovi) + metapodaci — za stream i za audit. */
  async content(id: string, actor?: AttachmentActor): Promise<{ attachment: Attachment; buffer: Buffer }> {
    const row = await this.loadOrThrow(id);
    if (actor) this.assertViewScope(actor, row);

    const absolute = this.absolutePath(row.storageKey);
    const buffer = await readFile(absolute).catch(() => {
      throw new VfmException('NOT_FOUND', 'Fajl priloga ne postoji u storage-u.');
    });

    return { attachment: toAttachment(row), buffer };
  }

  // --- Potpisani URL ---------------------------------------------------------

  /** Token `exp.sig` — `exp` u sekundama, `sig` = HMAC-SHA256(`id|actorId|exp`). */
  signUrl(id: string, actorId: string, now: Date = new Date()): AttachmentSignedUrl {
    const exp = Math.floor(now.getTime() / 1000) + this.options.signedUrlTtlSeconds;
    const sig = this.signature(id, actorId, exp);
    const token = `${exp}.${sig}`;
    return {
      url: `${this.options.publicPrefix}/attachments/${id}/content/${token}`,
      expiresAt: toUtcIso(new Date(exp * 1000)),
      token,
    };
  }

  /** Provjera tokena (bez bacanja — pozivalac odlučuje šta dalje). */
  verifySignedToken(id: string, token: string, actorId: string, now: Date = new Date()): boolean {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [expPart, sigPart] = parts;
    if (!expPart || !sigPart || !/^\d+$/u.test(expPart)) return false;

    const exp = Number(expPart);
    if (!Number.isFinite(exp) || exp * 1000 <= now.getTime()) return false;

    const expected = Buffer.from(this.signature(id, actorId, exp));
    const actual = Buffer.from(sigPart);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  // --- Izmjena i brisanje ----------------------------------------------------

  /**
   * Nova verzija priloga: novi red dobija iste `ownerType`/`ownerId`/`stage`,
   * a stari se soft-briše (fajl ostaje u storage-u, historija se ne gubi).
   */
  async replace(
    id: string,
    file: UploadedFileLike | undefined,
    actor: AttachmentActor,
  ): Promise<AttachmentMutation<Attachment>> {
    const current = await this.loadOrThrow(id);
    this.assertUploadScope(actor, current);
    await this.assertOwnerScope(actor, {
      id: current.id,
      ownerType: current.ownerType,
      ownerId: current.ownerId,
      stage: current.stage,
      ...(current.taskId ? { taskId: current.taskId } : {}),
    });

    const uploaded = await this.upload(file, actor);

    const updated = await this.prisma.attachment.update({
      where: { id: uploaded.id },
      data: {
        ownerType: current.ownerType,
        ownerId: current.ownerId,
        stage: current.stage,
        taskId: current.taskId,
        formFieldKey: current.formFieldKey,
      } as unknown as Prisma.AttachmentUncheckedUpdateInput,
      select: SELECT,
    });

    await this.prisma.attachment.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });

    return {
      data: toAttachment(updated as AttachmentRow),
      before: { id: current.id, sha256: current.sha256 },
      after: { id: uploaded.id, sha256: uploaded.sha256 },
    };
  }

  async remove(id: string, actor: AttachmentActor): Promise<AttachmentMutation<null>> {
    const current = await this.loadOrThrow(id);
    this.assertDeleteScope(actor, current);

    await this.prisma.attachment.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });

    return {
      data: null,
      before: { id: current.id, fileName: current.fileName, sha256: current.sha256 },
      after: { deletedAt: new Date().toISOString() },
    };
  }

  // --- Interno ---------------------------------------------------------------

  private async loadOrThrow(id: string): Promise<AttachmentRow> {
    const row = await this.prisma.attachment.findFirst({
      where: { id, deletedAt: null },
      select: SELECT,
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Prilog nije pronađen.');
    return row as AttachmentRow;
  }

  private async assertOwnerScope(actor: AttachmentActor, input: CompleteAttachmentInput): Promise<void> {
    // Read scope is not a write grant: only Super Admin bypasses the target's mutation scope.
    if (actor.isSuperAdmin) return;

    let allowed = false;
    switch (input.ownerType) {
      case 'OTHER':
        allowed = input.ownerId === actor.id;
        break;
      case 'VEHICLE': {
        const row = await this.prisma.vehicle.findFirst({
          where: { id: input.ownerId, deletedAt: null },
          select: { id: true, createdById: true },
        });
        if (!row) throw VfmErrors.notFound('vozilo');
        allowed = this.hasResourceScope(actor, 'vehicle:update', {
          ownerId: row.createdById,
          vehicleId: row.id,
        });
        break;
      }
      case 'DRIVER': {
        const row = await this.prisma.driver.findFirst({
          where: { id: input.ownerId, deletedAt: null },
          select: { id: true, createdById: true },
        });
        if (!row) throw VfmErrors.notFound('vozač');
        allowed = this.hasResourceScope(actor, 'driver:update', {
          ownerId: row.createdById,
          driverId: row.id,
        });
        break;
      }
      case 'SERVICE': {
        const row = await this.prisma.serviceRecord.findFirst({
          where: { id: input.ownerId, deletedAt: null },
          select: { createdById: true, vehicleId: true },
        });
        if (!row) throw VfmErrors.notFound('servisni zapis');
        allowed = this.hasResourceScope(actor, 'service:update', {
          ownerId: row.createdById,
          vehicleId: row.vehicleId,
        });
        break;
      }
      case 'REGISTRATION': {
        const row = await this.prisma.registrationRecord.findFirst({
          where: { id: input.ownerId, deletedAt: null },
          select: { createdById: true, vehicleId: true },
        });
        if (!row) throw VfmErrors.notFound('registracija');
        allowed = this.hasResourceScope(actor, 'registration:update', {
          ownerId: row.createdById,
          vehicleId: row.vehicleId,
        });
        break;
      }
      case 'INSURANCE': {
        const row = await this.prisma.insuranceRecord.findFirst({
          where: { id: input.ownerId, deletedAt: null },
          select: { createdById: true, vehicleId: true },
        });
        if (!row) throw VfmErrors.notFound('osiguranje');
        allowed = this.hasResourceScope(actor, 'insurance:update', {
          ownerId: row.createdById,
          vehicleId: row.vehicleId,
        });
        break;
      }
      case 'TASK': {
        const row = await this.prisma.task.findFirst({
          where: { id: input.ownerId, deletedAt: null },
          select: { createdById: true, assigneeUserId: true, vehicleId: true, status: true },
        });
        if (!row) throw VfmErrors.notFound('zadatak');
        const updateScope = actor.permissions?.permissions.get('task:update');
        const canUpdateTask =
          (updateScope === 'ALL' && row.status !== 'COMPLETED' && row.status !== 'CANCELLED') ||
          (updateScope === 'OWN' &&
            row.status === 'OPEN' &&
            (row.createdById === actor.id || row.assigneeUserId === actor.id));
        const resource = { vehicleId: row.vehicleId };
        const canCompleteTask =
          row.status === 'IN_PROGRESS' &&
          row.assigneeUserId === actor.id &&
          this.hasResourceScope(actor, 'task:complete', { ...resource, ownerId: row.assigneeUserId });
        const canOverrideCompletion =
          row.status === 'IN_PROGRESS' &&
          this.hasResourceScope(actor, 'task:complete_override', {
            ...resource,
            ownerId: row.createdById,
          });
        allowed = canUpdateTask || canCompleteTask || canOverrideCompletion;
        break;
      }
      case 'TIRE': {
        const row = await this.prisma.tire.findFirst({
          where: { id: input.ownerId, deletedAt: null },
          select: {
            set: {
              select: {
                createdById: true,
                installations: {
                  where: { deletedAt: null },
                  select: { vehicleId: true },
                },
              },
            },
          },
        });
        if (!row) throw VfmErrors.notFound('guma');
        const set = row.set;
        allowed = Boolean(
          set &&
          this.hasResourceScope(actor, 'tire:update', {
            ownerId: set.createdById,
            vehicleIds: set.installations.map((installation) => installation.vehicleId),
          }),
        );
        break;
      }
      case 'REPORT_EXPORT': {
        const row = await this.prisma.exportJob.findFirst({
          where: { id: input.ownerId },
          select: { requestedById: true },
        });
        if (!row) throw VfmErrors.notFound('izvoz');
        allowed = this.hasResourceScope(actor, 'report:export', { ownerId: row.requestedById });
        break;
      }
    }

    if (!allowed) {
      throw VfmErrors.scopeDenied([
        {
          path: ['ownerType', 'ownerId'],
          message: 'Nemate dozvolu za vezivanje priloga na ovaj zapis.',
          code: 'scope_denied',
        },
      ]);
    }
  }

  private hasResourceScope(
    actor: AttachmentActor,
    permission: string,
    resource: {
      ownerId?: string | null;
      vehicleId?: string | null;
      vehicleIds?: readonly string[];
      driverId?: string | null;
    },
  ): boolean {
    if (actor.isSuperAdmin) return true;
    const scope = actor.permissions?.permissions.get(permission);
    if (scope === 'ALL') return true;
    if (scope === 'OWN') return resource.ownerId === actor.id;
    const grants = actor.permissions?.grants ?? [];
    if (scope === 'VEHICLE_IDS') {
      const ids = grants
        .filter((grant) => grant.permission === permission && grant.scope === scope)
        .flatMap((grant) => grant.scopeVehicleIds ?? []);
      return [resource.vehicleId, ...(resource.vehicleIds ?? [])].some(
        (id) => id !== null && id !== undefined && ids.includes(id),
      );
    }
    if (scope === 'DRIVER_IDS') {
      const ids = grants
        .filter((grant) => grant.permission === permission && grant.scope === scope)
        .flatMap((grant) => grant.scopeDriverIds ?? []);
      return resource.driverId !== null && resource.driverId !== undefined && ids.includes(resource.driverId);
    }
    return false;
  }

  /** Čitanje svih priloga ne daje pravo dovršiti ni zamijeniti tuđi upload. */
  private assertUploadScope(actor: AttachmentActor, row: AttachmentRow): void {
    if (row.uploadedById === actor.id || actor.isSuperAdmin) return;
    throw new VfmException('PERMISSION_DENIED', 'Prilog je uploadovao drugi korisnik.', [
      detail('uploadedById', row.uploadedById),
    ]);
  }

  private assertDeleteScope(actor: AttachmentActor, row: AttachmentRow): void {
    const scope = actor.permissions?.permissions.get('attachment:delete');
    if (actor.isSuperAdmin || scope === 'ALL' || (scope === 'OWN' && row.uploadedById === actor.id)) return;
    throw VfmErrors.scopeDenied([
      { path: ['attachment:delete'], message: 'Prilog nije u vašem delete opsegu.', code: 'scope_denied' },
    ]);
  }

  /** Bez `ALL` opsega vidi se samo vlastiti upload (P14). */
  private assertViewScope(actor: AttachmentActor, row: AttachmentRow): void {
    if (row.uploadedById === actor.id || this.hasAllScope(actor)) return;
    throw new VfmException('PERMISSION_DENIED', 'Nemate pristup ovom prilogu.', [detail('id', row.id)]);
  }

  private hasAllScope(actor: AttachmentActor): boolean {
    if (actor.isSuperAdmin) return true;
    const permissions = actor.permissions;
    if (!permissions) return false;
    return hasPermission(
      { ...permissions, list: [], grants: [] } as Parameters<typeof hasPermission>[0],
      'attachment:view',
      'ALL',
    );
  }

  private signature(id: string, actorId: string, exp: number): string {
    return createHmac('sha256', this.options.signingSecret)
      .update(`${id}|${actorId}|${exp}`)
      .digest('base64url');
  }

  private absolutePath(storageKey: string): string {
    if (!isSafeStorageKey(storageKey)) {
      throw new VfmException('VALIDATION_ERROR', 'Neispravna putanja priloga.');
    }
    const root = resolve(this.options.rootPath);
    const absolute = resolve(root, storageKey);
    if (absolute !== root && !absolute.startsWith(`${root}/`)) {
      throw new VfmException('VALIDATION_ERROR', 'Putanja priloga izlazi iz storage-a.');
    }
    return absolute;
  }

  /** Atomarni upis: temp fajl → `rename` (isti filesystem, vidi docs/10). */
  private async writeFile(storageKey: string, buffer: Buffer): Promise<void> {
    const target = this.absolutePath(storageKey);
    await mkdir(dirname(target), { recursive: true });

    const tmp = join(this.options.tempPath, `${randomUUID()}.part`);
    await mkdir(this.options.tempPath, { recursive: true });
    await writeFile(tmp, buffer);

    try {
      await rename(tmp, target);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      // Temp i storage su na različitim filesystemima — direktan upis.
      await writeFile(target, buffer);
    }
  }

  /** Provjera postojanja fajla (dijagnostika/health). */
  async exists(id: string): Promise<boolean> {
    const row = await this.loadOrThrow(id);
    return stat(this.absolutePath(row.storageKey))
      .then(() => true)
      .catch(() => false);
  }
}

function detail(path: string, message: string): ApiErrorDetail {
  return { path: [path], message } as ApiErrorDetail;
}

function extensionOf(fileName: string): string {
  const ext = fileName.includes('.') ? (fileName.split('.').pop() ?? '') : '';
  return (
    ext
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, '')
      .slice(0, 8) || 'bin'
  );
}

/** Ime fajla je metapodatak — skidamo putanju i kontrolne znakove. */
function sanitizeFileName(fileName: string, ext: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? '';
  // Kontrolni znakovi (0x00-0x1f, 0x7f) ne smiju ući u ime fajla; filter umjesto
  // regex-a da lint ne prijavljuje `no-control-regex`.
  const clean = [...base]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  return clean.trim().slice(0, 255) || `fajl.${ext}`;
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    ownerType: row.ownerType as Attachment['ownerType'],
    ownerId: row.ownerId,
    stage: row.stage as Attachment['stage'],
    fileName: row.fileName,
    mimeType: row.mimeType,
    ext: row.ext,
    sizeBytes: Number(row.sizeBytes),
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    exifStripped: row.exifStripped,
    uploadedById: row.uploadedById,
    taskId: row.taskId,
    formFieldKey: row.formFieldKey,
    createdAt: toUtcIso(row.createdAt),
    deletedAt: row.deletedAt ? toUtcIso(row.deletedAt) : null,
  };
}

function toUploadResult(row: AttachmentRow): AttachmentUploadResult {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    ext: row.ext,
    sizeBytes: Number(row.sizeBytes),
    sha256: row.sha256,
  };
}

export { toAttachment };
