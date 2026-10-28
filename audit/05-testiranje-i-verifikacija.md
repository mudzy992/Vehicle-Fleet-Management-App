# 05 — Testovi i verifikacija Faze 1

**Datum posljednje provjere:** 22.10.2026.
**Grana:** `arena/d46d9ae6-vehicle-fleet-management-app`; `HEAD 720c655` + necommitovane audit izmjene.
**Važno:** lokalni sandbox rezultat, ne CI/GitHub Actions green check. Pet ranijih mobile diffs nije dio Faza 1 izmjena i ostaje zaštićeno.

## Rezultati

| Provjera | Rezultat | Detalj |
|---|---|---|
| Puna Turbo gate | PASS | `lint typecheck test build`: **25/25 taskova**, exit `0`; 21 task iz cache-a, 4 izvršena u ovom prolazu |
| API puna unit suite | PASS | **56 fajlova / 916 testova**, sve prolaze u punom gate prolazu |
| API ciljani regression subset | PASS | **8 fajlova / 197 testova** za auth, users, roles, audit, rate-limit |
| API migration diagnostics | PASS | **22 testa**; očekivana lista uključuje `4_super_admin_guard_lock` |
| Web session regression | PASS | **1 fajl / 5 testova**; trenutna sesija se lokalno čisti bez dodatnog logout/refresh poziva |
| Python verifier sintaksa | PASS | `python3 -m py_compile scripts/db-verify/apply_migrations.py scripts/db-verify/behavior_tests.py`; generated `__pycache__` uklonjen |
| Prisma Client task | PASS uz env/cache ograničenje | Turbo task iz cache-a; komanda je koristila `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`. Ovo nije dokaz native engine download/migrate deploy |
| PostgreSQL migracije 3–4 + behavior verifier | NOT RUN | Migracije nisu primijenjene; DB concurrency verifier mora proći izoliranu PostgreSQL bazu prije deploya |
| Redis live failure/integration | NOT RUN | PEXPIRE failure je pokriven unit fake-om; Redis ACL/timeout nije live-provjeren |
| HTTP/API integration | NOT RUN | Repo nema izvršenu integration suite za ovaj prolaz |
| E2E Playwright/Cypress/Maestro | NOT RUN | `audit/03-plan-E2E.md` je scenarijska specifikacija, ne runner |
| Native Android build/device UAT | NOT RUN | Nema EAS builda, Android uređaja ni device runtime dokaza |
| Coverage | NOT RUN u dopuni | Coverage brojke iz izvornog izvještaja 20.10.2026. nisu aktuelizovane |
| ENV sync | NOT RUN u dopuni | Izvorno `0` upozorenja / 154 varijable (20.10) nije ponovljeno 22.10 |

## Komanda pune gate

Repo root; shim je sandbox-only workaround za Turbo koji ne nalazi `pnpm` executable:

```bash
PATH="/tmp/vfm-pnpm-bin:$PATH" PRISMA_SCHEMA_ENGINE_BINARY=/bin/true corepack pnpm exec turbo run lint typecheck test build
```

API target subset i web session test su izvršeni zasebno prije pune gate:

```bash
PATH="/tmp/vfm-pnpm-bin:$PATH" PRISMA_SCHEMA_ENGINE_BINARY=/bin/true corepack pnpm --filter @vfm/api exec vitest run test/unit/auth-service.spec.ts test/unit/auth-controller.spec.ts test/unit/users-service.spec.ts test/unit/users-controller.spec.ts test/unit/roles-controller.spec.ts test/unit/audit-log-service.spec.ts test/unit/rate-limit.spec.ts test/unit/audit.spec.ts
PATH="/tmp/vfm-pnpm-bin:$PATH" PRISMA_SCHEMA_ENGINE_BINARY=/bin/true corepack pnpm --filter @vfm/web exec vitest run src/features/auth/session.test.tsx
```

`/tmp/vfm-pnpm-bin/pnpm` nije upisan u repo. `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` je lokalan test workaround, nikad deploy postupak. Ne commitati generated client kao zaobilaženje native engine ograničenja.

## Prvo pokretanje i ponavljanje

Prvi puni gate nakon audit izmjena završio je s jednom greškom u zastarjelom očekivanju `migrate-diagnostics.spec.ts` — očekivana lista nije sadržavala novu migraciju 4. Očekivanje i test naziv su ažurirani; taj fajl je prošao **22/22**, a zatim je ponovljena puna gate uspješno završila **25/25** i API **916/916**.

## Dopuna — 28.10.2026.

- CI run **40712125166** na commit-u `175b096` prolazi: Prisma client generation/migracije nad disposable CI bazom, API unit/integration/stress, P15 persistence test na izolovanom Compose projektu, lint/typecheck, build, security scan i Docker.
- Mobile E2E run **40712125218** na istom commit-u prolazi kompletan P4 acceptance: Maestro admin tok kreira zadatak, potvrđuje obrazac i naslov, pa nakon povratka na listu vidi novokreirani zadatak; Maestro korisnik bez `task:create` nema kontrolu kreiranja; API negativne provjere prolaze. Emulator i PostgreSQL/Redis su disposable CI resursi; produkcija nije korištena.
- A-08 fokusirana scope provjera: `drivers.service.ts` validira `driver:view` pristup zapisu prije PII redakcije; `driver:view_pii` pravila su SUPER_ADMIN, ALL, OWN samo za `createdById === actor.id` i DRIVER_IDS samo za eksplicitno dozvoljeni ID. Testovi `drivers-service.spec.ts`, `p14-drivers-pii-http.spec.ts` i `p14-vehicles-scope-http.spec.ts` prolaze **43/43**. HTTP testovi koriste fake Prisma, bez baze/produkcije. Potvrđen je `vehicle:view:ALL`; potpuni cross-module scope sweep ostaje otvoren.
- P4 raniji neuspjesi razdvojeni su: build runner je jednom dobio oštećen NDK ZIP (retry korak sada instalira tačno pinovani NDK uz ograničene pokušaje); potom su test otkrili da Maestro traži required label bez sufiksa `*` i da lista zadataka nije osvježena pri povratku s detalja. Dodan je stabilan `task-form-field-${field.key}` selector i `useFocusEffect` osvježavanje; konačni run iznad prolazi.
- A-03 web bundle audit: web runtime importi promijenjeni su s package root na browser-safe `@vfm/form-engine/definition`; route stranice su lazy-loaded, a Zod je u zasebnom vendor chunku. `pnpm --filter @vfm/web... build` ne prijavljuje `node:crypto` externalization niti chunk >500 kB; entry chunk je 28.20 kB, najveći `zod` chunk 486.49 kB. Web lint prolazi, Vitest 25/25 fajla i 216/216 testova prolaze. GitHub CI run **40716833274** na commit-u `42f796f` prolazi uključujući lint/typecheck, unit/integration/P15, web/Docker build i security scan. Lokalni Vite preview vraća HTTP 200 za `/prijava` i CSS s očekivanim tokenima; ovo nije browser-console ni runtime navigacijski smoke, zato A-03 ostaje djelimično otvoren.
- A-05 tema: po korisnikovom izboru primijenjena je zajednička grafitna podloga/lime akcent u web i native tokenima; Expo je podešen na tamni interfejs, a primarne kontrole koriste tamni tekst na lime radi kontrasta. Web suite sada sadrži 34 dodatne parity/kontrast provjere; ukupno 25 fajlova i 216 testova prolazi. Web build/lint prolaze; `apps/mobile` typecheck i Android JS export prolaze; GitHub CI **40733993924** prolazi, uključujući sigurnosnu provjeru, testove i web/Docker build. Kontrast provjeren automatski: primary foreground/lime 14.63:1, foreground/background 17.37:1, muted/background 8.67:1, warning/status soft 8.49:1, danger/status soft 5.96:1. Mobile E2E **40733993923** prolazi nakon izmjene teme, uključujući P4 Maestro regresiju; to nije vizuelni acceptance. Lokalni preview vraća HTTP 200 i očekivane CSS tokene. Browser render i fizički Android smoke nisu izvršeni; A-05 ostaje djelimično otvoren.
- Ovo ne zatvara Web Playwright E2E, Android fizički uređaj UAT, ili GPS/privacy acceptance.

## Otvorene provjere prije release-a

1. Pokrenuti `scripts/db-verify/apply_migrations.py` i `behavior_tests.py` na **izoliranoj** PostgreSQL 16 verifier bazi, uključujući idempotentnost migracije 4 i parallel Super Admin removal test. Verifier je destruktivan; ne ciljati produkciju.
2. Potvrditi refresh CAS, password-reset CAS i last-Super-Admin lock stvarnim PostgreSQL concurrency testovima.
3. Pokrenuti Redis integration test za PEXPIRE timeout/ACL failure, cleanup i degraded mode.
4. Dodati/pokrenuti HTTP i browser E2E za Super Admin WEB-only, scope `OWN`/`ALL`, PII, session revoke/logout, reset/refresh race i P1/P2/P3/P14.
5. Pokrenuti Prisma native generation/build u supported CI; lokalni workaround/cache nije takva potvrda.
6. Ponoviti coverage i ENV-sync ako se koriste za završni acceptance zapis.
