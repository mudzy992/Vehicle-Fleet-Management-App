# Faza 3 — izvještaj o implementaciji i provjeri

**Datum presjeka:** 22.10.2026.  
**Status:** aktivna — postojeći moduli su predmet audita; DoD nije potvrđen.

## Sažetak

U repozitoriju već postoje API moduli i web ekrani za vozila, vozače, registracije, osiguranje, podsjetnike i priloge. Postoje i jedinični testovi za glavne servise, skeniranje podsjetnika, historiju kilometraže i obradu priloga. Prisustvo koda i jediničnih testova samo po sebi ne potvrđuje P13/P14 niti završetak Faze 3.

| Područje                  | Nalaz                                                                                                                    | Status                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Vozila i kilometraža      | API servis i jedinični testovi postoje; web funkcionalnost je prisutna.                                                  | Audit u toku                                             |
| Vozači i PII              | API/web moduli postoje; servis maskira PII prema `driver:view_pii`. Potrebna je provjera na nivou ruta i stvarnih uloga. | Audit u toku                                             |
| Registracije i osiguranje | Servisi i jedinični testovi postoje; ručna migracija dodaje DB zabranu preklapanja perioda.                              | DB integracija dodata; još nije izvršena na testnoj bazi |
| Podsjetnici               | Scheduler koristi `dedupeKey`, `createMany(skipDuplicates: true)` i `Europe/Sarajevo`; postoje jedinični testovi.        | P13 djelimično pokriven                                  |
| Prilozi                   | Postoje provjere opsega kod list/get/url/content sesije i audit pristupa.                                                | P14 nije potvrđen end-to-end                             |
| Web ekrani                | Postoje feature moduli za vozila, vozače i podsjetnike; P14 test prolaza kroz sve API rute još nije pronađen.            | Audit u toku                                             |

## P13 — testovi prihvatanja

Postoje jedinični testovi za idempotentnost i raspoređivanje podsjetnika, preklapanje perioda na nivou servisa, kilometražu i priloge. Oni koriste zamjenske objekte i ne dokazuju da su PostgreSQL ograničenja i indeksi zaista aktivni u bazi.

Dodat je `apps/api/test/integration/phase3-database.integration.spec.ts`. Na namjenskoj testnoj bazi test u jednoj transakciji provjerava da baza odbija preklapanje registracija i osiguranja (`23P01`) i duplirani ključ podsjetnika (`23505`); transakcija se uvijek vraća. Test traži objavljene forme i inicijalizovanu politiku podsjetnika, pa prije pokretanja treba izvršiti migracije i seed nad testnom bazom.

U ovom okruženju test je otkriven, ali preskočen jer `PHASE3_TEST_DATABASE_URL` nije postavljen. To nije dokaz prolaza P13. Nisu pronađeni namjenski integracijski testovi za pragove podsjetnika, promjenu ljetno/zimskog računanja vremena niti historiju servisa/guma na stvarnoj bazi.

Pokretanje protiv **isključivo namjenske testne baze**:

```bash
PHASE3_TEST_DATABASE_URL="postgresql://.../vfm_test" corepack pnpm --filter @vfm/api test:integration
```

Ne koristiti produkcijski URL: test obavlja probne upise, iako ih završava rollback-om.

## P14 — autorizacija

P14 je i dalje otvoren: `docs/09-TEST_PLAN.md` traži OpenAPI-wide provjeru dozvola, uključujući sadržaj priloga i potpisane URL-ove, a pronađen je samo pending označeni E2E zadatak. Ovaj audit nije pokrenuo probu za sve rute i uloge.

Audit je potvrdio razliku prema doslovnom P14 očekivanju: potpisani URL je ranije radio kao javni bearer token bez sesije. Ispravljena je zaštita: izdavanje URL-a i preuzimanje sada traže `attachment:view`; ruta s tokenom više nije javna, ponovo provjerava opseg priloga, a HMAC potpis veže token za ID korisnika i rok važenja. Web klijent preuzima bajtove uz memorijski access token umjesto otvaranja javnog linka. Dodani su regresijski testovi za metapodatke permisije, vezivanje tokena za korisnika i autentifikovano preuzimanje; puna P14 matrica svih OpenAPI ruta i dalje nije izvršena.

Dodatno, raniji F2-O2 i resursni opsezi ostaju relevantni: generički `form:view`/list endpoint ne smije se smatrati ekvivalentom prava nad konkretnim vozilom, vozačem ili prilogom. P14 treba provjeriti efektivni opseg na svakom endpointu, ne samo prisustvo permission dekoratora.

## Verifikacija u ovom prolazu

- `corepack pnpm --filter @vfm/api exec vitest run --config vitest.integration.config.ts` — prolaz alata; jedan integracijski fajl i oba testa preskočena zbog nedostajućeg `PHASE3_TEST_DATABASE_URL`.
- `corepack pnpm --filter @vfm/api typecheck` — prolaz.
- `corepack pnpm --filter @vfm/api test` — prolaz: 58 fajlova, 925 jediničnih testova.
- `corepack pnpm --filter @vfm/web test` — prolaz: 23 fajla, 166 testova.
- API i web `typecheck` — prolaz; ESLint nad izmijenjenim API/web fajlovima — prolaz.
- Nije pokrenuta živa DB/API provjera. Raniji korisnički izvještaj o uspješnom redeployu i DB/HTTP provjeri ostaje korisnički prijavljen rezultat, ne nezavisna provjera ovog audita.

## Sljedeći koraci

1. Pokrenuti novi integracijski test na izolovanoj testnoj bazi i dopuniti P13 testovima pragova raspoređivanja, DST-a i historije servisa/guma.
2. Izvesti P14 matricu svih OpenAPI ruta × uloge/opseg, uz posebne slučajeve za priloge, potpisane URL-ove i PII; potvrditi da nedozvoljene uloge dobijaju 401/403 na svakoj ruti.
3. Završiti audit web tokova prema Fazi 3 i dopuniti regresijske testove za potvrđene nedostatke.
4. Tek nakon dokaza ažurirati DoD u `docs/PLAN_IMPLEMENTACIJE.md`; do tada Faza 3 ostaje otvorena.
