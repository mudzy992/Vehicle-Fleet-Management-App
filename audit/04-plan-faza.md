# 04 — Fazni plan realizacije

Vremenske procjene su okvirne radne procjene, ne rokovi. Svaka faza završava dokazom (test/report/snimak) i go/no-go odlukom. Ne preskakati faze zbog vizuelnog napretka.

## Faza 0 — Baseline i scope zaštita (sada; 1–2 dana)

**Cilj:** stabilna početna tačka i bez gubitka korisničkih promjena.

- Zabilježiti branch/commit, test baseline, CI status i runtime dependency blockers.
- Sačuvati pet lokalnih izmjena u `apps/mobile/`; odvojeno odlučiti šta pripada EAS konfiguraciji.
- Dogovoriti actors/permission matrix i trenutno podržane status transitions.
- Audit ZIP-a samo kao vizuelne referencije; potvrditi šta je demo, šta je realno.

**Exit:** dokumentovani baseline; scope/owner za EAS diff; `audit/` sačuvan; nema secrets u promjenama.

## Faza 1 — Stabilizacija i audit modula (3–7 dana)

**Cilj:** potvrditi core API/domain ugovore prije redesign-a.

- Omogućiti API Prisma client generisanje u podržanom CI/dev okruženju; bez commitovanja generated clienta.
- Auditirati u serijama: auth/session/RBAC; vehicles/records; tasks/attachments; forms; drivers/services/tires; reminders/audit/notifications.
- Svaki nalaz dobije ID, ozbiljnost, dokaz (path/line/test), reprodukciju, vlasnika, fix i closure test.
- Popraviti potvrđene P0/P1 runtime/security/data integrity nalaze prije UX refactor-a.
- Potvrditi permission `vehicle:view:ALL` kao validan grant; dodatne scope kombinacije dokumentovati iz pravila, ne pretpostavki.

**Exit:** API lint/typecheck/unit suite prolazi nakon Prisma generation; nema otvorenih P0/P1 bez odobrenog workaround-a; migracije su reverzibilne/backup planiran.

## Faza 2 — E2E infrastruktura i kritični regression flows (4–7 dana)

**Cilj:** automatski testirati login → task → assignment → completion → audit.

- CI test services: PostgreSQL + Redis, deterministički migration/seed/reset.
- Web Playwright smoke i API integration suite; paralelno/serialno gdje je deterministički.
- Start sa E2E-01 do E2E-05; zatim permission negative, attachments, retry.
- Test report, failure artifacts, stable selectors, test data isolation, no production credentials.
- Mobile Maestro/Expo runner proof-of-concept; API base URL environment variable mora biti javni URL, ne `localhost` na Android uređaju.

**Exit:** P0 smoke suite stabilna tokom više ponavljanja; API concurrency test dokazuje jedan task claim winner; CI ne preskače testove.

## Faza 3 — Design system foundation (3–5 dana)

**Cilj:** jedna vizuelna osnova za web i native mobile bez kopiranja demo koda.

- Design tokens: dark graphite/lime direction, status colors, contrast, typography, spacing, radii, focus, motion.
- Mapirati postojeće web UI komponente na tokene; native theme i platform chrome zasebno.
- Napraviti component gallery/design-system page: form fields, buttons, cards, table/list, task status, empty/error/offline, sheet/modal.
- Visual regression baseline na ključnim viewportima i Android emulatoru.

**Exit:** tokens dokumentovani; kritične komponente konzistentne; WCAG AA provjera za tekst/controls; dark/light ponašanje odlučeno.

## Faza 4 — Web UX/UI polish (5–8 dana)

**Cilj:** operativni web za admin/dispatcher bez promjene poslovnih pravila mimo audita.

- Shell/nav, dashboard hierarchy, tables/cards, search/filter, responsive states.
- Task lifecycle screens, validation, permission-aware actions, confirmation/error recovery.
- Bundle split budget; potvrditi Node crypto/browser separation.
- Add templates/task board/matrices only after API contracts are accepted.

**Exit:** Web E2E-01/03/04/05/08/09/11 pass za isporučene funkcije; Lighthouse/core web vitals target dogovoren; nema horizontal overflow.

## Faza 5 — Native mobile UX/UI polish (5–8 dana)

**Cilj:** mobile-first vozački tok uz postojeću auth/offline/error infrastrukturu.

- Login/session/forced password, task list/detail/start/complete.
- Native token/theme, safe areas, error/retry, focus/large text, camera/attachment permission.
- QR scanner sa ručnim fallbackom; Android API URL mora biti environment-driven public endpoint, nikad `localhost`.
- EAS project config odluku uskladiti s korisnikom prije bilo kakvog builda; `.gitignore` i native setup ne mijenjati usput.

**Exit:** Android emulator E2E + device UAT; nema hardcoded localhost; session/logout/error tests pass; APK/AAB build je dokazano reproducibilan.

## Faza 6 — Odobrene operativne funkcionalnosti (8–15 dana; po prioritetu)

Redoslijed: (1) brzi task templates; (2) admin task board; (3) checklist/photo evidence; (4) QR; (5) vehicle/task/status/driver matrix i driver workload; (6) deadlines/waiting/report exports. Prije svakog feature-a zaključati API contract, RBAC, DB migration, audit event, UX state i acceptance tests.

- Template: versioning/snapshotting, required field validation, permission scope.
- Board: server pagination/filtering, status transition constraints, concurrency handling.
- Checklist/photo: optional vs required policy; file size/MIME/access/retention.
- QR: identifier only, permission re-check; no secret payload.
- Matrix/report: stable timezone, aggregation definitions, scopes, export audit and limits.

**Exit:** E2E coverage corresponding to each story; correct totals vs DB fixtures; migration + rollback/backup plan.

## Faza 7 — Task-scoped GPS (zaseban privacy-gated 5–8 dana + pravna/privacy odluka)

Ne počinjati prije odobrenja retention, notice, visibility, device permission i OS behavior. Implementacija je lokacija vozačevog uređaja **samo nakon assignmenta i eksplicitnog Start**, ne praćenje vozila.

- Task-scoped API/model i minimalna frekvencija potrebna za konkretan zadatak.
- Jasna trajna foreground indikacija dok sharing radi; stop na complete/cancel/release/explicit stop.
- Permission denied/approximate/background denied bez prisile i bez tihog praćenja.
- Server permission check, audit access, visibility allowlist, deletion/retention job i monitoring.
- E2E-10, privacy review i device test baterije/network recovery.

**Exit:** nema emitovanja prije Start/nakon Stop; nema fleet-wide endpointa; retention purge dokazan; privacy owner odobrio.

## Faza 8 — Regresija, UAT i rollout (3–5 dana)

- Full lint/typecheck/test/API integration/web/mobile E2E; dependency/license/security scan.
- Manual acceptance sa administratorom, dispečerom i vozačem; testirati slab internet i fizički Android uređaj.
- UAT checklist, poznati limiti, rollback plan, migracija i support notes.
- Feature flag i post-release monitoring; FCM ostaje disabled dok nije zasebno implementiran/testiran.

**Exit:** nula otvorenih P0/P1; svi P1 E2E prolaze; UAT potpis; release artefact i rollback put potvrđeni.

## Zavisan redoslijed

`Baseline → stabilizacija + line audit → E2E infrastructure + P0/P1 fixes → design system → web polish → native mobile polish → odobrene features → privacy-gated GPS → regression/UAT`.
