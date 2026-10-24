# Faza 4 — Servisi i gume: izvještaj o provjeri

**Datum presjeka:** 25.10.2026.  
**Status:** završeno prema opsegu Faze 4 u `docs/PLAN_IMPLEMENTACIJE.md` §6; build, unit, integration i Docker CI provjere prolaze.

## Šta je potvrđeno

- Servisi: kreiranje i izmjena zapisa, stavke dijelova/rada, troškovi i podsjetnici po datumu/kilometraži postoje u API-ju i pokriveni su testovima.
- Gume: kompleti, pojedinačne gume, montaža/demontaža, swap u jednoj transakciji, historija i iskorištenost postoje u API-ju; web sadrži servisnu historiju vozila, listu kompleta, forme montaže i panel iskorištenosti.
- Zahtjev za verziju forme je ispunjen za svaki servis, komplet guma i instalaciju; dodani su testovi koji provjeravaju ID verzije forme, dvije stavke po servisu, ukupne troškove demo servisa i brojeve demo zapisa.
- Demo seed je idempotentan: kreira četiri servisa, tri kompleta guma i dva ciklusa montaže (jedan završen, jedan aktivan). U produkciji bez `SEED_DEMO_DATA=true` demo zapisi se ne kreiraju.
- Pravilo paralelne montaže istog seta potvrđeno je integracijskim testom protiv izolovane CI PostgreSQL baze: dva konkurentna zahtjeva daju jednu uspješnu montažu, jedan `TIRE_ALREADY_MOUNTED` i jednu aktivnu instalaciju.
- Jedinični testovi provjeravaju i izračun `kmDriven`/`daysInUse` pri demontaži, te swap tok i njegovu transakcijsku atomicity.

## Verifikacija

- GitHub Actions CI run **40138552249** na commit-u `ac174ee`: `env-sync-check`, security scan, unit tests, lint/typecheck, integration tests te build/Docker/Compose provjere — svi uspješno završeni.
- Integration job je koristio privremenu CI bazu, pokrenuo migracije i seed te izvršio integration testove; nije korištena produkcijska baza.
- Posljednji Phase 4 testovi su uključeni u CI unit runu; concurrency test je u `apps/api/test/integration/tire-mount-concurrency.integration.spec.ts`.
- U lokalnom sandboxu `pnpm` nije dostupan, a generisani Prisma klijent nije prisutan. Lokalna Vitest/build provjera stoga nije korištena kao dokaz; autoritativna provjera je CI run iznad.

## Izmjene i preostalo

- Demo podaci Faze 4 dodani u `apps/api/src/tools/seed.ts`, fake Prisma i seed unit testove.
- Nema otvorenih blokera za DoD Faze 4 u repozitoriju. Backup/restore P16 ostaje odgođen kao što je ranije dogovoreno i nije dio Faze 4.
- Nisu mijenjani web/mobile fajlovi u ovom prolazu. Korisničko brisanje `apps/mobile/expo-env.d.ts` ostaje netaknuto.

## Komande / CI

- Ciljani lint za `apps/api/src/tools/seed.ts`, `apps/api/test/helpers/fake-prisma.ts` i `apps/api/test/unit/seed.spec.ts` — prolaz.
- Puna provjera: GitHub Actions CI **40138552249** — uspjeh za sve poslove, uključujući testove, typecheck, build i Docker.
