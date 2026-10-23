# Faza 3 — izvještaj o implementaciji i provjeri

**Datum presjeka:** 22.10.2026.
**Status:** aktivna — postojeći moduli su predmet audita; DoD nije potvrđen.

## Sažetak

U repozitoriju već postoje API moduli i web ekrani za vozila, vozače, registracije, osiguranje, podsjetnike i priloge. Postoje i jedinični testovi za glavne servise, skeniranje podsjetnika, historiju kilometraže i obradu priloga. Prisustvo koda i jediničnih testova samo po sebi ne potvrđuje P13/P14 niti završetak Faze 3.

| Područje                  | Nalaz                                                                                                                                                                                                                                                                                                                                                       | Status                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Vozila i kilometraža      | API servis i jedinični testovi postoje; read scope `OWN`/`VEHICLE_IDS` i `ALL` je sačuvan. Mutacije provjeravaju scope za update/archive/delete, odometar i ograničavaju create na `OWN`/`ALL`.                                                                                                                                                             | Resursni scope je pokriven u servisima; P14 end-to-end još otvoren       |
| Vozači i PII              | API/web moduli postoje; PII polja, slobodni tekst, dinamički `formData` i foto-privitak se rediguju bez `driver:view_pii`; list/detail/kategorije čitaju `OWN`/`DRIVER_IDS`. Create/update/archive/delete i izmjene kategorija provjeravaju scope.                                                                                                          | PII matrica i P14 end-to-end još otvoreni                                |
| Registracije i osiguranje | List/detail filtriraju `OWN`/`VEHICLE_IDS`; create provjerava ciljano vozilo, update/delete zapis, `ALL` ostaje dozvoljen. Ručna migracija zabranjuje preklapanje perioda.                                                                                                                                                                                  | Resursni scope je pokriven u servisima; DB integracija još nije izvršena |
| Servisi i stavke          | List/detail, kreiranje, izmjena/brisanje i stavke računa provjeravaju `service:view/create/update/delete` opseg; lista kombinuje korisničke filtere i scope u AND uslovu.                                                                                                                                                                                   | Jedinični testovi opsega prolaze; P14 end-to-end nije izvršen            |
| Gume                      | Kompleti i historija montaža provjeravaju scope na list/detail/mutacijama; filteri se spajaju sa scope-om, a prikaz kompleta uklanja vozila izvan opsega.                                                                                                                                                                                                   | Regresijski testovi prolaze; P14 end-to-end nije izvršen                 |
| Podsjetnici               | Scheduler koristi `dedupeKey`, `createMany(skipDuplicates: true)` i `Europe/Sarajevo`; `reminder:view` sa `OWN` ograničava listu na vozila/vozače koje je korisnik kreirao, a acknowledge/snooze provjeravaju `OWN` nad povezanim vozilom/vozačem, uz `ALL` za administratora.                                                                              | Ciljani regresijski testovi prolaze; P14 end-to-end nije izvršen         |
| Prilozi                   | List/get/url/content koriste `attachment:view`; brisanje provjerava `attachment:delete` scope tako da `view:ALL` ne nadjačava `delete:OWN`; `complete` i `replace` provjeravaju write scope ciljnog zapisa i vlasništvo nad uploadom (read `ALL` ne daje write pravo), uključujući `task:complete_override`; `taskId` ne može vezati prilog za drugi zapis. | Ciljani regresijski test prolazi; P14 nije potvrđen end-to-end           |
| Forme i migracije         | Globalni `form:view` ostaje za definicije; lista/detalj migracije (sa `before/after` uzorcima) zahtijevaju `form:migrate_records`.                                                                                                                                                                                                                          | Ciljani metadata test prolazi; P14 nije potvrđen end-to-end              |
| Web ekrani                | Feature moduli postoje za vozila, vozače i podsjetnike. Direktne URL rute izvještaja, obavijesti, zdravlja i profila provjeravaju `report:view`, `notification:view`, `system:view_health` i `auth:login`; backend ostaje autoritet. | Ciljani web guard testovi prolaze; kompletan tok-audit i API E2E otvoreni |

## P13 — testovi prihvatanja

Postoje jedinični testovi za idempotentnost i raspoređivanje podsjetnika, preklapanje perioda na nivou servisa, kilometražu i priloge. Oni koriste zamjenske objekte i ne dokazuju da su PostgreSQL ograničenja i indeksi zaista aktivni u bazi.

Dodat je `apps/api/test/integration/phase3-database.integration.spec.ts`. Na namjenskoj testnoj bazi test u jednoj transakciji provjerava da baza odbija preklapanje registracija/osiguranja (`23P01`) i duplirani ključ podsjetnika (`23505`), te potvrđuje hronološko čitanje historije servisa i montaža guma i odbijanje druge aktivne montaže istog seta (`23505`). Transakcija se uvijek vraća. Test traži objavljene VEHICLE, REGISTRATION, INSURANCE i SERVICE forme i inicijalizovanu politiku podsjetnika; prije pokretanja izvršiti migracije i seed nad testnom bazom.

U ovom okruženju test je otkriven, ali preskočen jer `PHASE3_TEST_DATABASE_URL` nije postavljen. To nije dokaz prolaza P13. Pragovi, DST i izračuni podsjetnika i dalje imaju jedinične pokriće, ali nije pokrenuta provjera njihove stvarne DB integracije.

Pokretanje protiv **isključivo namjenske testne baze**:

```bash
PHASE3_TEST_DATABASE_URL="postgresql://.../vfm_test" corepack pnpm --filter @vfm/api test:integration
```

Ne koristiti produkcijski URL: test obavlja probne upise, iako ih završava rollback-om.

## P14 — autorizacija

P14 je i dalje otvoren: `docs/09-TEST_PLAN.md` traži OpenAPI-wide provjeru dozvola, uključujući sadržaj priloga i potpisane URL-ove. `p14-route-authorization-coverage.spec.ts` skenira rute modula i health kontrolera, validira metadata i poredi guard odluke s seed pravima triju sistemskih uloga. Dodatni `p14-http-permission-guard.spec.ts` za svaku takvu metadata deklaraciju montira privremenu Nest HTTP rutu i provjerava 200/403 za SUPER_ADMIN, ADMINISTRATOR i OBICNI_KORISNIK te da 403 zahtjev ne ulazi u handler. `p14-attachments-http-guard.spec.ts` pokreće stvarni `AttachmentsController` kroz HTTP uz zamjenski servis: nedozvoljenim korisnicima vraća 403 prije poziva servisa, neispravan potpisani token vraća 401 bez bajtova, a `attachment:view:ALL` sam ne daje `attachment:delete`. `p14-drivers-pii-http.spec.ts` pokreće stvarni `DriversController` i `DriversService` s fake Prisma: ADMINISTRATOR dobija redigovan PII, SUPER_ADMIN puni PII, obični korisnik biva odbijen, a `DRIVER_IDS` opseg ne dopušta pristup neobuhvaćenom vozaču. `p14-vehicles-scope-http.spec.ts` pokreće stvarne `VehiclesController`/`VehiclesService`: potvrđuje da `vehicle:view:ALL` ostaje dozvoljen običnom korisniku, da `VEHICLE_IDS` dozvoljava dodijeljeno vozilo, a odbija drugo. `p14-users-pii-http.spec.ts` pokreće stvarni `UsersController`/`UsersService`: `user:view_pii:OWN` otkriva vlastite, ali ne tuđe PII podatke; bez prava PII ostaje maskiran. `p14-registrations-scope-http.spec.ts` pokreće stvarni `RegistrationsController`/`RegistrationsService`: HTTP lista registracija filtrira zapise na vozila iz `VEHICLE_IDS` opsega i odbija korisnika bez `registration:view`. Puni OpenAPI sweep stvarnih kontrolera/servisa i opsega ostaje na čekanju.

Audit je potvrdio razliku prema doslovnom P14 očekivanju: potpisani URL je ranije radio kao javni bearer token bez sesije. Ispravljena je zaštita: izdavanje URL-a i preuzimanje sada traže `attachment:view`; ruta s tokenom više nije javna, ponovo provjerava opseg priloga, a HMAC potpis veže token za ID korisnika i rok važenja. Web klijent preuzima bajtove uz memorijski access token umjesto otvaranja javnog linka. Brisanje sada primjenjuje `attachment:delete` scope zasebno; `attachment:view:ALL` ne daje brisanje tuđih upload-a pod `delete:OWN`. Dodani su regresijski testovi za metapodatke permisije, vezivanje tokena za korisnika, autentifikovano preuzimanje i brisanje; puna P14 matrica svih OpenAPI ruta i dalje nije izvršena.

Web audit je našao da su „Izvještaji“, „Obavijesti“, „Zdravlje sistema“ i „Profil“ bili sakriveni/filtrirani po pravu u navigaciji, ali se neki ekrani mogli otvoriti direktnim URL-om. Rute sada koriste `RequirePermission` (`report:view`, `notification:view`, `system:view_health`, `auth:login`). Regresijski test provjerava svih 16 stavki navigacije s permisijom prema odgovarajućoj router ruti. Ovo je UX/autorizacijski guard web klijenta, ne zamjena za backend provjeru. API health probe rute ostaju javne za Docker/Coolify.

`/obavijesti` i `/izvjestaji` su i dalje skeletni ekrani po planu: centar obavijesti je predviđen za Fazu 5 (W19), a izvještaji/izvoz za Fazu 7 (W28). Njihova puna funkcionalnost nije dio trenutnog audita Faze 3; u nastavku se preskače do odgovarajućih faza.

Dodatno, raniji F2-O2 i resursni opsezi ostaju relevantni: generički `form:view`/list endpoint ne smije se smatrati ekvivalentom prava nad konkretnim vozilom, vozačem ili prilogom. Lista/detalj migracija sada traže `form:migrate_records`, jer preview i stavke mogu sadržavati before/after podatke. List/detail rute vozila, vozača, registracija i osiguranja, historija kilometraže i kategorije dozvole imaju serversko filtriranje/provjeru opsega. Write rute ovih resursa sada provjeravaju scope za kreiranje, izmjenu, arhivu/brisanje, odometar i kategorije dozvole. Servisi i stavke računa provjeravaju scope prema kreatoru zapisa ili vozilu, a list filter se spaja sa scope uslovom pomoću `AND`. Kompleti guma i historija montaža provjeravaju scope za list/detail i mutacije; povezani prikaz vozila i zapisi korištenja ograničavaju se prema dodijeljenim vozilima. Podsjetnici filtriraju `OWN` prema kreatoru povezanog vozila/vozača; acknowledge/snooze provjeravaju scope nad istim resursom (`OWN` ili `ALL`). Regresijski testovi pokrivaju odbijanje izvan opsega i spajanje query/scope uslova. PII politika i ostale rute još nisu kompletno verifikovane; P14 nije zatvoren.

## Verifikacija u ovom prolazu

- `corepack pnpm --filter @vfm/api exec vitest run test/unit/p14-route-authorization-coverage.spec.ts` — prolaz: sve rute su deklarisane/izuzete po pravilu, permisije/opsezi su validni, a odluka guard-a je poređena s seed grantovima tri sistemske role.
- `corepack pnpm --filter @vfm/api exec vitest run test/unit/p14-http-permission-guard.spec.ts` — prolaz: HTTP guard sweep nad svim rutama s permisijskim metadata; odbijeni zahtjevi daju 403 i handler se ne izvršava.
- `corepack pnpm --filter @vfm/api exec vitest run test/unit/p14-attachments-http-guard.spec.ts` — prolaz: 4 HTTP test slučaja stvarnog `AttachmentsController`-a uz zamjenski servis.
- `corepack pnpm --filter @vfm/api exec vitest run test/unit/p14-drivers-pii-http.spec.ts` — prolaz: 3 HTTP test slučaja stvarnog `DriversController`-a i `DriversService`-a uz fake Prisma; pokriveni su PII redakcija i `DRIVER_IDS` scope.
- `corepack pnpm --filter @vfm/api exec vitest run test/unit/p14-vehicles-scope-http.spec.ts` — prolaz: 3 HTTP test slučaja stvarnih `VehiclesController`/`VehiclesService`; pokriven je `vehicle:view:ALL` i scope `VEHICLE_IDS`.
- `corepack pnpm --filter @vfm/api exec vitest run test/unit/p14-users-pii-http.spec.ts` — prolaz: 2 HTTP test slučaja stvarnih `UsersController`/`UsersService`; provjeren je PII scope `OWN`.
- `corepack pnpm --filter @vfm/api exec vitest run test/unit/p14-registrations-scope-http.spec.ts` — prolaz: 2 HTTP test slučaja stvarnih `RegistrationsController`/`RegistrationsService`; scope filtrira listu registracija po vozilima.
- `corepack pnpm --filter @vfm/api exec vitest run --config vitest.integration.config.ts` — prolaz alata; jedan integracijski fajl i oba testa preskočena zbog nedostajućeg `PHASE3_TEST_DATABASE_URL`.
- `corepack pnpm --filter @vfm/api typecheck` — prolaz.
- `corepack pnpm --filter @vfm/api test` — prethodni prolaz prije izmjena scope-a podsjetnika: 58 fajlova, 945 jediničnih testova.
- Ciljani API testovi (11 fajlova: auth guardovi, permissions service, users/roles/attachments kontroleri, rute P14, zadaci, forme/migracije/opcije i obavijesti) — **204/204** jediničnih testova prolaze. `PrismaService` je izolovan/mockovan gdje je potreban; ovo nije HTTP/E2E sweep i ne dokazuje autorizaciju nad živom bazom.
- Dodatni raniji ciljani testovi nakon izmjena scope-a: `reminders-service.spec.ts` — 22 testa; `attachments-service.spec.ts` — 17 testova.
- `corepack pnpm --filter @vfm/shared exec vitest run test/permissions.spec.ts` — prolaz: 34 testa.
- `corepack pnpm --filter @vfm/web exec vitest run src/app/router-permissions.test.tsx src/app/guards.test.tsx src/app/nav.test.ts` — prolaz: 32 web testova, uključujući mapiranje svih 16 permisijskih stavki navigacije na route guard; ESLint i `@vfm/web typecheck` prolaze. `@vfm/form-renderer build` je pokrenut kao lokalni workspace dependency build da bi router test učitao sve stranice.
- `corepack pnpm --filter @vfm/web test` — prethodni prolaz: 23 fajla, 166 testova.
- ESLint nad izmijenjenim API i shared fajlovima — prolaz; API i web `typecheck` su prošli u ranijem prolazu prije trenutne Prisma blokade.
- Trenutni API `typecheck` i puna testna serija blokirani su nedostajućim generisanim Prisma klijentom: `prisma generate` nije mogao preuzeti `schema-engine` sa `binaries.prisma.sh` (TLS veza odbijena). Ne zaobilaziti ograničenje; ciljani podsjetnik test prolazi uz mock za PrismaService.
- Nije pokrenuta živa DB/API provjera. Korisnik je prijavio da su commitovi koje je ručno mergao iz ove grane u `main` redeployani bez pada backend/frontend servisa; to je korisnički prijavljen rezultat, ne nezavisna provjera, i ne obuhvata izmjene iz ovog prolaza dok se ne mergeaju.

## Sljedeća stavka za nastavak

**P14 puni OpenAPI HTTP/E2E sweep** nad preostalim kontrolerima i servisima: sistemske uloge × opsezi, te svi osjetljivi PII i dokumentni tokovi. Guard-level harness pokriva sve permission metadata deklaracije; attachment kontroler je testiran uz fake servis, a driver kontroler i PII servis uz fake Prisma. Potrebna je još šira pokrivenost stvarnih ruta, ostalih scope logika i produkcijskih servisa/pohrane.

## Sljedeći koraci

1. Nastaviti P14 runtime sweep nad svim OpenAPI rutama i ulogama/opsezima; obuhvatiti priloge, potpisane URL-ove i PII.
2. P13 integracijski test je spreman, ali pokretanje na namjenskoj bazi čeka `PHASE3_TEST_DATABASE_URL`; nakon pokretanja razmotriti DB scenarije pragova/DST-a.
3. Web audit nastaviti samo za tokove obuhvaćene Fazom 3; ne implementirati sada centre obavijesti ni izvještaje.
4. Tek nakon dokaza ažurirati DoD u `docs/PLAN_IMPLEMENTACIJE.md`; do tada Faza 3 ostaje otvorena.
