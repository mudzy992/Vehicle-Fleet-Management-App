import { describe, expect, it } from 'vitest';
import {
  nextServicesPageAfterDelete,
  serviceDeleteConfirmation,
  serviceDeletedMessage,
} from './service-delete-model.js';

const record = { serviceDate: '2026-02-01', serviceType: 'Veliki servis' };

describe('service-delete-model', () => {
  it('potvrda navodi servis, nestanak stavki iz evidencije, rokove i očuvanu km historiju', () => {
    const message = serviceDeleteConfirmation(record);

    expect(message).toContain('Veliki servis');
    expect(message).toContain('2026');
    expect(message).toContain('stavke nestaju iz aktivne evidencije');
    expect(message).toContain('rokovi vozila se ponovo računaju');
    expect(message).toContain('historija kilometraže ostaje sačuvana');
  });

  it('poruka nakon brisanja identifikuje obrisani servis', () => {
    expect(serviceDeletedMessage(record)).toContain('Veliki servis');
    expect(serviceDeletedMessage(record)).toContain('je obrisan');
  });

  it('brisanje jedinog reda vraća korisnika na prethodnu stranu', () => {
    expect(nextServicesPageAfterDelete(3, 1)).toBe(2);
    expect(nextServicesPageAfterDelete(2, 0)).toBe(1);
  });

  it('strana ostaje ista kad na njoj ima još zapisa ili je prva', () => {
    expect(nextServicesPageAfterDelete(3, 2)).toBe(3);
    expect(nextServicesPageAfterDelete(1, 1)).toBe(1);
  });
});
