import { describe, expect, it } from 'vitest';
import type { ServiceRecord } from '@vfm/shared/schemas';
import { buildServiceUpdatePayload, initialServiceEditValues } from './service-edit-model.js';

const record: ServiceRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  vehicleId: '22222222-2222-4222-8222-222222222222',
  serviceDate: '2026-01-20',
  serviceType: 'Mali servis',
  workshopName: 'Radionica A',
  description: 'Zamjena ulja',
  odometerKm: 1000,
  totalCost: 10000,
  currency: 'BAM',
  nextServiceDueDate: '2026-07-20',
  nextServiceDueKm: 11000,
  status: 'ACTIVE',
  formSchemaId: '33333333-3333-4333-8333-333333333333',
  formSchemaVersionId: '44444444-4444-4444-8444-444444444444',
  version: 3,
};

describe('service-edit-model', () => {
  it('početne vrijednosti pretvara null u prazne kontrole', () => {
    expect(
      initialServiceEditValues({
        ...record,
        workshopName: null,
        description: null,
        odometerKm: null,
        nextServiceDueDate: null,
        nextServiceDueKm: null,
      }),
    ).toEqual({
      serviceDate: '2026-01-20',
      serviceType: 'Mali servis',
      workshopName: '',
      description: '',
      odometerKm: '',
      nextServiceDueDate: '',
      nextServiceDueKm: '',
    });
  });

  it('šalje samo stvarne izmjene datuma, km i rokova', () => {
    const values = {
      ...initialServiceEditValues(record),
      serviceDate: '2026-02-01',
      odometerKm: '1500',
      nextServiceDueDate: '2026-08-01',
      nextServiceDueKm: '11500',
    };

    expect(buildServiceUpdatePayload(record, values)).toEqual({
      version: 3,
      serviceDate: '2026-02-01',
      odometerKm: 1500,
      nextServiceDueDate: '2026-08-01',
      nextServiceDueKm: 11500,
    });
  });

  it('pražnjenje opcionalnih polja šalje null samo ako su ranije imala vrijednost', () => {
    const values = {
      ...initialServiceEditValues(record),
      workshopName: ' ',
      odometerKm: '',
      nextServiceDueDate: '',
      nextServiceDueKm: '',
    };

    expect(buildServiceUpdatePayload(record, values)).toEqual({
      version: 3,
      workshopName: null,
      odometerKm: null,
      nextServiceDueDate: null,
      nextServiceDueKm: null,
    });
  });

  it('bez stvarne izmjene ne pravi PATCH payload', () => {
    expect(() => buildServiceUpdatePayload(record, initialServiceEditValues(record))).toThrow('Nema izmjena');
  });

  it('odbija neispravan datum i kilometražu prije zahtjeva', () => {
    const values = initialServiceEditValues(record);
    expect(() => buildServiceUpdatePayload(record, { ...values, serviceDate: '2026-02-30' })).toThrow(
      'Datum servisa',
    );
    expect(() => buildServiceUpdatePayload(record, { ...values, odometerKm: '15.5' })).toThrow(
      'Kilometraža servisa',
    );
    expect(() => buildServiceUpdatePayload(record, { ...values, serviceType: ' ' })).toThrow('Vrsta servisa');
  });

  it('efektivni rok provjerava i kad se mijenja samo jedna strana odnosa', () => {
    const values = initialServiceEditValues(record);
    expect(() => buildServiceUpdatePayload(record, { ...values, nextServiceDueDate: '2026-01-19' })).toThrow(
      'Sljedeći servis ne može prethoditi',
    );
    expect(() => buildServiceUpdatePayload(record, { ...values, nextServiceDueKm: '900' })).toThrow(
      'manjoj kilometraži',
    );
  });
});
