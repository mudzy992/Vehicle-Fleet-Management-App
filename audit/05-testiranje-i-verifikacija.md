# 05 — Testovi i verifikacija baseline-a

**Datum izvršavanja:** 22.10.2026.<br>
**Testni snapshot:** committed `HEAD 44ecf00`; pet lokalnih mobile diffs nije korišteno kao izmjena pod auditom.<br>
**Važno:** ovo je lokalni sandbox rezultat; nije CI/GitHub Actions green check.

## Rezultati

| Provjera                        | Rezultat                      | Detalj                                                                                                                                |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Root package install            | PASS                          | `corepack pnpm install --frozen-lockfile`                                                                                             |
| Non-API unit/component          | PASS                          | Turbo paketi shared 250 + form-engine 147 + form-renderer 13 + web 162 = **572 testa**; API isključen zbog Prisma generate blokera    |
| Non-API typecheck               | PASS                          | 9 Turbo taskova u config/shared/form-engine/form-renderer/web                                                                         |
| Mobile typecheck                | PASS                          | Izvršeno iz `apps/mobile/` nakon workspace installa                                                                                   |
| Non-API lint                    | PASS                          | 5 Turbo paketa config/shared/form-engine/form-renderer/web                                                                            |
| API lint                        | PASS                          | `corepack pnpm --dir apps/api lint`                                                                                                   |
| API unit test — direktni Vitest | PARTIAL/BLOCKED               | 18 od 56 suiteova / **332 testa prolaze**; 38 suiteova ne učitavaju se jer nedostaje `apps/api/src/generated/prisma/client.js`        |
| API typecheck                   | BLOCKED                       | Prisma generated client/tipovi nedostaju; većina TS grešaka su posljedica tog nedostajućeg artifacta, ne potvrđeni source regressions |
| Root Turbo full test            | BLOCKED                       | `prisma generate` pokušao engine/checksum download sa `binaries.prisma.sh`; TLS/network pristup hostu nije dostupan u sandboxu        |
| API integration                 | NOT RUN                       | `apps/api/test/integration/` ne postoji; CI job ga preskače                                                                           |
| E2E Playwright/Cypress/Maestro  | NOT RUN / nema infrastrukture | Nije pronađen runner ili E2E suite                                                                                                    |
| Web production build            | PASS sa upozorenjima          | Vite build uspješan; oko 901 kB main JS chunk, upozorenje >500 kB i `node:crypto` externalized za browser                             |
| Native Android build/device UAT | NOT RUN                       | EAS build, uređaj i credentials nisu korišteni; nema zaključka o runtime/device funkcionalnosti                                       |

## Komande i reproducibilnost

Workspace `turbo` u ovom sandboxu nije našao direktni `pnpm` executable. Za lokalni test napravljen je privremeni shim u `/tmp/vfm-pnpm-bin/pnpm` koji prosljeđuje na `corepack pnpm`; nije upisan u repo.

Provjere koje je moguće ponoviti (repo root):

```bash
corepack pnpm install --frozen-lockfile
PATH="/tmp/vfm-pnpm-bin:$PATH" corepack pnpm exec turbo run test --filter='!@vfm/api'
PATH="/tmp/vfm-pnpm-bin:$PATH" corepack pnpm exec turbo run typecheck --filter='!@vfm/api'
PATH="/tmp/vfm-pnpm-bin:$PATH" corepack pnpm exec turbo run lint --filter='!@vfm/api'
PATH="/tmp/vfm-pnpm-bin:$PATH" corepack pnpm exec turbo run build --filter='@vfm/web'
corepack pnpm --dir apps/mobile typecheck
corepack pnpm --dir apps/api lint
```

Napomena: `/tmp/vfm-pnpm-bin/pnpm` je sandbox-local workaround; korisnik ga ne treba koristiti na svom uređaju. Za API pune testove potrebno je da Prisma generator preuzme/koristi engine u runneru koji ima podržan pristup i da se client generiše iz `apps/api/prisma/schema.prisma` prema postojećoj npm skripti. Nikad ne commitati generated client samo da bi ovaj sandbox prošao.

## Raniji rezultat i razlika baseline-a

U prethodnom radnom stanju iz ranije sesije zabilježeno je da je API suite prošao sa 907 testova, ali nakon čistog install-a i ažuriranja local HEAD na `44ecf00`, puni API suite nije se mogao ponoviti zbog nedostupnog Prisma engine hosta. Zbog auditabilnosti, ovaj dokument koristi **trenutni reproducibilni rezultat** iz gornje tabele; historijski pass ne zamjenjuje novi full run/CI artifact.

## Otvorene verifikacije

1. Pokrenuti Prisma generate + API lint/typecheck/unit u supported CI runneru i sačuvati log/artifact.
2. Uvesti i pokrenuti DB/Redis integration suite; trenutno CI preskače.
3. Dodati web E2E i native mobile smoke; u ovom paketu je scenarij plan, nije implementiran runner.
4. Ponoviti browser build/runtime, provjeriti crypto putanju, route navigation, bundle transfer/gzip i console.
5. Pokrenuti EAS build i Android UAT tek nakon odvojene odluke o lokalnim EAS config izmjenama.
