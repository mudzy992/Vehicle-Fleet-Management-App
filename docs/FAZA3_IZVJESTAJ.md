# Faza 3 — izvještaj o implementaciji i provjeri

**Datum presjeka:** 22.10.2026.  
**Status:** aktivna — postojeći moduli su predmet audita; DoD nije potvrđen.

## Sažetak

U repozitoriju već postoje API moduli i web ekrani za vozila, vozače, registracije, osiguranje, podsjetnike i priloge. Postoje i jedinični testovi za glavne servise, skeniranje podsjetnika, historiju kilometraže i obradu priloga. Prisustvo koda i jediničnih testova samo po sebi ne potvrđuje P13/P14 niti završetak Faze 3.

| Područje                  | Nalaz                                                                                                                                                           | Status                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Vozila i kilometraža | API servis i jedinični testovi postoje; read scope `OWN`/`VEHICLE_IDS` i `ALL` je sačuvan. Mutacije provjeravaju scope za update/archive/delete, odometar i ograničavaju create na `OWN`/`ALL`. | Resursni scope je pokriven u servisima; P14 end-to-end još otvoren |
| Vozači i PII | API/web moduli postoje; PII se maskira prema `driver:view_pii`; list/detail/kategorije čitaju `OWN`/`DRIVER_IDS`. Create/update/archive/delete i izmjene kategorija provjeravaju scope. | PII matrica i P14 end-to-end još otvoreni |
| Registracije i osiguranje | List/detail filtriraju `OWN`/`VEHICLE_IDS`; create provjerava ciljano vozilo, update/delete zapis, `ALL` ostaje dozvoljen. Ručna migracija zabranjuje preklapanje perioda. | Resursni scope je pokriven u servisima; DB integracija još nije izvršena |
| Servisi i stavke | List/detail, kreiranje, izmjena/brisanje i stavke računa provjeravaju `service:view/create/update/delete` opseg; lista kombinuje korisničke filtere i scope u AND uslovu. | Jedinični testovi opsega prolaze; P14 end-to-end nije izvršen |
| Gume | Kompleti i historija montaža provjeravaju scope na list/detail/mutacijama; filteri se spajaju sa scope-om, a prikaz kompleta uklanja vozila izvan opsega. | Regresijski testovi prolaze; P14 end-to-end nije izvršen |
| Podsjetnici | Scheduler koristi `dedupeKey`, `createMany(skipDuplicates: true)` i `Europe/Sarajevo`; `reminder:view` sa `OWN` ograničava listu na vozila/vozače koje je korisnik kreirao, a acknowledge/snooze provjeravaju `OWN` nad povezanim vozilom/vozačem, uz `ALL` za administratora. | Ciljani regresijski testovi prolaze; P14 end-to-end nije izvršen |
| Prilozi                   | List/get/url/content koriste `attachment:view`; brisanje provjerava `attachment:delete` scope tako da `view:ALL` ne nadjačava `delete:OWN`.                             | Ciljani regresijski test prolazi; P14 nije potvrđen end-to-end |
| Web ekrani                | Postoje feature moduli za vozila, vozače i podsjetnike; P14 test prolaza kroz sve API rute još nije pronađen.                                                   | Audit u toku                                              |

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

Audit je potvrdio razliku prema doslovnom P14 očekivanju: potpisani URL je ranije radio kao javni bearer token bez sesije. Ispravljena je zaštita: izdavanje URL-a i preuzimanje sada traže `attachment:view`; ruta s tokenom više nije javna, ponovo provjerava opseg priloga, a HMAC potpis veže token za ID korisnika i rok važenja. Web klijent preuzima bajtove uz memorijski access token umjesto otvaranja javnog linka. Brisanje sada primjenjuje `attachment:delete` scope zasebno; `attachment:view:ALL` ne daje brisanje tuđih upload-a pod `delete:OWN`. Dodani su regresijski testovi za metapodatke permisije, vezivanje tokena za korisnika, autentifikovano preuzimanje i brisanje; puna P14 matrica svih OpenAPI ruta i dalje nije izvršena.

Dodatno, raniji F2-O2 i resursni opsezi ostaju relevantni: generički `form:view`/list endpoint ne smije se smatrati ekvivalentom prava nad konkretnim vozilom, vozačem ili prilogom. List/detail rute vozila, vozača, registracija i osiguranja, historija kilometraže i kategorije dozvole imaju serversko filtriranje/provjeru opsega. Write rute ovih resursa sada provjeravaju scope za kreiranje, izmjenu, arhivu/brisanje, odometar i kategorije dozvole. Servisi i stavke računa provjeravaju scope prema kreatoru zapisa ili vozilu, a list filter se spaja sa scope uslovom pomoću `AND`. Kompleti guma i historija montaža provjeravaju scope za list/detail i mutacije; povezani prikaz vozila i zapisi korištenja ograničavaju se prema dodijeljenim vozilima. Podsjetnici filtriraju `OWN` prema kreatoru povezanog vozila/vozača; acknowledge/snooze provjeravaju scope nad istim resursom (`OWN` ili `ALL`). Regresijski testovi pokrivaju odbijanje izvan opsega i spajanje query/scope uslova. PII politika i ostale rute još nisu kompletno verifikovane; P14 nije zatvoren.

## Verifikacija u ovom prolazu

- `corepack pnpm --filter @vfm/api exec vitest run --config vitest.integration.config.ts` — prolaz alata; jedan integracijski fajl i oba testa preskočena zbog nedostajućeg `PHASE3_TEST_DATABASE_URL`.
- `corepack pnpm --filter @vfm/api typecheck` — prolaz.
- `corepack pnpm --filter @vfm/api test` — prethodni prolaz prije izmjena scope-a podsjetnika: 58 fajlova, 945 jediničnih testova.
- Ciljani API testovi nakon izmjena scope-a: `reminders-service.spec.ts` — 22 testa; `attachments-service.spec.ts` — 17 testova.
- `corepack pnpm --filter @vfm/shared exec vitest run test/permissions.spec.ts` — prolaz: 34 testa.
- `corepack pnpm --filter @vfm/web test` — prethodni prolaz: 23 fajla, 166 testova.
- ESLint nad izmijenjenim API i shared fajlovima — prolaz; API i web `typecheck` su prošli u ranijem prolazu prije trenutne Prisma blokade.
- Trenutni API `typecheck` i puna testna serija blokirani su nedostajućim generisanim Prisma klijentom: `prisma generate` nije mogao preuzeti `schema-engine` sa `binaries.prisma.sh` (TLS veza odbijena). Ne zaobilaziti ograničenje; ciljani podsjetnik test prolazi uz mock za PrismaService.
- Nije pokrenuta živa DB/API provjera. Korisnik je prijavio da su commitovi koje je ručno mergao iz ove grane u `main` redeployani bez pada backend/frontend servisa; to je korisnički prijavljen rezultat, ne nezavisna provjera, i ne obuhvata izmjene iz ovog prolaza dok se ne mergeaju.

## Sljedeći koraci

1. Pokrenuti novi integracijski test na izolovanoj testnoj bazi i dopuniti P13 testovima pragova raspoređivanja, DST-a i historije servisa/guma.
2. Nastaviti audit preostalih modula (posebno obavijesti, forme i zadaci) i potvrditi task autorizaciju kroz P14 regresijske testove.
3. Izvesti P14 matricu svih OpenAPI ruta × uloge/opseg, uz posebne slučajeve za priloge, potpisane URL-ove i PII; potvrditi da nedozvoljene uloge dobijaju 401/403 na svakoj ruti.
4. Završiti audit web tokova prema Fazi 3 i dopuniti regresijske testove za potvrđene nedostatke.
5. Tek nakon dokaza ažurirati DoD u `docs/PLAN_IMPLEMENTACIJE.md`; do tada Faza 3 ostaje otvorena.
