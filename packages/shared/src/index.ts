/**
 * `@vfm/shared` — dijeljeni ugovor između API-ja, web-a i mobilne aplikacije.
 *
 * Sadržaj:
 * - `constants`  — prefiksi, mreže, redovi, Redis namespace-ovi, putanje, limiti
 * - `enums`      — enumi domena + državne mašine (zadaci, forme)
 * - `permissions`— katalog permisija, seed matrica, evaluacija prava
 * - `errors`     — katalog kodova grešaka + API envelope
 * - `format`     — formatiranje novca, datuma, rokova, trajanja (bs)
 * - `status-labels` — nazivi statusa na bosanskom + semantika boja
 * - `env-schema` — Zod validacija ENV-a → **zaseban ulaz** `@vfm/shared/env`
 *   (namjerno NIJE u root izvozu: zod ne smije završiti u browser bundle-u)
 *
 * ⚠️ Pravila paketa:
 * 1. Bez I/O, bez framework dependencija (Nest/React) — samo čista logika + zod.
 * 2. Promjena enuma/kodova grešaka = promjena ugovora → ažurirati docs/03, docs/07.
 * 3. Novi Redis namespace/red → ažurirati `REDIS_ACL.md` **i upozoriti vlasnika**.
 * 4. Server-only kod (ENV, Node API) ide u zasebne ulaze (`./env`), nikad u root.
 */
export * from './constants.js';
export * from './enums.js';
export * from './permissions.js';
export * from './errors.js';
export * from './format.js';
export * from './status-labels.js';
