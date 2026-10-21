import { describe, expect, it } from 'vitest';
import { formatServiceMoney, formatServiceQuantity } from './service-items-display.js';
describe('Prikaz servisnog računa', () => {
  it('prikazuje feninge kao KM s decimalnim zarezom i dvije decimale', () => {
    expect(formatServiceMoney(4550)).toBe('45,50 KM');
    expect(formatServiceMoney(0)).toBe('0,00 KM');
    expect(formatServiceMoney(1)).toBe('0,01 KM');
  });
  it('grupiše hiljade bez gubljenja preciznosti iznosa', () => {
    expect(formatServiceMoney(123456)).toBe('1.234,56 KM');
  });
  it('količinu iz stotinki prikazuje bez suvišnih nula', () => {
    expect(formatServiceQuantity(150)).toBe('1,5');
    expect(formatServiceQuantity(100)).toBe('1');
    expect(formatServiceQuantity(101)).toBe('1,01');
  });
});
