import { describe, expect, it } from 'vitest';
import { applyLinkedRecord } from '../../src/modules/tasks/task-linked-records.js';

const vehicleId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';

function tx(fail = false) {
  return {
    formSchema: {
      findFirst: async () => ({ id: 'form-id', currentPublishedVersionId: 'version-id' }),
    },
    serviceRecord: {
      create: async () => {
        if (fail) throw new Error('evidencija nije upisana');
      },
    },
  };
}

describe('applyLinkedRecord', () => {
  it('WASH ne kreira evidenciju', async () => {
    const result = await applyLinkedRecord({
      tx: tx() as never,
      taskTypeCode: 'WASH',
      vehicleId,
      actorId,
      values: {},
      odometerKm: null,
      totalCost: null,
    });
    expect(result).toBeNull();
  });

  it('SERVICE_VISIT upisuje servisni zapis', async () => {
    const result = await applyLinkedRecord({
      tx: tx() as never,
      taskTypeCode: 'SERVICE_VISIT',
      vehicleId,
      actorId,
      values: { workshopName: 'Bosna Auto', serviceDate: '2026-10-21' },
      odometerKm: 148000,
      totalCost: 9000,
    });
    expect(result).toMatchObject({ type: 'SERVICE' });
    expect(result?.id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('neuspjeh evidencije se propagira za rollback complete', async () => {
    await expect(
      applyLinkedRecord({
        tx: tx(true) as never,
        taskTypeCode: 'SERVICE_VISIT',
        vehicleId,
        actorId,
        values: { serviceDate: '2026-10-21' },
        odometerKm: 1,
        totalCost: 1,
      }),
    ).rejects.toThrow('evidencija nije upisana');
  });
});
