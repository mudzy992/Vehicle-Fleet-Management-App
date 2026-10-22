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

## Otvorene provjere prije release-a

1. Pokrenuti `scripts/db-verify/apply_migrations.py` i `behavior_tests.py` na **izoliranoj** PostgreSQL 16 verifier bazi, uključujući idempotentnost migracije 4 i parallel Super Admin removal test. Verifier je destruktivan; ne ciljati produkciju.
2. Potvrditi refresh CAS, password-reset CAS i last-Super-Admin lock stvarnim PostgreSQL concurrency testovima.
3. Pokrenuti Redis integration test za PEXPIRE timeout/ACL failure, cleanup i degraded mode.
4. Dodati/pokrenuti HTTP i browser E2E za Super Admin WEB-only, scope `OWN`/`ALL`, PII, session revoke/logout, reset/refresh race i P1/P2/P3/P14.
5. Pokrenuti Prisma native generation/build u supported CI; lokalni workaround/cache nije takva potvrda.
6. Ponoviti coverage i ENV-sync ako se koriste za završni acceptance zapis.
