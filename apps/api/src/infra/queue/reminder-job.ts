/**
 * Izvršenje skenera podsjetnika u worker procesu (P-07).
 *
 * Worker ne podiže cijeli Nest kontekst (nema HTTP sloja), pa Prisma klijent
 * pravi lokalno i zatvara ga nakon posla — inače bi svaki cron ciklus ostavljao
 * pool za sobom. Sama logika skena je u `RemindersService.scan()` i pokrivena je
 * jediničnim testovima.
 */
import type { PinoLoggerService } from '../../config/logger.js';
import { RemindersService } from '../../modules/reminders/reminders.service.js';
import type { ReminderScanResult } from '@vfm/shared/schemas';

/** Minimalni oblik klijenta koji skener koristi (lakše testiranje). */
export interface ScanPrisma {
  readonly $disconnect?: () => Promise<void>;
}

export async function runReminderScanJob(
  logger: PinoLoggerService,
  createPrisma: () => ScanPrisma,
): Promise<ReminderScanResult> {
  const prisma = createPrisma();
  try {
    const result = await new RemindersService(prisma as never).scan();
    logger.log(`Skener podsjetnika: kandidata ${result.candidates}, novih ${result.created}.`);
    return result;
  } finally {
    await prisma.$disconnect?.();
  }
}
