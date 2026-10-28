# 08 — Status nalaza i odluka

Ovaj registar dopunjava tehnički audit. Statusi se ažuriraju uz test ili referencu na promjenu.

| ID | Stavka | Status na 28.10.2026 | Dokaz / sljedeći korak |
|---|---|---|---|
| A-01 | E2E infrastruktura ne postoji | PARTIAL / IN PROGRESS | Mobile Maestro black-box CI runner i P4 acceptance prolaze u izolovanom runu **40712125218**; web browser E2E i device UAT ostaju otvoreni |
| A-02 | Prisma native engine download ograničen u sandboxu | CI VERIFIED / LOCAL ENV LIMIT | Sandbox workaround nije dokaz native download; CI generiše Prisma client i primjenjuje migracije u izolovanoj disposable PostgreSQL bazi (run **40712125166**) |
| A-03 | Web bundle 901 kB + Node crypto warning | PARTIAL / BUILD VERIFIED | Runtime imports prebačeni na `@vfm/form-engine/definition`; lazy route chunks uklonili `node:crypto` warning i 500 kB warning (glavni entry 28.18 kB; najveći odvojeni `zod` chunk 486.49 kB). Web build/lint i 182 testa prolaze; browser-console i real-navigation smoke ostaju otvoreni |
| A-04 | ZIP demo je samo vizuelna referenca | CLOSED (scope decision) | Prenijeti samo design cues; zadržati postojeći backend/auth |
| A-05 | Web/mobile tema nisu usklađene | PARTIAL / TOKENS ALIGNED | Korisnik je izabrao grafitno-lime; web dark-default i native koriste iste vrijednosti, parity + WCAG AA kontrast test dodat. Browser/device vizuelni smoke ostaje otvoren |
| A-06 | Pet lokalnih mobile EAS diffs | PROTECTED / not staged | Sačuvani/netaknuti; ne uključivati slučajno u Faza 1 patch |
| A-07 | API integration suite nedostaje | CI VERIFIED / LOCAL DB NOT RUN | API integration/stress i P15 persistence smoke prolaze nad izolovanim CI PostgreSQL/Redis servisima (run **40712125166**); lokalno/prod DB nije ciljana |
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
