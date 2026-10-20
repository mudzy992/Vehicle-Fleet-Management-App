/**
 * `read-cookie` — parsiranje `Cookie` zaglavlja bez `cookie-parser` dependencije.
 *
 * Bitno za `POST /auth/refresh`: web klijent ne šalje tijelo, pa refresh token
 * mora biti pročitán iz cookie-ja. Neispravno zaglavlje ne smije srušiti zahtjev
 * (vrati `undefined` → servis javlja `401 UNAUTHENTICATED`).
 */
import { describe, expect, it } from 'vitest';
import { parseCookieHeader, readCookie } from '../../src/common/http/read-cookie.js';

describe('parseCookieHeader', () => {
  it('parsira više cookie-ja s razmacima oko separatora', () => {
    expect(parseCookieHeader('a=1; b=2;c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('prazno/undefined zaglavlje → prazan objekt', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });

  it('zanemaruje smeće (bez `=`, prazan naziv, `=` u vrijednosti ostaje dio vrijednosti)', () => {
    expect(parseCookieHeader('neispravno; =bez-naziva; token=ab=cd')).toEqual({ token: 'ab=cd' });
  });

  it('kod prvog duplikata pobjeđuje prva vrijednost (RFC 6265: klijent bira)', () => {
    expect(parseCookieHeader('vfm_refresh=prvi; vfm_refresh=drugi')).toEqual({ vfm_refresh: 'prvi' });
  });

  it('dekodira percent-encoding, a neispravan vraća sirovo', () => {
    expect(parseCookieHeader('a=x%2By')).toEqual({ a: 'x+y' });
    expect(parseCookieHeader('a=%E0%A4%A')).toEqual({ a: '%E0%A4%A' });
  });
});

describe('readCookie', () => {
  it('čita traženi cookie iz zaglavlja', () => {
    expect(readCookie({ headers: { cookie: 'x=1; vfm_refresh=RT-token' } }, 'vfm_refresh')).toBe('RT-token');
  });

  it('nedostajući cookie ili zaglavlje → undefined', () => {
    expect(readCookie({ headers: { cookie: 'x=1' } }, 'vfm_refresh')).toBeUndefined();
    expect(readCookie({ headers: {} }, 'vfm_refresh')).toBeUndefined();
    expect(readCookie({}, 'vfm_refresh')).toBeUndefined();
  });

  it('Node niz zaglavlja se spaja prije parsiranja', () => {
    expect(readCookie({ headers: { cookie: ['a=1', 'vfm_refresh=RT'] } }, 'vfm_refresh')).toBe('RT');
  });
});
