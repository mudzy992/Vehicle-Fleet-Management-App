/**
 * Transakcijski outbox — pripremna logika (P-05, puna implementacija u Fazi 5).
 *
 * Zašto outbox:
 *   `DB transakcija` i `slanje u Redis/FCM` nisu atomski. Ako upišemo domensku
 *   promjenu pa Redis padne, obavijest se zauvijek gubi. Zato se **u istoj
 *   transakciji** upisuje i red `Outbox`, a worker ga kasnije prenese u BullMQ
 *   i označi `SENT` (uz retry i `DEAD` nakon N pokušaja).
 *
 * Stanje u Fazi 0:
 *   - `publish()` radi **publish-or-buffer**: ako je Redis dostupan, posao ide
 *     odmah u BullMQ; ako nije, ostaje u memoriji i loguje se upozorenje.
 *   - Trajno rješenje (tabela `Outbox` + Prisma transakcija) dolazi u Fazi 5,
 *     kada Prisma client bude generisan (vidi `prisma/schema.prisma`).
 *
 * ⚠️ In-memory buffer se **gubi pri restartu** — to je poznato ograničenje
 *    Faze 0 i eksplicitno je označeno u `docs/PLAN_IMPLEMENTACIJE.md`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from './queue.service.js';
import { type EnqueueResult } from './queue.service.js';
import type { QueueName } from '@vfm/shared';

export interface OutboxEvent<T = unknown> {
  /** Tip događaja, npr. `task.claimed`, `reminder.registration_expiry`. */
  readonly eventType: string;
  /** Entitet na koji se odnosi (`entityType:entityId`). */
  readonly aggregateId: string;
  readonly payload: T;
  /** Ciljni red (default `outbox`). */
  readonly queue?: QueueName;
  /** Idempotency ključ (P-06/P-07): isti ključ → isti posao, bez duplikata. */
  readonly idempotencyKey?: string;
  /** Odgoda isporuke u ms (npr. podsjetnik 7 dana prije roka). */
  readonly delayMs?: number;
  readonly occurredAt?: string;
}

/** Buffer limit da se izbjegne curenje memorije pri dužem outageu Redisa. */
const MAX_BUFFERED_EVENTS = 1000;

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly buffer: OutboxEvent[] = [];
  private droppedCount = 0;

  constructor(private readonly queues: QueueService) {}

  /**
   * Objavljuje događaj. Vraća rezultat enqueue operacije; `ok=false` znači da
   * je događaj ostao u privremenom bufferu (Faza 0) ili da će biti preuzet iz
   * tabele `Outbox` (Faza 5).
   */
  async publish<T>(event: OutboxEvent<T>): Promise<EnqueueResult> {
    const queueName: QueueName = event.queue ?? 'outbox';

    const result = await this.queues.enqueue(
      queueName,
      event.eventType,
      {
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        idempotencyKey: event.idempotencyKey,
        occurredAt: event.occurredAt ?? new Date().toISOString(),
      },
      {
        jobId: event.idempotencyKey,
        delayMs: event.delayMs,
      },
    );

    if (!result.ok) {
      this.bufferEvent(event);
    }
    return result;
  }

  /**
   * Idempotency ključ za podsjetnike: `(entity, type, threshold)` → tačno jedan
   * podsjetnik (P-07). Format je stabilan i čitljiv u Redisu.
   */
  reminderKey(entityType: string, entityId: string, reminderType: string, threshold: string | number): string {
    return `reminder:${entityType}:${entityId}:${reminderType}:${threshold}`;
  }

  /** Broj događaja u privremenom bufferu (health/metrics). */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /** Broj odbacenih događaja (buffer pun) — alarm u Fazi 8. */
  get droppedEventCount(): number {
    return this.droppedCount;
  }

  /** Prazni buffer (koristi worker kada se Redis vrati). */
  async flush(): Promise<{ flushed: number; failed: number }> {
    if (this.buffer.length === 0) return { flushed: 0, failed: 0 };

    const pending = this.buffer.splice(0, this.buffer.length);
    let flushed = 0;
    let failed = 0;

    for (const event of pending) {
      const result = await this.queues.enqueue(event.queue ?? 'outbox', event.eventType, event, {
        jobId: event.idempotencyKey,
        delayMs: event.delayMs,
      });
      if (result.ok) {
        flushed += 1;
      } else {
        failed += 1;
        this.bufferEvent(event);
      }
    }

    if (flushed > 0) {
      this.logger.log(`Outbox buffer ispražnjen: ${flushed} događaja poslano, ${failed} nije uspjelo`);
    }
    return { flushed, failed };
  }

  private bufferEvent(event: OutboxEvent): void {
    if (this.buffer.length >= MAX_BUFFERED_EVENTS) {
      this.buffer.shift();
      this.droppedCount += 1;
      if (this.droppedCount === 1 || this.droppedCount % 100 === 0) {
        this.logger.error(
          `Outbox buffer je pun (${MAX_BUFFERED_EVENTS}) — odbačeno ukupno ${this.droppedCount} događaja. ` +
            `Trajno rješenje je tabela Outbox u bazi (Faza 5).`,
        );
      }
      return;
    }
    this.buffer.push(event);
    if (this.buffer.length === 1) {
      this.logger.warn(
        'Redis/redovi nisu dostupni — događaji se privremeno drže u memoriji. ' +
          'Pri restartu procesa se gube; puna garancija dolazi s Outbox tabelom (Faza 5).',
      );
    }
  }
}
