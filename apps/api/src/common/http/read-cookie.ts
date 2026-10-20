/**
 * Čitanje cookie-ja iz `Cookie` zaglavlja **bez** dependencije `cookie-parser`.
 *
 * Zašto bez paketa: refresh token se čita na tačno jednom mjestu (`POST
 * /auth/refresh`), a `cookie-parser` bi dodao middleware koji parsira cookie-je
 * na svakom zahtjevu. Postavljanje cookie-ja (`res.cookie`/`res.clearCookie`)
 * je ugrađeno u Express i ne treba parser.
 *
 * Sigurnost: vrijednost se **ne** dekodira izvan `decodeURIComponent` (bez
 * eval-a, bez JSON parsiranja) — refresh token je base64url i ne sadrži
 * znakove koji zahtijevaju escaping.
 */

/** Parsira `Cookie` zaglavlje u mapu (duplikati: pobjeđuje **prva** vrijednost). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;

    const rawName = part.slice(0, separator).trim();
    if (!rawName || Object.hasOwn(cookies, rawName)) continue;

    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[rawName] = decodeURIComponent(rawValue);
    } catch {
      // Neispravan percent-encoding → uzmi sirovu vrijednost (nije naš token).
      cookies[rawName] = rawValue;
    }
  }

  return cookies;
}

/** Oblik zahtjeva koji nosi `Cookie` zaglavlje (Express i Node http su kompatibilni). */
export interface CookieCarrier {
  readonly headers?: { readonly cookie?: string | readonly string[] | undefined } | undefined;
}

/**
 * Vraća vrijednost cookie-ja ili `undefined` ako ga nema.
 *
 * `headers.cookie` može biti niz (Node dopušta ponovljena zaglavlja) — u tom
 * slučaju se spoje u jednu vrijednost prije parsiranja.
 */
export function readCookie(request: CookieCarrier, name: string): string | undefined {
  const header = request.headers?.cookie;
  const joined = typeof header === 'string' ? header : (header ?? []).join('; ');
  return parseCookieHeader(joined)[name];
}
