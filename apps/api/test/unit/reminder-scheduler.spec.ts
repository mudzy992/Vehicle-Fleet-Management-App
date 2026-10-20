/**
 * Raspored skenera podsjetnika (P-07) — bez Redis-a.
 *
 * Provjerava da je cron **06:00 Europe/Sarajevo** (ne UTC i ne fiksni +1) i da
 * je `schedulerId` stabilan, jer o njemu visi idempotentnost `upsertJobScheduler`.
 */
import { describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import {
  REMINDER_SCAN_JOB,
  REMINDER_SCAN_PATTERN,
  REMINDER_SCAN_SCHEDULER_ID,
  REMINDER_SCAN_TIMEZONE,
  reminderScanJobTemplate,
  scheduleReminderScan,
} from '../../src/infra/queue/reminder-scheduler.js';

describe('reminder scheduler', () => {
  it('cron je 06:00 u Europe/Sarajevo', () => {
    expect(REMINDER_SCAN_PATTERN).toBe('0 6 * * *');
    expect(REMINDER_SCAN_TIMEZONE).toBe('Europe/Sarajevo');
    expect(REMINDER_SCAN_JOB).toBe('reminder-scan');
    expect(REMINDER_SCAN_SCHEDULER_ID).toBe('reminder-scan-daily');
  });

  it('šablon posla nosi retry i ograničeno zadržavanje', () => {
    const template = reminderScanJobTemplate();
    expect(template.name).toBe(REMINDER_SCAN_JOB);
    expect(template.data).toEqual({});
    expect(template.opts.attempts).toBe(3);
    expect(template.opts.removeOnComplete).toBe(50);
  });

  it('`scheduleReminderScan` je idempotentan upsert s istim ID-jem', async () => {
    const calls: unknown[] = [];
    const queue = {
      upsertJobScheduler: async (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as Queue;

    await scheduleReminderScan(queue);
    await scheduleReminderScan(queue);

    expect(calls).toHaveLength(2);
    const first = calls[0] as [string, { pattern: string; tz: string }, { name: string }];
    expect(first[0]).toBe(REMINDER_SCAN_SCHEDULER_ID);
    expect(first[1]).toEqual({ pattern: '0 6 * * *', tz: 'Europe/Sarajevo' });
    expect(first[2].name).toBe(REMINDER_SCAN_JOB);
  });
});
