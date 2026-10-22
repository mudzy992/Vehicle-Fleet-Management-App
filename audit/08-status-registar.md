# 08 — Status nalaza i odluka

Ovaj registar dopunjava tehnički audit. Statusi se ažuriraju uz test ili referencu na promjenu.

| ID | Stavka | Status na 22.10.2026 | Dokaz / sljedeći korak |
|---|---|---|---|
| A-01 | E2E infrastruktura ne postoji | OPEN | `03-plan-E2E.md` je specifikacija, ne runner; kreirati web/API/mobile harness i izvršiti P1/P2/P3/P14 |
| A-02 | Prisma native engine download ograničen u sandboxu | PARTIAL / ENVIRONMENT | Puna gate `25/25` uspješna; Prisma task iz keša/`PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` nije dokaz native engine download/migrate deploy; ponoviti u podržanom CI |
| A-03 | Web bundle 901 kB + Node crypto warning | OPEN / verify runtime | Bundle analysis + browser console/runtime test |
| A-04 | ZIP demo je samo vizuelna referenca | CLOSED (scope decision) | Prenijeti samo design cues; zadržati postojeći backend/auth |
| A-05 | Web/mobile tema nisu usklađene | OPEN | Design tokens + design system foundation |
| A-06 | Pet lokalnih mobile EAS diffs | PROTECTED / not staged | Sačuvani/netaknuti; ne uključivati slučajno u Faza 1 patch |
| A-07 | API integration suite nedostaje | OPEN | PostgreSQL/Redis integration + concurrency test; DB verifier sada pokriva migracije 3–4 i Super Admin race, ali nije pokrenut |
| A-08 | Scope/permission audit po svim modulima | PARTIAL / IN PROGRESS | Faza 1 user/role/permission/audit scope i User PII popravljeni; prije Faze 3 provjeriti `driver:view_pii` scope u `drivers.service.ts`; `vehicle:view:ALL` ostaje validan |
| A-09 | GPS task-scoped privacy gates | DESIGN REQUIRED | `07-gps-privatnost.md`; ne implementirati prije privacy review; task-scoped, nakon eksplicitnog starta, samo dodijeljenom vozaču |
| A-10 | FCM/push nije aktivan | CLOSED (scope fact) | `FIREBASE_ENABLED=false`; ne predstavljati kao aktivno |
| A-11 | Last-Super-Admin DB race | CODED / LIVE DB UNVERIFIED | Migracija `4_super_admin_guard_lock` advisory transaction lock; `behavior_tests.py` concurrency case; verifier mora proći PostgreSQL-om prije deploya |
| A-12 | Refresh/reset concurrency | UNIT VERIFIED / LIVE DB UNVERIFIED | CAS + transaction tests; PostgreSQL integration proof ostaje otvoren |
| A-13 | Web logout trenutne sesije nakon server revoke | UNIT VERIFIED / E2E OPEN | API vraća `currentSessionRevoked` i briše cookie; UI lokalno čisti sesiju; browser E2E još nije pokrenut |
| A-14 | Lockout counter, rate-limit TTL failure, nested audit redaction, global permission version | UNIT VERIFIED | API regresije; full API suite 916/916 |
| A-15 | Faza 1 puna lokalna kvalitet-kapija | CLOSED (local gate only) | `turbo run lint typecheck test build`: 25/25; API 916/916. Ne zamjenjuje live DB/Redis/E2E. |

## Definition of Done za svaki novi nalaz

- Precizan path + route/query/test ID.
- Reprodukcija ili jasna logika uticaja.
- Severity i korisnički/data/security impact.
- Fix i referenca na kod/test; odluka da se ne mijenja ako je odgođeno.
- Test prije i poslije; jasno označiti unit, integration i live dokaz.
- Status se ne zatvara samo zato što je patch napisan: live-infrastructure nalazi ostaju otvoreni do izvršene provjere.
