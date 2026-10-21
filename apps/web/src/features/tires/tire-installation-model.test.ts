/** Payloadi montaže moraju ostati usklađeni sa strict API DTO-ima. */
import { describe, expect, it } from 'vitest';
import {
  buildDismountPayload,
  buildMountPayload,
  buildSwapPayload,
  defaultTirePositions,
  toggleTirePosition,
} from './tire-installation-model.js';

const vehicleId = '11111111-1111-4111-8111-111111111111';
const setId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';

describe('Montaže guma — model ekrana', () => {
  it('pozicije drži u stabilnom redoslijedu i poštuje broj guma kompleta', () => {
    expect(toggleTirePosition(['RR'], 'FL', true)).toEqual(['FL', 'RR']);
    expect(defaultTirePositions(2)).toEqual(['FL', 'FR']);
    expect(defaultTirePositions(4, ['RR', 'FL'])).toEqual(['FL', 'RR']);
    expect(defaultTirePositions(8)).toEqual(['FL', 'FR', 'RL', 'RR', 'SPARE']);
  });

  it('gradi mount i swap payload s tačnom verzijom forme', () => {
    expect(
      buildMountPayload({
        vehicleId,
        setId,
        date: '2026-01-15',
        odometerKm: '1500',
        positions: ['FR', 'FL'],
        formData: { workshopName: 'Radionica' },
        formSchemaVersionId: versionId,
      }),
    ).toEqual({
      vehicleId,
      setId,
      mountedAt: '2026-01-15',
      mountedOdometerKm: 1500,
      positions: ['FL', 'FR'],
      formData: { workshopName: 'Radionica' },
      formSchemaVersionId: versionId,
    });

    expect(
      buildSwapPayload({
        vehicleId,
        currentInstallationId: setId,
        currentVersion: 4,
        newSetId: setId,
        date: '2026-01-31',
        odometerKm: '1800',
        positions: ['FL'],
        reason: '',
        storageLocation: ' Regala 3 ',
        formData: {},
        formSchemaVersionId: versionId,
      }),
    ).toMatchObject({
      currentVersion: 4,
      reason: 'SEASONAL_SWAP',
      storageLocationOnDismount: 'Regala 3',
    });
  });

  it('demontaža izostavlja prazan razlog i skladište', () => {
    expect(
      buildDismountPayload({
        version: 2,
        date: '2026-02-01',
        odometerKm: '2000',
        reason: ' ',
        storageLocation: ' ',
      }),
    ).toEqual({ version: 2, dismountedAt: '2026-02-01', dismountedOdometerKm: 2000 });
  });

  it('odbija nepotpun komplet, pozicije i kilometražu prije zahtjeva', () => {
    const base = {
      vehicleId,
      setId,
      date: '2026-01-15',
      odometerKm: '1500',
      positions: ['FL'],
      formData: {},
      formSchemaVersionId: versionId,
    };
    expect(() => buildMountPayload({ ...base, setId: '' })).toThrow('Odaberite komplet');
    expect(() => buildMountPayload({ ...base, positions: [] })).toThrow('barem jednu poziciju');
    expect(() => buildMountPayload({ ...base, odometerKm: '15.5' })).toThrow('Kilometraža');
    expect(() => buildMountPayload({ ...base, date: '' })).toThrow('Datum montaže');
  });
});
