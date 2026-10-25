import { describe, expect, it } from 'vitest';
import { notificationCopy, type OutboxRow } from '../../src/infra/queue/outbox-processor.js';

function event(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    aggregateType: 'TASK',
    aggregateId: '22222222-2222-4222-8222-222222222222',
    eventType: 'TASK_CLAIMED',
    payload: { code: 'T-2026-001', recipientUserIds: [] },
    idempotencyKey: 'task:claim:v1',
    attempts: 1,
    ...overrides,
  };
}

describe('outbox notification mapping', () => {
  it('daje lokalizovan naslov i tekst za task događaje', () => {
    expect(notificationCopy(event())).toEqual({
      title: 'Zadatak preuzet',
      body: 'Zadatak T-2026-001 je preuzet.',
    });
  });

  it('ima stabilan fallback za nepoznat tip agregata/događaja', () => {
    expect(
      notificationCopy(
        event({
          aggregateType: 'TireInstallation',
          eventType: 'TIRE_INSTALLED',
          aggregateId: '33333333-3333-4333-8333-333333333333',
          payload: {},
        }),
      ),
    ).toEqual({
      title: 'Obavijest o promjeni',
      body: 'TireInstallation 33333333-3333-4333-8333-333333333333 je ažuriran.',
    });
  });
});
