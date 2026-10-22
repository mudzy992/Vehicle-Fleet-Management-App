# 08 — Status nalaza i odluka

Ovaj registar dopunjava tehnički audit. Statusi se ažuriraju tek uz test ili referencu na promjenu.

| ID   | Stavka                                                 | Status na 22.10.2026            | Dokaz / sljedeći korak                                             |
| ---- | ------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------ |
| A-01 | E2E infrastruktura ne postoji                          | OPEN                            | Kreirati web/API/mobile harness; `03-plan-E2E.md`                  |
| A-02 | Prisma generation blokira API full baseline u sandboxu | BLOCKED (environment)           | Ponoviti u supported CI; ne commitati generated client             |
| A-03 | Web bundle 901 kB + Node crypto warning                | OPEN / verify runtime           | Bundle analysis + browser console/runtime test                     |
| A-04 | ZIP demo je samo vizuelna referenca                    | CLOSED (scope decision)         | Prenijeti samo design cues; zadržati postojeći backend/auth        |
| A-05 | Web/mobile tema nisu usklađene                         | OPEN                            | Design tokens + design system foundation                           |
| A-06 | Pet lokalnih mobile EAS diffs                          | PROTECTED / not staged          | Sačuvati; zasebno odobrenje prije izmjene ili commita              |
| A-07 | API integration suite nedostaje                        | OPEN                            | PostgreSQL/Redis integration + concurrency test                    |
| A-08 | Scope/permission audit po svim modulima                | IN PROGRESS / not line-reviewed | Održati `vehicle:view:ALL`; pregledati ostale grantove iz policy-a |
| A-09 | GPS task-scoped privacy gates                          | DESIGN REQUIRED                 | `07-gps-privatnost.md`; ne implementirati prije privacy review     |
| A-10 | FCM/push nije aktivan                                  | CLOSED (scope fact)             | `FIREBASE_ENABLED=false`; ne predstavljati kao aktivno             |

## Definition of Done za svaki novi nalaz

- Precizan path + linija/route/query/test ID.
- Reprodukcija ili jasna logika uticaja.
- Severity i korisnički/data/security impact.
- Fix commit/PR ili dokumentovana odluka da se ne mijenja.
- Test prije i poslije; dokaz da se ponašanje promijenilo bez regresije.
- Ažuriran status ovdje; audit finding se ne briše samo zato što je promjena napravljena.
