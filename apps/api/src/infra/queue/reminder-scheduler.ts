/**
 * Raspored skenera podsjetnika (P-07, docs/10 §4).
 *
 * Skener se pokreće **jednom dnevno u 06:00 Europe/Sarajevo**. Vrijeme je
 * lokalno (N-11) — `tz` u repeat opcijama, ne pretpostavka da server radi u
 * UTC+1, jer ljeti Sarajevo prelazi na UTC+2.
 *
 * `upsertJobScheduler` je idempotentan: restart workera ne pravi novi raspored,
 * samo osvježi postojeći (isto `schedulerId`). Sam skener je dodatno idempotentan
 * kroz `ScheduledReminder.dedupeKey`.
 */
import type { Queue } from 'bullmq';
import { BUSINESS_TIMEZONE } from '../../modules/reminders/reminders.service.js';

/** Ime posla koji worker prepoznaje (`handleJob`). */
export const REMINDER_SCAN_JOB = 'reminder-scan';

/** Stabilan ID rasporeda — ključ idempotentnosti `upsertJobScheduler`. */
export const REMINDER_SCAN_SCHEDULER_ID = 'reminder-scan-daily';

/** Cron: svaki dan u 06:00 (minuta 0, sat 6). */
export const REMINDER_SCAN_PATTERN = '0 6 * * *';

export const REMINDER_SCAN_TIMEZONE = BUSINESS_TIMEZONE;

/** Šablon posla — bez payloada, skener sam čita izvore. */
export function reminderScanJobTemplate(): {
  name: string;
  data: Record<string, never>;
  opts: { removeOnComplete: number; removeOnFail: number; attempts: number };
} {
  return {
    name: REMINDER_SCAN_JOB,
    data: {},
    opts: {
      //  Zadnjih 50 izvršenja je dovoljno za dijagnostiku; starija se brišu.
      removeOnComplete: 50,
      removeOnFail: 50,
      attempts: 3,
    },
  };
}

export async function scheduleReminderScan(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    REMINDER_SCAN_SCHEDULER_ID,
    { pattern: REMINDER_SCAN_PATTERN, tz: REMINDER_SCAN_TIMEZONE },
    reminderScanJobTemplate(),
  );
}
