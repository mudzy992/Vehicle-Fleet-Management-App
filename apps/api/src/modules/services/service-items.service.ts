/** Atomska zamjena stavki: verzija, stavke, zbir i forma čine jednu cjelinu. */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ReplaceServiceItemsInput, ServiceItemInput, ServiceItemsResponse } from '@vfm/shared/schemas';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { VfmException } from '../../common/errors/vfm-error.js';
import { resolveFormVersion, validateRecordValues } from '../../common/form-record-support.js';

/** Zaokruživanje svake stavke na fening; proizvod ostaje unutar sigurnog integera. */
export function serviceItemTotals(items: readonly ServiceItemInput[]) {
  const totals = items.map((item) => Math.floor((item.quantityHundredths * item.unitPrice + 50) / 100));
  const totalCost = totals.reduce((sum, amount) => sum + amount, 0);
  if (totalCost > 2147483647)
    throw new VfmException('VALIDATION_ERROR', 'Ukupni trošak prelazi dozvoljeni iznos.');
  const byKind = (kind: string) =>
    totals.reduce((sum, amount, index) => sum + (items[index]?.kind === kind ? amount : 0), 0);
  return { totals, totalCost, laborCost: byKind('LABOR'), partsCost: byKind('PART') + byKind('FLUID') };
}

@Injectable()
export class ServiceItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string): Promise<ServiceItemsResponse> {
    const row = await this.prisma.serviceRecord.findFirst({
      where: { id, deletedAt: null },
      include: { items: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
    if (!row) throw new VfmException('NOT_FOUND', 'Servisna evidencija nije pronađena.');
    return {
      version: row.version,
      totalCost: row.totalCost,
      items: row.items.map((item) => ({
        id: item.id,
        kind: item.kind as ServiceItemInput['kind'],
        name: item.name,
        quantityHundredths: Math.round(Number(item.quantity) * 100),
        unitPrice: item.unitPrice ?? 0,
        totalPrice: item.totalPrice,
        partNumber: item.partNumber,
        notes: item.notes,
      })),
    };
  }

  async replace(id: string, input: ReplaceServiceItemsInput) {
    const amounts = serviceItemTotals(input.items);
    return this.prisma.$transaction(async (tx) => {
      // Atomski CAS uzima zaključavanje reda; neuspjeh/izuzetak vraća i verziju.
      const claimed = await tx.serviceRecord.updateMany({
        where: {
          id,
          version: input.version,
          deletedAt: null,
          status: 'ACTIVE',
          vehicle: { deletedAt: null, status: { not: 'ARCHIVED' } },
        },
        data: { version: { increment: 1 } },
      });
      if (!claimed.count) {
        const current = await tx.serviceRecord.findFirst({ where: { id, deletedAt: null } });
        if (!current) throw new VfmException('NOT_FOUND', 'Servisna evidencija nije pronađena.');
        if (current.version !== input.version)
          throw new VfmException('VERSION_CONFLICT', 'Evidencija je izmijenjena. Ponovo učitajte stavke.');
        throw new VfmException(
          'VALIDATION_ERROR',
          'Stavke se mijenjaju samo na aktivnom servisu nearhiviranog vozila.',
        );
      }
      const row = await tx.serviceRecord.findUniqueOrThrow({ where: { id }, include: { items: true } });
      const version = await resolveFormVersion(tx as never, {
        subject: 'SERVICE',
        versionId: row.formSchemaVersionId,
        entityLabel: 'servis',
      });
      const values = { ...(row.formData as Record<string, unknown>) };
      // Koristi tačnu zapisnu verziju, uključujući RETIRED; nikad aktivnu novu formu.
      for (const mapping of version.definition.normalizedName ?? []) {
        if (
          mapping.column === 'totalCost' ||
          mapping.column === 'laborCost' ||
          mapping.column === 'partsCost'
        ) {
          const amount = amounts[mapping.column as 'totalCost' | 'laborCost' | 'partsCost'];
          values[mapping.fieldKey] =
            mapping.transform === 'MONEY_TO_FENINZI' ? { amount, currency: 'BAM' } : amount;
        }
      }
      const validated = validateRecordValues({
        subject: 'SERVICE',
        definition: version.definition,
        versionId: version.id,
        versionNumber: version.version,
        status: version.status,
        values,
        isNew: false,
      });
      if (
        validated.normalized.totalCost !== undefined &&
        validated.normalized.totalCost !== amounts.totalCost
      ) {
        throw new VfmException('NORMALIZATION_MISMATCH', 'Forma ne daje isti zbir kao stavke računa.');
      }
      const snapshot = {
        version: input.version,
        totalCost: row.totalCost,
        items: row.items.map((item) => ({ ...item, quantity: String(item.quantity) })),
      };
      await tx.serviceItem.deleteMany({ where: { serviceRecordId: id } });
      if (input.items.length)
        await tx.serviceItem.createMany({
          data: input.items.map((item, index) => ({
            id: randomUUID(),
            serviceRecordId: id,
            kind: item.kind,
            name: item.name,
            quantity: (item.quantityHundredths / 100).toFixed(2),
            unitPrice: item.unitPrice,
            totalPrice: amounts.totals[index]!,
            partNumber: item.partNumber ?? null,
            notes: item.notes ?? null,
            position: index,
          })),
        });
      await tx.serviceRecord.update({
        where: { id },
        data: {
          totalCost: amounts.totalCost,
          laborCost: amounts.laborCost,
          partsCost: amounts.partsCost,
          formData: validated.values as Prisma.InputJsonObject,
        },
      });
      return {
        data: { id, version: input.version + 1, totalCost: amounts.totalCost },
        before: snapshot,
        after: { version: input.version + 1, totalCost: amounts.totalCost, items: input.items },
      };
    });
  }
}
