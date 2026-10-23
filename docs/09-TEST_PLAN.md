# 09 — Plan testiranja i kriteriji prihvatanja

**Verzija:** 1.0.0 · **Alati:** Jest 30 + Supertest, Testcontainers (PostgreSQL 17 + Redis 7.4),
Playwright (web E2E), Maestro (mobilni E2E), k6 (load/stress), gitleaks + `pnpm audit` + Trivy (sigurnost)

---

## 1. Strategija

```
                 ┌───────────────┐  E2E (Playwright web · Maestro mobilna)  ~10 %
               ┌─┴───────────────┴─┐  Integration (pravi DB + Redis u Testcontainers)  ~30 %
             ┌─┴───────────────────┴─┐  Unit (servisi, form-engine, guards, utils)  ~60 %
             └───────────────────────┘
```

| Nivo | Šta se testira | DB/Redis | Brzina |
|---|---|---|---|
| Unit | `form-engine` (validacija, AST evaluator), `permissions` evaluator, novac/datumi, servisi s mock repo-om | bez | ms |
| Integration | API endpointi (auth, RBAC, CRUD, claim, outbox), Prisma upiti, transakcije, Redis keš/lock | **pravi** (Testcontainers) | s |
| E2E web | Kritični tokovi kroz browser (login → zadatak → forma → izvještaj) | pravi (staging DB) | min |
| E2E mobilna | Maestro: login → lista → claim → complete s kamerom | pravi (staging) | min |
| Stress/Load | Paralelni claim, 50 korisnika, 200 zadataka/min | pravi | min |
| Sigurnosni | OWASP ASVS L2 checklist, dependency/secret/image scan | — | CI |

**Pravila**
- Nijedan test ne smije zavisiti od vremena („danas") bez eksplicitnog fake clock-a.
- Nijedan test ne smije dijeliti stanje s drugim (svaki dobija čistu bazu/šemu kroz migracije).
- Testovi za konkurenciju se pokreću u CI-u na svakom PR-u (nisu „flaky opcija").
- Sve vrijednosti su izmišljene (bez stvarnih ličnih podataka, bez fiksnih lozinki).

---

## 2. Mapiranje obaveznih kriterija (§16 zadatka) na testove

| ID | Kriterij | Faza | Tip | Fajl | Ključni koraci i tvrdnje |
|---|---|---|---|---|---|
| **P1** | Super Admin: web OK, mobilno NE | 1, 6 | unit ✅ + integration + e2e | ✅ `apps/api/test/unit/auth-service.spec.ts`, `auth-controller.spec.ts`, `auth-guards.spec.ts`; ⏳ `apps/api/test/e2e/auth-superadmin-mobile-blocked.spec.ts` | 1) login `clientType=WEB` → 200; 2) login `MOBILE_ANDROID` → 403 `MOBILE_ACCESS_FORBIDDEN`; 3) web token poslan s `X-Client-Type: MOBILE_ANDROID` na `/tasks` → 403 `MOBILE_SCOPE_NOT_ALLOWED`; 4) audit `SECURITY` zapis postoji; 5) Maestro: mobilni login Super Admina prikazuje poruku |
| **P2** | Kreiranje rola i izmjena prava | 1 | unit ✅ + integration | ✅ `roles-service.spec.ts`, `roles-controller.spec.ts`; ⏳ `roles-matrix.integration.spec.ts` | `POST /roles` → 201; `PUT /roles/matrix` (dodaj `vehicle:create` za `OBICNI_KORISNIK`) → 200; `GET /roles/matrix` odražava promjenu; audit diff sadrži 3 izmjene |
| **P3** | Oduzeto pravo odmah blokira API | 1 | unit ✅ + integration | ✅ `permissions-service.spec.ts`, `auth-guards.spec.ts`, `auth-service.spec.ts` (`me` nakon revokacije); ⏳ `rbac-revocation-latency.integration.spec.ts` | korisnik s `vehicle:create` → `POST /vehicles` 201; oduzeti pravo → isti **access token** (bez re-logina) → `POST /vehicles` 403 u ≤ 5 s; mjeri se `Date.now()` delta i tvrdi `< 5000` |
| **P4** | Admin kreira zadatak na mobilu | 5, 6 | e2e | Maestro `mobile-task-create.yaml` | login administratora → FAB → wizard → vozilo/tip → potvrdi → zadatak vidljiv u listi i na webu; bez `task:create` → FAB ne postoji **i** `POST /tasks` → 403 |
| **P5** | Oba korisnika vide/dobiju slobodan zadatak | 5, 6 | integration | `task-open-visibility.integration.spec.ts` | zadatak `OPEN_CLAIM` s 2 pozvana → `GET /tasks/available` vraća zadatak za oba; `Notification` postoji za oba (unique `notificationKey`); outbox `PROCESSED`; nakon claim-a drugi korisnik vidi `assigneeName` |
| **P6** | Paralelno preuzimanje → tačno 1 izvršilac | 5, 6 | **stress** | `task-claim-concurrency.stress.spec.ts` | `Promise.all` od **200** `POST /tasks/:id/claim` (različiti korisnici + isti korisnik 2×) → tačno **jedan** 200, ostali 409; `Task.status='IN_PROGRESS'`; `TaskAssignment` ima **1** red s `role='ASSIGNEE'`; `TaskEvent` ima **1** `CLAIMED`; ponovljeni poziv s istim `Idempotency-Key` vraća isti odgovor bez novog reda |
| **P7** | Samo izvršilac/ovlaštena osoba završava | 5 | integration | `task-complete-authorization.integration.spec.ts` | korisnik B (nije izvršilac, nema override) → 403 `NOT_ASSIGNEE`; izvršilac → 200; korisnik C s `task:complete_override` → 200 + `TaskEvent(OVERRIDE_COMPLETED)` + AuditLog `COMPLETE` s `override=true` + `completedById=C` |
| **P8** | Push greška ne briše zadatak; retry bez duplikata | 5 | integration | `outbox-fcm-failure.integration.spec.ts` | FCM mock vraća 500/timeout; zadatak ostaje `IN_PROGRESS`; `OutboxEvent` prelazi `PENDING→PROCESSING→FAILED→…`; `Notification` **jedan** red (unique key); nakon oporavka `Delivery=SENT`; `NotificationDelivery.attempts>1`; nijedan `Task` red nije obrisan/promijenjen |
| **P9** | Forma: kreirati, validirati, preview, objaviti | 2 | e2e + unit | `form-publish-workflow.e2e.spec.ts`, `form-engine.unit.spec.ts` | draft → validate (10 provjera) → preview (web + mobilni fixture snapshot) → publish bez `changeNote` → 422 → publish s bilješkom → 200, verzija +1, prethodna `RETIRED`; pokuša li se `PUT` nad objavljenom → 422/DB trigger exception |
| **P10** | Stari zapisi vezani za originalnu verziju | 2, 3 | integration | `form-version-binding.integration.spec.ts` | zapis kreiran s v2; nakon objave v3 → `GET /tasks/:id` vraća `formSchemaVersion=2` i renderuje v2 polja (uklj. polje koje u v3 ne postoji); novi zapis → v3 |
| **P11** | Backend odbija vrijednosti van sheme | 2 | unit + integration | `form-validation-rejection.spec.ts` | nepoznat ključ → `UNKNOWN_FIELD`; obavezno prazno → `REQUIRED`; pogrešan tip → `TYPE_ERROR`; iznos > max → `MAX`; skriveno polje poslano → `FIELD_NOT_VISIBLE`; rezervisani ključ (`status`) → `RESERVED_FIELD_KEY`; **niti jedan slučaj ne prolazi tiho** |
| **P12** | Migracija historijskog zapisa eksplicitna i auditovana | 2 | integration | `form-migration-job.integration.spec.ts` | `POST /form-migrations` → preview (before/after, summary) → apply → `formSchemaVersionId` promijenjen, `FormMigrationItem.before` sačuvan, audit `FORM_MIGRATE` → rollback → vraćeno originalno stanje; zapisi koji ne prolaze = `skipped`, nisu izgubljeni |
| **P13** | Registracije/servisi/gume: historija + podsjetnici | 3, 4 | integration | `reminders-idempotency.integration.spec.ts`, `vehicle-history.integration.spec.ts` | skener pokrenut **2×** isti dan → `ScheduledReminder` redova se ne povećava (unique `dedupeKey`); pragovi 14/7/3/1 daju 4 različita reda; preklapajući period registracije → 409 `PERIOD_OVERLAP`; `kmDriven`/`daysInUse` tačni; historija vozila kompletna |
| **P14** | Bez prava nema pristupa endpointima/dokumentima | 1, 3 | unit ✅ (rute) + e2e (sweep) | ✅ `roles-controller.spec.ts`, `users-controller.spec.ts` (permisija po ruti), `p14-route-authorization-coverage.spec.ts` (zaštita i kataloške deklaracije svih ruta); `p14-http-permission-guard.spec.ts` (HTTP guard matrica); `p14-attachments-http-guard.spec.ts` (attachment controller uz fake servis); `p14-drivers-pii-http.spec.ts` (driver controller + servis, PII i DRIVER_IDS scope); `p14-vehicles-scope-http.spec.ts` (vehicle controller + servis, ALL i VEHICLE_IDS); `p14-users-pii-http.spec.ts` (user controller + servis, PII OWN scope); `p14-registrations-scope-http.spec.ts` (registration controller + servis, VEHICLE_IDS filtriranje); `p14-insurances-scope-http.spec.ts` (insurance controller + servis, VEHICLE_IDS filtriranje); `tasks.spec.ts` (task controller + servis kroz HTTP, povezani naspram nepovezanih korisnika); ⏳ `authorization-sweep.e2e.spec.ts` (preostali kontroleri/servisi i scope) | **automatski prolazak kroz sve rute iz OpenAPI-ja**: za svaku (rola × endpoint) kombinaciju bez permisije očekuje se 401/403, nikad 200/404-s-podacima; uključuje `/attachments/:id/content` i potpisane URL-ove (bez permisije → 403 iako je URL validan) |
| **P15** | Compose čuva podatke nakon restarta | 0, 8 | ops | `persistence-restart.ops.sh` | upisati vozilo + prilog → `docker compose down` → `up -d` → podaci i fajl prisutni; isto nakon Coolify redeploya; provjera `pg_isready` i checksum fajla |
| **P16** | Backup se uspješno vraća | 8 | ops | `backup-restore.ops.sh` | `backup-db.sh` → restore u čistu bazu → `prisma migrate status` OK → `/health/ready` OK → broj zapisa jednak; vrijeme restore-a zabilježeno |

---

### 2.1 Pokrivenost u Fazi 1 (unit, bez infrastrukture)

| Oblast | Spec | Testova | Coverage (stmts/branch) |
|---|---|---|---|
| Auth servis (login, rotacija, reuse detection, odjava, `me`, promjena lozinke, sesije, `PENDING_PASSWORD_CHANGE` tok) | `test/unit/auth-service.spec.ts` | 50 | `src/modules/auth` 96 % / 85 % |
| Auth kontroler (rute, cookie, metadata, dozvole) | `test/unit/auth-controller.spec.ts` | 17 | `auth.controller.ts` 100 % / 75 % |
| Guard-ovi (JWT, client type, permisije, rate limit, `PASSWORD_CHANGE_REQUIRED` gate) | `test/unit/auth-guards.spec.ts` | 44 | `src/common/guards` 97 % / 89 % |
| RBAC servis (opsezi, keš, verzije, revokacija) | `test/unit/permissions-service.spec.ts` | 32 | `auth/permissions` 90 % / 79 % |
| Tokeni/lozinke | `token-service.spec.ts`, `password-service.spec.ts` | 29 + 25 | `auth/services` 96 % / 88 % |
| Audit persistencija (`AuditLog` + SECURITY događaji) | `prisma-audit-sink.spec.ts`, `audit.spec.ts` | 10 | `common/audit` 93 % / 77 % |
| Idempotency-Key replay (Redis rezervacija/vlasništvo, isti i različiti otisak, `in-progress`, opseg korisnika, status/tijelo, sigurnosna izuzeća i 503 mapiranje) | `test/unit/idempotency.spec.ts` | 19 | `src/infra/redis`, `src/common/interceptors` |
| Validacija ulaza (Zod) + čitanje cookie-ja | `zod-validation-pipe.spec.ts`, `http-cookies.spec.ts` | 31 | `common/pipes` 100 %, `common/http` 100 % |
| Role i matrica prava (P2: grantovi u transakciji, bump verzije + Redis invalidacija, opsezi, zaštite Super Admina i arhiviranja) | `test/unit/roles-service.spec.ts` | 23 | `src/modules/roles` 97 % / 75 % |
| Role/Permisije kontroler (permisije po ruti, audit metadata, `AuditContext` diff, redoslijed ruta `matrix` prije `:id`, DI modula) | `test/unit/roles-controller.spec.ts` | 22 | `roles.controller.ts` 100 % / 50 % — tanki passthrough (neskrivene grane su `user?.id` i `?? null`) |
| Korisnici (P14: PII redakcija, paginacija, kreiranje s generisanom lozinkom, zaštita zadnjeg Super Admina, revokacija, anonimizacija, reset token 30 min) | `test/unit/users-service.spec.ts` | 19 | `src/modules/users` 94 % / 69 % |
| Korisnici kontroler (permisije po ruti, audit `DELETE`=CRITICAL / reset=SECURITY, `AuditContext` bez tajni) | `test/unit/users-controller.spec.ts` | 20 | `users.controller.ts` 89 % / 67 % |
| Reset lozinke tokenom (`/auth/reset-password`: hash, istek, jednokratnost, politika, revokacija) | `test/unit/auth-service.spec.ts` (describe „reset lozinke tokenom") | 5 | `auth.service.ts` 95 % / 86 % |
| Konverzija datuma (`toDatabaseDate`: date-only → UTC ponoć, `Date` prolazi, `null`, odbijanje neispravnog i `2026-02-30`) | `test/unit/dates.spec.ts` | 5 | `src/common/dates.ts` |
| Servisi — pregled: filteri/paginacija, soft-delete, datumi, novac, sortiranje, validacija i permisije kontrolera | `test/unit/services-service.spec.ts` | 7 | `src/modules/services` |
| Servisi — potpuna izmjena: zaključavanje vozila, datum/km/rokovi, novo SERVICE očitanje, regresija, ponovni obračun rokova i CAS | `test/unit/services-full-update.spec.ts` | 10 | `src/modules/services` |
| Servisi — web model izmjene: početne vrijednosti, diff payload, `null` brisanje i lokalna validacija datuma/km/rokova | `apps/web/src/features/services/service-edit-model.test.ts` | 6 | `apps/web/src/features/services` |
| Servisi — brisanje: soft-delete, zaključano vozilo, ponovni obračun rokova, CAS, 404/409 i kritični audit uz `204` | `test/unit/services-delete.spec.ts` | 9 | `src/modules/services` |
| Servisi — web model brisanja: tekst potvrde/uspjeha i strana nakon brisanja jedinog reda | `apps/web/src/features/services/service-delete-model.test.ts` | 4 | `apps/web/src/features/services` |
| Prisma `select` polja prema šemi (svaki `*_SELECT` koristi samo polja svog modela, registar pokriva sve select konstante, inline select polja postoje, regresija `Driver.archivedAt` → `GET /drivers` 500) | `test/unit/prisma-select-fields.spec.ts` | 5 | `src/modules/**` vs `prisma/schema.prisma` |
| DI wiring (Nest bootuje servise/kontrolere Faze 3 i 4 te globalni `IdempotencyInterceptor`; regresija za pad `AttachmentsService (PrismaService, ?)` — interfejs u konstruktoru bez `@Inject` tokena) | `test/unit/di-wiring.spec.ts` | 22 | `src/modules/**`, `src/common/interceptors` |
| Prilozi — bajtovi (magic bytes, SHA-256, `storageKey`, zaštita putanje, uklanjanje EXIF-a iz JPEG/PNG) | `test/unit/attachment-files.spec.ts` | 12 | `src/modules/attachments` |
| Prilozi — servis (413/415, idempotentnost po `sha256`, `complete` + opseg, potpisani URL, `replace`, soft-delete) | `test/unit/attachments-service.spec.ts` | 16 | `src/modules/attachments` |
| Forme — dinamička polja (vidljivost sekcija, `hiddenKeys` protiv duplih kontrola, serverska greška uz polje, konverzija unosa po `fieldKey`, `INTEGER` filter, `aria-invalid`) | `apps/web/src/features/forms/form-fields.test.tsx` | 8 | `apps/web/src/features/forms` |
| Vozila — web logika (pragovi rokova 30/7/0, `deadlineLabel`, „rokovi" widget sortiran po hitnosti uz preskakanje arhiviranih, query string bez praznih filtera, razlika „prazan registar" vs „prazan filter") | `apps/web/src/features/vehicles/vehicles-model.test.ts` | 14 | `apps/web/src/features/vehicles` |
| Registracije/osiguranje — web logika (KM → feninge s decimalnim zarezom i zaokruživanjem, prazno/negativno → `null`, podrazumijevani period godinu dana uključivo oba dana, 29.02. → 28.02., `PERIOD_OVERLAP` prepoznat; payload izmjene: `version`, prazno opciono → `null`, obavezno prazno se ne šalje, `status` samo kad je promijenjen; red → vrijednosti kontrola; query liste bez praznih filtera; normalizacija registracije/osiguranja u isti red tabele) | `apps/web/src/features/vehicles/records-model.test.ts` | 16 | `apps/web/src/features/vehicles` |
| Vozači — web logika (pragovi rokova dijeljeni s vozilima, „dozvole ističu" widget računa dane iz `licenseExpiresAt` uz preskakanje arhiviranih, query bez praznih filtera i s normalizovanom kategorijom, razlika „prazan registar" vs „prazan filter") | `apps/web/src/features/drivers/drivers-model.test.ts` | 8 | `apps/web/src/features/drivers` |
| Seed + bootstrap Super Admina (idempotentnost, demo podaci samo van produkcije, generisane lozinke, zaštita od drugog Super Admina; 10 vozila, 5 vozača s kategorijama, 2 demo registracije — jedna istekla, jedna +3 dana — i 8 politika podsjetnika) | `test/unit/seed.spec.ts` | 13 | `src/tools` je izuzet iz coverage izvještaja (CLI alati; `migrate.ts` spawnuje `prisma` i nema šta mjeriti) — logika seeda je pokrivena testovima direktno |
| Audit log API (P14: SECURITY redovi samo uz `audit:view_security`, filteri/paginacija u bazi, BIGINT → string) | `test/unit/audit-log-service.spec.ts` | 10 | `src/modules/audit-logs` 78 % / 88 % |
| Vozila (P10/P11: `formData` prema tačnoj verziji, normalizovane kolone iz whitelist-a, `DUPLICATE_ENTRY`, `VERSION_CONFLICT`, status mašina, meka arhiva/brisanje) | `test/unit/vehicles-service.spec.ts` | 19 | `src/modules/vehicles` |
| Kilometraža (`ODOMETER_REGRESSION`, ispravka s razlogom, denormalizovani `odometerKm` u istoj transakciji, buduće očitanje, paginacija) | `test/unit/odometer-service.spec.ts` | 11 | `src/modules/vehicles` |
| Vozači (P11 forma `DRIVER`, PII redakcija bez `driver:view_pii`, `VERSION_CONFLICT`, status mašina, meka arhiva, kategorije dozvole s `DUPLICATE_ENTRY`, filteri `q`/`licenseCategory`/`expiringInDays` — granica dana za `@db.Date`) | `test/unit/drivers-service.spec.ts` | 31 | `src/modules/drivers` |
| Registracije (P11 forma `REGISTRATION`, `409 PERIOD_OVERLAP` s `conflictingId`, zatvoren interval, denormalizovani `registrationExpiresAt`, `VERSION_CONFLICT`, soft-delete oslobađa period, `expiringInDays`, granica lokalnog dana) | `test/unit/registrations-service.spec.ts` | 19 | `src/modules/registrations` |
| Osiguranje (isti period ugovor nad `InsuranceRecord`, `insuranceExpiresAt`, `type`/franšiza, novac u feningama, filteri) | `test/unit/insurances-service.spec.ts` | 9 | `src/modules/insurances` |
| Podsjetnici (P-07: dupli sken → `created: 0`, `dedupeKey` po zapisu/vrsti/pragu, default 5 dana, `fireAt` 06:00 Europe/Sarajevo s CET/CEST, km pragovi, potvrda/odgađanje) | `test/unit/reminders-service.spec.ts` | 20 | `src/modules/reminders` |
| Raspored skenera (cron `0 6 * * *`, `tz` zona, stabilan `schedulerId`, upsert bez Redis-a) | `test/unit/reminder-scheduler.spec.ts` | 3 | `src/infra/queue` |

| Web — API klijent (single-flight refresh, retry na 401, istekla sesija, 204) | `apps/web/src/lib/api.test.ts` | 6 | — |
| Web — sesija (bootstrap anonymous/authenticated, `hasPermission`, R-07, istek sesije) | `apps/web/src/features/auth/session.test.tsx` | 4 | — |
| Web — matrica prava (diff payload: samo izmijenjene role, bez SUPER_ADMIN, opsezi) | `apps/web/src/features/roles/matrix.test.ts` | 6 | — |
| Web — Form Builder (dozvoljene akcije po statusu verzije i permisijama, predlog verzije, parse rezultat, diff linije, `bs-BA` prikaz datuma) | `apps/web/src/features/forms/forms-model.test.ts` | 14 | — |
| Web — pregled forme u Builder-u (MONEY → feninzi, prazno polje ≠ 0, višestruki izbor, `Europe/Sarajevo` datum) | `apps/web/src/features/forms/forms-preview-values.test.ts` | 8 | `forms-preview-values.ts` 100 % |

E2E/integration fajlovi iz tabele §2 (P1 koraci 3 i 5, P2 preko HTTP-a, P3 latency) ostaju planirani —
zahtijevaju živi PostgreSQL i Redis (`docker-compose.dev.yml`), što u sandboxu nije dostupno.

---

## 3. Detalj: stress test za P6 (atomski claim)

```ts
// apps/api/test/stress/task-claim-concurrency.stress.spec.ts
const USERS = await seedUsers(50);                 // 50 običnih korisnika s task:claim
const task  = await seedTask({ assignMode: 'OPEN_CLAIM', invited: USERS.map(u => u.id) });

const results = await Promise.allSettled(
  Array.from({ length: 200 }, (_, i) =>
    request(app.getHttpServer())
      .post(`/api/v1/tasks/${task.id}/claim`)
      .set('Authorization', `Bearer ${tokens[i % USERS.length]}`)
      .set('Idempotency-Key', i < 100 ? `fixed-${i % USERS.length}` : randomUUID()), // dio s istim ključem (retry)
  ),
);

const ok    = results.filter(r => r.status === 'fulfilled' && r.value.status === 200);
const conf  = results.filter(r => r.status === 'fulfilled' && r.value.status === 409);
expect(ok.length).toBe(1);                                   // tačno jedan izvršilac
expect(ok.length + conf.length).toBe(200);                   // nema 500
expect(await countAssignees(task.id)).toBe(1);               // unique partial index
expect(await countEvents(task.id, 'CLAIMED')).toBe(1);
expect((await getTask(task.id)).status).toBe('IN_PROGRESS');
```

Dodatno s **k6** (Faza 8): 50 VU, 200 claim-ova/min nad 20 zadataka → 0 grešaka 5xx, p95 < 400 ms,
i uvijek tačno jedan izvršilac po zadatku (provjera SQL-om nakon testa).

---

## 4. Testiranje forme (P9–P12) — fixture set

`packages/form-engine/src/__fixtures__/` sadrži 20+ definicija (validne i nevalidne) koje koriste
**i unit testovi i web/mobilni snapshot testovi** → garantuje paritet implementacija:

| Fixture | Očekivanje |
|---|---|
| `valid-all-field-types.json` | prolazi meta-shemu; renderer snapshot (web + RN) |
| `duplicate-field-key.json` | `SCHEMA_INVALID: DUPLICATE_KEY` |
| `reserved-key-status.json` | `RESERVED_FIELD_KEY` |
| `cyclic-visibility.json` | `SCHEMA_INVALID: CYCLE` |
| `expr-js-injection.json` (`"constructor.constructor('return process')()"`) | lexer odbija → `SCHEMA_INVALID: EXPRESSION_TOKEN` |
| `expr-div-by-zero.json` | static check: `EXPRESSION_UNSAFE` |
| `expr-unknown-field.json` | `EXPRESSION_UNKNOWN_FIELD` |
| `expr-too-deep.json` (dubina 12) | `EXPRESSION_TOO_DEEP` |
| `normalization-mismatch.json` (`MONEY` → `odometerKm`) | `NORMALIZATION_MISMATCH` |
| `mobile-unsupported-type.json` | `mobileCompatible=false` → objava blokirana bez `allowWebOnly` |
| `values-missing-required.json` | `FORM_VALIDATION_FAILED` s `fieldErrors` |
| `values-unknown-field.json` | `UNKNOWN_FIELD` |
| `values-hidden-field.json` | `FIELD_NOT_VISIBLE` |
| `values-money-string.json` | `TYPE_ERROR` |

**Sigurnosni testovi evaluatora:** fuzzing (1000 nasumičnih izraza iz gramatike + mutacije) → nikad
`eval`, nikad `undefined` ponašanje, uvijek ≤ 10 ms, uvijek deterministički rezultat.

**Implementirano (Faza 2, unit nivo — bez DB-a):**

| Fajl | Pokriva |
|---|---|
| `packages/form-engine/test/definition.schema.spec.ts` | meta-shema, limiti, zatvorena lista tipova |
| `packages/form-engine/test/expression-{parser,evaluator,static-check}.spec.ts` | gramatika, evaluacija, statička provjera (§6) |
| `packages/form-engine/test/conditions.spec.ts` | `visibleWhen` operatori i provjera pri objavi |
| `packages/form-engine/test/record-validation.spec.ts` | P11: nepoznato/skriveno/obavezno/tipovi/normalizacija |
| `packages/form-engine/test/publish-checks.spec.ts` | §8: svih 9 provjera pojedinačno + strukturni diff |
| `apps/api/test/unit/form-schemas-service.spec.ts` | P9: `DRAFT→PUBLISHED→RETIRED`, imutabilnost, `ETag` pomoćnik, `active` fallback |
| `apps/api/test/unit/form-migrations-service.spec.ts` | P12: preview/apply/rollback, `skipped` zapisi, batch 500, idempotentne stavke |
| `packages/form-renderer/test/render-model.spec.ts` | paritet web/mobilna: deterministički model, vidljivost, STATIC opcije, progres, `collectSubmitValues` |
| `apps/web/src/features/forms/forms-model.test.ts` | UI pravila: koje akcije nad kojim statusom, predlog verzije, diff u čitljive linije |

Integration/E2E varijante iz tabele iznad (P9–P12) traže PostgreSQL i dolaze uz prvi modul koji
stvarno piše zapise (Faza 3, zadaci).

---

## 5. Testiranje sigurnosti

| Test | Šta provjerava |
|---|---|
| `auth-bruteforce.spec.ts` | 5 neuspjelih → 423/429 lockout; audit `LOGIN_FAILED`; odgovor je generičan |
| `refresh-token-reuse.spec.ts` | reuse zamijenjenog tokena → sve sesije ukinute, `tokenVersion++`, audit `SECURITY` |
| `sql-injection.spec.ts` | payload u `filter[q]`, `sort`, `title` → parametrizirano, 400/200 bez greške baze |
| `mass-assignment.spec.ts` | `PUT /vehicles/:id` s `status`, `createdById`, `permissions` → `UNKNOWN_FIELD` |
| `upload-security.spec.ts` | `.php`/`.svg` s skriptom / polyglot → 415/422; magic bytes; EXIF uklonjen |
| `attachment-authorization.spec.ts` | validan signed URL + korisnik bez permisije → 403; istekao URL → 403 |
| `pii-redaction.spec.ts` | bez `driver:view_pii` → polja redigovana; s pravom → puna + audit `FILE_ACCESS`/PII |
| `cors.spec.ts` | origin van allowliste → bez CORS headera; `credentials` samo za dozvoljeni origin |
| `csrf-cookie.spec.ts` | mutacija s `Origin` van allowliste → 403 |
| `secrets-scan` (CI) | gitleaks: 0 nalaza; `pnpm audit --audit-level=high`: 0; Trivy: 0 critical |

---

## 6. Podaci i okruženja

| Okruženje | Baza | Podaci | Namjena |
|---|---|---|---|
| `local` | `docker-compose.dev.yml` (5433/6380) | seed demo (10 vozila) | razvoj |
| `test` | Testcontainers (ephemeral) | fixture + seed | unit/integration u CI |
| `staging` | Coolify (posebna DB/Redis) | anonimizirani produkcijski uzorak | UAT, load, security |
| `production` | Coolify | stvarni | go-live |

Seed: `docs/03-MODEL_PODATAKA.md` §7. Sve lozinke generisane, `mustChangePassword=true`.

---

## 7. CI pipeline (GitHub Actions)

```yaml
jobs:
  quality:   pnpm -w lint && pnpm -w typecheck
  unit:      pnpm -w test                          # pragovi: vidi apps/api/vitest.config.ts
                                                   # globalno 60/50 (infra bez integration testova),
                                                   # domenski glob-ovi 80 % lines / 70 % branches
  integration: docker (postgres:17, redis:7.4) → pnpm --filter @vfm/api test:integration
  stress:    pnpm --filter @vfm/api test:stress   # P6
  security:  gitleaks, pnpm audit, trivy image scan
  env-sync:  node scripts/env-sync-check.mjs      # compose ↔ .env.example ↔ REDIS_ACL.md
  build:     turbo build + docker build (api, web)
  e2e-web:   playwright (staging compose)
```

Pragovi (bez prolaska nema merge-a): lint 0 grešaka, typecheck 0, unit ≥ 80 % coverage,
integration 100 % prolaznost, **stress P6 100 % prolaznost**, security 0 high/critical,
`env-sync-check` exit 0.

> **Faza 1 — stanje pragova coverage-a.** Cilj od 80 % lines / 70 % branches važi za **domenske**
> module i postavljen je po glob-ovima u `apps/api/vitest.config.ts`
> (`src/modules/auth/**`, `src/common/guards/**`, `src/common/pipes/**`, `src/common/audit/**` —
> izmjereno 96–100 %). Globalni prag je privremeno 60/50 jer infrastrukturni kod
> (`infra/queue`, `infra/redis`, `config`, bootstrap `health`) nije smisleno testirati bez
> živog Redis-a/Postgresa; vraća se na 80/70 kad integracijski testovi (Faza 2+) pokriju te module.
> Generisani Prisma client (`src/generated/**`) je izuzet iz mjerenja.

---

## 8. E2E scenariji (Playwright, web)

| # | Scenarij | Koraci |
|---|---|---|
| E1 | Super Admin: korisnik + prava | login → Korisnici → novi → dodijeli rolu → matrica → oduzmi `vehicle:create` → provjera na drugom korisniku |
| E2 | Form Builder publish | Forme → nova verzija → dodaj polje → Provjeri shemu → Preview (web/mobilni) → Objavi (bilješka) → historija verzija |
| E3 | Vozilo + registracija + rok | Vozila → novo → forma → dodaj registraciju (prilog) → dashboard prikazuje rok → obnovi registraciju |
| E4 | Zadatak web → mobile | Novi zadatak (wizard) → pozovi 2 korisnika → (Maestro) korisnik preuzme → web prikazuje „U toku" + timeline |
| E5 | Izvještaj i izvoz | Izvještaji → po vozilu → filteri → Excel → Download centar → preuzmi → audit sadrži `EXPORT` |
| E6 | Migracija zapisa | Forme → migracija → preview → apply → provjera zapisa → rollback |
| E7 | Bez prava | login običnog korisnika → direktan URL `/korisnici` → „Nemate pristup" |

## 9. E2E scenariji (Maestro, mobilna)

| # | Scenarij |
|---|---|
| M-E1 | Login administratora → FAB → kreiraj zadatak → potvrda |
| M-E2 | Login korisnika → Slobodni → Preuzmi → „Tvoj zadatak" |
| M-E3 | Dva emulatora istovremeno Preuzmi → jedan 200, drugi dijalog s imenom |
| M-E4 | Završi zadatak → forma → kamera (mock) → upload → potvrda → push administratoru |
| M-E5 | Super Admin login → odbijen s porukom (P1) |
| M-E6 | Offline: avion režim → lista iz keša + banner → online → sinkronizacija |
| M-E7 | Logout → token deregistrovan → push ne dolazi |

---

## 10. Šablon izvještaja o testiranju po fazi

```
### Faza X — test izvještaj
Datum: …  Commit: …
| Nivo | Ukupno | Prošlo | Palo | Coverage |
|---|---|---|---|---|
| Unit |  |  |  |  |
| Integration |  |  |  |  |
| Stress (P6) |  |  |  | — |
| E2E |  |  |  | — |

Kriteriji prihvatanja: P… ✅ / P… ❌ (razlog)
Komande: pnpm -w lint · pnpm -w typecheck · pnpm -w test · pnpm --filter @vfm/api test:integration · node scripts/env-sync-check.mjs
Sigurnost: gitleaks ✅ · pnpm audit ✅ · trivy ✅
Nesavršenosti/tehnički dug: …
Blokira sljedeću fazu: DA/NE
```

### Unos servisa — Faza 4

`apps/api/test/unit/services-create.spec.ts` — 10 testova: redoslijed zaključavanja
prije provjere km/upisa, referenca očitanja i audit snapshot, bez km, regresija km,
arhiva/nepostojeće vozilo, povučena forma, budući datum, propagacija greške očitanja,
rok iz najnovijeg servisa i granice DTO-a. Testovi koriste lažni transakcijski
klijent; stvarni rollback i paralelni upisi na PostgreSQL-u nisu ovim dokazani.
Seed testovi očekuju 8 formi i provjeravaju idempotentnost drugog prolaza.

### Stavke servisa — Faza 4

`apps/api/test/unit/service-items.spec.ts` — 12 testova: zaokruživanje feninga,
prazan račun, granica integera, validacija količine/cijene/broja stavki, CAS,
zapisna RETIRED forma i usklađivanje `formData.totalCost`, konflikt prije
brisanja, 404, blokada neaktivne evidencije/arhive, greška upisa, pretvaranje
Decimal količine pri čitanju i permisije kontrolera. Nest DI test dopunjen
servisom/kontrolerom stavki (+2). Fake transakcija ne dokazuje stvarni DB rollback.

`apps/web/src/features/services/service-items-display.test.ts` — 3 testa
lokalizovanog prikaza novca i količina: feninzi → KM, decimalni zarez, dvije
decimale cijene, razdvajanje hiljada i izostavljanje suvišnih nula količine.
Vizuelna provjera na korisničkom deployu ostaje potrebna; testovi ne porede screenshotove.

`apps/api/test/unit/services-update.spec.ts` — 8 testova opisne izmjene:
CAS, zapisna RETIRED forma, audit snapshot, očuvanje km/datuma/rokova/troška
kad se mijenjaju samo opisna polja, zastarjela verzija prije upisa i
konkurentna promjena tokom validacije, 404, blokada neaktivnog
servisa/arhiviranog vozila, strict prošireni DTO i permisija.

`apps/api/test/unit/services-full-update.spec.ts` — 10 testova potpune
izmjene nad lažnom transakcijom: redoslijed zaključavanja vozila, Date
vrijednosti za `@db.Date`, sinhronizacija mapiranog datuma u `formData`,
novo SERVICE očitanje i podizanje km vozila, ponovni obračun rokova kad
servis prestane biti najnoviji, zaštita roka novijeg servisa, regresija ispod
zaključane trenutne km, spuštanje snapshota na već korigovanu trenutnu km,
brisanje km/rokova bez promjene trenutne km, efektivni rokovi i budući datum,
arhivirano vozilo, CAS konflikt bez očitanja/vozila te audit meta kontrolera.

`apps/web/src/features/services/service-edit-model.test.ts` — 6 testova:
početne vrijednosti i `null` kontrole, PATCH samo sa stvarnim izmjenama,
brisanje opcionalnih polja kroz `null`, bez izmjena nema payloada, odbijanje
neispravnog datuma/km te efektivni odnos servisa i sljedećeg roka.

`apps/api/test/unit/services-delete.spec.ts` — 9 testova nad lažnom
transakcijom: redoslijed zaključavanja vozila i soft-deletea uz rast verzije,
vraćanje roka prethodnog servisa, nepromijenjen rok pri brisanju starijeg
servisa, `null` rokovi nakon zadnjeg aktivnog servisa, brisanje neaktivnog
zapisa bez ponovnog obračuna, očuvanje stavki i očitanja u bazi, 404,
arhivirano vozilo, CAS konflikt/konkurentno brisanje te kontrolerova
permisija, kritični audit/meta i `204`.

`apps/web/src/features/services/service-delete-model.test.ts` — 4 testa:
potvrda objašnjava nestanak servisa/stavki iz aktivne evidencije, ponovni
obračun rokova i očuvanu historiju kilometraže; poruka uspjeha identifikuje
servis; brisanje jedinog reda vraća prethodnu stranu, a ostali slučajevi
zadržavaju trenutnu stranu.

Transakcijski/API fakeovi ne dokazuju stvarni PostgreSQL `FOR UPDATE`,
rollback ni konkurenciju; web testovi ne dokazuju vizuelni prikaz.

`apps/api/test/unit/tires-service.spec.ts` — 7 testova pregleda montaža:
filteri i paginacija, soft-delete, boolean true/false, validacija UUID/query,
whitelist sortiranja, null brojači i datumi, prazna lista i `tire:view`.
DI provjera dopunjena servisom i kontrolerom guma (+2 testa).
Testovi su s lažnim Prisma klijentom, ne dokazuju DB konkurenciju/montažu.

### Kompleti guma — Faza 4

`apps/api/test/unit/tire-sets.spec.ts` — 10 testova: serverski filteri
pretrage/sezone/statusa/dostupnosti, sort whitelist i paginacija, serijalizacija
datuma i vozila aktivne montaže, unos kroz objavljenu `TIRE_SET` formu uz
početni status `IN_STOCK`, duplikat aktivnog koda prije upisa i mapiranje
konkurentnog `P2002` na `409 DUPLICATE_ENTRY`, povučena forma, budući datum
nabavke, stvarna validacija dodatnih polja forme, granice strict DTO-a te
permisije/audit kontrolera. Statički registar Prisma selecta dopunjen je za
`TIRE_SET_SELECT`.

`apps/api/test/unit/tire-set-lifecycle.spec.ts` — 12 testova nad stateful
lažnim transakcijskim klijentom: detalj s `formData` i aktivnim vozilom,
soft-obrisan zapis kao 404, zaključavanje reda kompleta prije CAS upisa,
izmjena zapisnom `RETIRED` formom bez promjene verzije forme i sinhronizacija
statusa pojedinačnih guma. Negativni tokovi pokrivaju zastarjelu verziju,
duplikat koda, nabavku nakon prve montaže, ručnu promjenu statusa, premali
broj guma montiranog kompleta i deklarisani broj ispod već evidentiranih
pojedinačnih guma, terminalni `SCRAPPED`, legacy zapis bez forme
i konkurentno `P2002`. Brisanje je blokirano aktivnom montažom, a uspješno
soft-briše komplet i gume bez brisanja historije. Dodatno se provjeravaju
strict update DTO te odvojene `tire:view/update/delete` permisije i audit
težine. Fake ne dokazuje stvarni PostgreSQL `FOR UPDATE`, rollback ni HTTP.

`apps/api/test/unit/tires-individual.spec.ts` — 10 testova nad stateful
lažnim klijentom: lista isključuje obrisane i tuđe gume, sortira po kanonskoj
poziciji i decimalnu dubinu profila pretvara u desetinke milimetra; obrisan
komplet je 404 bez čitanja guma. Unos zaključava komplet, nasljeđuje status,
u aktivnoj montaži razlikuje montiranu poziciju od rezerve te ispravlja
nekonzistentan `MOUNTED` bez montaže. Pokriveni su deklarisani limit
kompleta, zauzeta pozicija i konkurentno `P2002` kao `DUPLICATE_ENTRY`,
budući datum nabavke, strict DTO bez ručnog statusa/`setId`/`formData` te
`tire:view/create` i audit. Statički registar Prisma selecta dopunjen je za
`TIRE_SELECT`. Fake ne dokazuje stvarni PostgreSQL lock, djelimično
jedinstveni indeks ni Decimal zapis.

`apps/api/test/unit/tire-set-usage.spec.ts` — 6 testova: agregati ukupnih,
završenih i aktivnih ciklusa, grupisanje i determinističko sortiranje po
vozilima, kanonske aktivne pozicije, ciklusi od najnovije montaže te prazan
pregled bez historije. Provjerava se da obrisani i tuđi ciklusi ne ulaze u
brojeve, da završen ciklus s `null` snapshot brojačima ne ruši zbir, da
aktivni km/dani ostaju `null` bez procjene, da obrisan komplet vraća 404 bez
čitanja ciklusa te da endpoint traži `tire:view` i nema audit. Odgovor se
parsira strict `tireSetUsageSchema`; registar Prisma selecta dopunjen je za
`TIRE_SET_USAGE_SELECT`. Fake ne dokazuje stvarni PostgreSQL join ni HTTP tok.

`apps/web/src/features/tires/tire-sets-model.test.ts` — 12 testova query
gradnje, izostavljanja praznih opcionalnih polja i pretvaranja nabavne cijene
iz KM u feninge te izmjene: početne vrijednosti detalja, dozvoljene statusne
opcije, PATCH samo sa stvarnim izmjenama, brisanje opcionalnih polja kroz
`null`, izostavljanje neizmijenjenog `formData`, montiran komplet,
nekonzistentan `MOUNTED`, terminalni `SCRAPPED` i legacy zapis bez forme.
Za pojedinačne gume pokriveni su kanonske slobodne pozicije, pretvaranje
dubine profila i cijene u cijele API jedinice, lokalizovan prikaz milimetara
te odbijanje praznog unosa, zauzete pozicije i vrijednosti izvan opsega.
Panel korištenja je tipski vezan za isti shared ugovor, a agregatna logika
ostaje serverska i pokrivena API testovima.
Seed-form provjere sada imaju i eksplicitni test da `komplet_guma` nosi samo
dobavljača, fakturu i napomenu bez normalizacije. Lažni Prisma klijent ne
dokazuje stvarni PostgreSQL upit, jedinstveni indeks ni HTTP tok; to ostaje
provjera na deployu/bazi.

### Montaža, demontaža i zamjena guma — Faza 4

`apps/api/test/unit/tire-installations.spec.ts` — 12 testova nad stateful
lažnim transakcijskim klijentom: redoslijed zaključavanja vozilo → komplet(i),
uspješna montaža kroz objavljenu `TIRE_INSTALLATION` formu, status kompleta,
očitanje `TIRE`, denormalizovana kilometraža i outbox; isti komplet na drugom
vozilu i zauzeta pozicija kao `409 TIRE_ALREADY_MOUNTED`; regresija km,
povučena forma i mapiranje `P2002`; demontaža s obračunom km/dana, CAS
verzijom i oslobađanjem kompleta; zamjena s jednim očitanjem i validacijom
novog kompleta prije upisa; strict DTO pozicija/razloga te permisije/audit.
DI provjera je dopunjena zasebnim servisom i kontrolerom instalacija (+2).

`apps/web/src/features/tires/tire-installation-model.test.ts` — 4 testa
stabilnog redoslijeda pozicija, početnog izbora prema broju guma/starim
pozicijama, mount/swap/dismount payloada i odbijanja nepotpunog unosa prije
zahtjeva. Seed-form test dodatno provjerava da `montaza_guma` mapira datum i
kilometražu u normalizovane kolone. Fake transakcija ne dokazuje stvarni
PostgreSQL `FOR UPDATE`, partial unique indeks pod opterećenjem, rollback ni
HTTP tok; to ostaju integracijska/deploy provjera.

### Idempotency-Key replay — cross-cutting

`apps/api/test/unit/idempotency.spec.ts` — 19 testova nad in-memory Redis
lažnjakom: stabilan hash JSON otiska, rezervacija od 5 minuta i završeni
zapis od 24 h, regresija da `complete` čuva hash zahtjeva umjesto hash
odgovora, replay istog statusa/tijela bez drugog handler poziva, DELETE 204,
različit payload ili putanja kao `422 IDEMPOTENCY_KEY_REUSED`, paralelni
zahtjev u toku kao `409 VERSION_CONFLICT`, oslobađanje nakon greške i zabrana
da tuđi token završi/oslobodi rezervaciju. Pokriveni su i opseg po korisniku,
neispravno zaglavlje, javne/auth/multipart rute, odgovor s privremenom
lozinkom koji se ne kešira te mapiranje Redis greške u 503. DI provjera je
dopunjena globalnim interceptorom (+1). Lažnjak ne dokazuje stvarnu Redis
konkurenciju, TTL isteke pod satom servera ni puni Nest HTTP redoslijed
guardova/interceptora; to ostaje integracijska/deploy provjera.

### Vrste zadataka i zahtjevi završetka — prva cjelina Faze 5

`apps/api/test/unit/task-types.spec.ts` — 13 testova nad stateful lažnim
transakcijskim klijentom: lista bez arhiviranih zapisa, serverski `q`,
`activeOnly` i `requiresVehicle`, whitelist i stabilno podrazumijevano
sortiranje, serijalizacija povezane objavljene forme i detalja; kreiranje s
DTO defaultima i akterom; kod arhivirane vrste i konkurentni `P2002` kao
`DUPLICATE_ENTRY`; nepostojeća, tuđa, pogrešnog subjecta i neobjavljena
zadana forma; PATCH efektivne veze vozilo/kilometraža, brisanje opcija kroz
`null` i blokada nekompatibilne promjene forme; zaključano arhiviranje i
ponovljeni pokušaj kao 404; atomska zamjena zahtjeva uz provjeru ključa i
`PHOTO` tipa za `minPhotos`; strict DTO granice te odvojene permisije,
audit i `201`/`204` statusi kontrolera. DI regresija je dopunjena servisom i
kontrolerom (+2), a registar Prisma selecta za `TASK_TYPE_SELECT` i
`COMPLETION_REQUIREMENT_SELECT`.

`packages/shared/test/schemas.spec.ts` — 6 novih testova direktno pokriva
create/update/archive/list DTO-e, defaultove i normalizaciju boje, vezu
vozila i kilometraže, strict zabranu serverskih polja te zahtjeve i
odgovore; time shared coverage ostaje iznad CI praga za funkcije.

`apps/api/test/unit/seed.spec.ts` — postojeći seed scenariji dopunjeni su
provjerama da prvi prolaz dodaje svih 8 kodova, da se `WASH` veže za
objavljenu formu `pranje_vozila`, da ostale početne vrste zasad nemaju
zadanu formu, da drugi prolaz ne pravi duplikate i da se konfiguracija
seeduje i kad demo podaci nisu uključeni.

`apps/web/src/features/task-types/task-types-model.test.ts` — 10 testova:
gradnja serverskog upita, izbor samo generičkih/vlastitih objavljenih TASK
formi, efektivna forma istim prioritetom kao API bez generičkog fallbacka,
normalizacija i odbijanje neispravnog kreiranja, PATCH samo sa
stvarnim izmjenama i `null` brisanjem opcionalnih polja, očuvanje trenutne
forme kad lista formi nije dostupna, mapiranje i stroga validacija draftova
zahtjeva te tekst/paginacija nakon arhiviranja.

Lažni Prisma klijent izvršava callback bez stvarnog rollbacka i ne dokazuje
PostgreSQL `FOR UPDATE`, jedinstveni indeks pod konkurencijom, Nest HTTP
guard/interceptor redoslijed ni prikaz u browseru. P4–P8 ostaju za zadatke,
claim, završetak, outbox i obavijesti u sljedećim cjelinama; produkcijska
provjera ide kroz Coolify deploy i seed.

### Jezgra zadataka — druga cjelina Faze 5

`apps/api/test/unit/tasks.spec.ts` — 20 testova nad stateful lažnim
transakcijskim klijentom i lažnim RBAC servisom: kod `Z-YYYY-000001`,
snapshot eksplicitne i vezane objavljene TASK verzije, lokalni `dueDate`,
pozvani/posmatrači, `CREATED`/`INVITED` događaji i DB outbox
`TASK_CREATED`; `ON_CREATE` zahtjevi i djelimična validacija nacrta bez
odbijanja ostalih obaveznih polja forme; vrsta bez efektivne forme kao
`409 FORM_VERSION_NOT_PUBLISHED` bez generičkog fallbacka; neaktivna vrsta,
obavezno/arhivirano vozilo te nepostojeći, neaktivni i primaoci bez
`task:claim`; direktna dodjela koja ostaje `OPEN` s jednim `ASSIGNEE` redom;
broadcast payload i vidljivost; serverski filteri, `mine`, `overdueOnly`,
pretraga i 404 za detalj izvan opsega; PATCH opseg/status, CAS i neispravan
nacrt; otkazivanje i reopen kroz statusnu mašinu, uključujući opoziv
izvršioca kod otkazanog `OPEN_CLAIM`, očuvanje direktnog izvršioca i
`COMPLETED → IN_PROGRESS`; permisije, audit i `201` metadata kontrolera.

`packages/shared/test/schemas.spec.ts` — 5 novih testova za create/PATCH/
cancel/reopen/list DTO-e, preklapanja uloga i načina dodjele, CAS verziju te
strict `TaskDetail`/`TaskListResponse`; fajl sada ima 31 test.

`apps/api/test/unit/form-schemas-service.spec.ts` — aktivna TASK forma sada
dokazuje kanonički prioritet eksplicitna forma vrste pa forma vezana za
vrstu te da poznata vrsta bez forme i nepostojeća vrsta ne padaju na
generičku formu. DI regresija je dopunjena `TasksService` i
`TasksController` (+2), a registar Prisma selecta za `TASK_SELECT`,
`TASK_ASSIGNMENT_SELECT` i `TASK_EVENT_SELECT`.

Lažni klijent izvršava transakcijski callback bez rollbacka i ne dokazuje
stvarni PostgreSQL advisory lock za kod, `FOR UPDATE`, jedinstvenost pod
konkurencijom, puni Nest HTTP lanac ni Coolify bazu. Atomski claim i
završetak opisani su u sljedećim odjeljcima; P4–P8 integracijski dokazi
ostaju zasebne cjeline. Ova cjelina dokazuje samo upis DB outbox redova,
ne worker, FCM ni SSE isporuku.

### Slobodni zadaci i atomski claim — treća cjelina Faze 5

`apps/api/test/unit/tasks.spec.ts` sada ima 29 testova; novih 9 pokriva:
`/tasks/available` za pozvane, direktnog izvršioca, kreatora vlastitog
broadcast zadatka i broadcast korisnika s `ALL` opsegom, uz isključenje
posmatrača, vanjskog korisnika, zadatka u toku i aktera bez
`task:claim`; uspješan claim kao jedan prelaz s aktivnim `ASSIGNEE`
redom, jednim `CLAIMED` događajem i jednim `TASK_CLAIMED` outbox redom;
20 paralelnih poziva nad lažnim klijentom s tačno jednim uspjehom i 19
odgovora `409`; direktnu dodjelu bez dupliranja postojećeg izvršioca;
`404` za nevidljiv zadatak, `SCOPE_DENIED` za posmatrača i odbijanje
neaktivnog kandidata; kreatora `OPEN_CLAIM` zadatka bez pozvanih i
reaktivaciju opozvanog `ASSIGNEE` reda; `OWN` i `VEHICLE_IDS` granice
broadcast kandidature; spajanje nacrta i `ON_CLAIM` zahtjev prije prelaza
te podatke o pobjedniku u `TASK_ALREADY_CLAIMED` i `422` za terminalna
stanja. Metadata test sada čuva `task:claim`, HTTP `200` i audit `CLAIM`.

`packages/shared/test/schemas.spec.ts` sada ima 32 testa; novi test čuva
strict claim DTO bez serverske verzije/izvršioca i available query bez
serverskog statusa ili `mine` filtera.

Paralelni jedinični test nije P6 dokaz: lažni klijent izvršava
`updateMany` sinhrono u jednom JavaScript procesu, bez PostgreSQL
zaključavanja redova, djelimičnog jedinstvenog indeksa, rollbacka,
Redis `Idempotency-Key` replaya i punog Nest HTTP lanca. P5/P6 i dalje
zahtijevaju integration/stress test iz §3 nad pravom bazom na Coolifyu.

### Završetak i override — četvrta cjelina Faze 5

`apps/api/test/unit/tasks.spec.ts` sada ima 35 testova; novih 6 pokriva:
uspješan završetak izvršioca koji spaja nacrt, prolazi punu formu,
normalizuje trošak, upisuje trajanje iz `claimedAt`, veže fotografiju
polja i opći prilog, stvara komentar, jedan `COMPLETED` događaj i jedan
`TASK_COMPLETED` outbox; `ON_COMPLETE` minimum fotografija, nepoznat
prilog (`ATTACHMENT_UNKNOWN`), tuđi opći prilog i zadržan `ON_CLAIM`
zahtjev pri završetku; P7 klasifikaciju na jediničnom nivou — vidljivi
neizvršilac `403 NOT_ASSIGNEE`, nevidljivi zadatak `404`, izvršilac bez
permisije `PERMISSION_DENIED` i izvršilac izvan `VEHICLE_IDS` opsega
`SCOPE_DENIED`; override korisnika koji završava tuđi zadatak uz
`completedById` jednak akteru, razlog, `OVERRIDE_COMPLETED`, očuvanu fazu
prethodno vezane fotografije i obavijest izvršiocu, dok isti korisnik na
vlastitom zadatku daje obični `COMPLETED`; CAS `VERSION_CONFLICT` i
`INVALID_TASK_TRANSITION` iz `OPEN`/`COMPLETED`; te direktnu kilometražu
koja mora odgovarati normalizovanoj vrijednosti i nije dozvoljena bez
vozila. Metadata test dodatno čuva obje completion permisije u `ANY`
načinu, HTTP `200`, audit `COMPLETE` i strict DTO bez starog naziva
`formValues`.

`packages/shared/test/schemas.spec.ts` sada ima 33 testa; novi test čuva
CAS verziju, prazne podrazumijevane `formData`/`attachmentIds`, trimovanje
komentara i override razloga, granice kilometraže, zabranu duplih općih
priloga i odbijanje serverskih polja. Registar u
`prisma-select-fields.spec.ts` proširen je za `TASK_ATTACHMENT_SELECT`;
ciljani API prolaz za zadatke i selecte je 40/40, a shared sheme 33/33.

Ovi testovi nisu P7 integracijski dokaz: lažni klijent nema stvarni
PostgreSQL `FOR UPDATE`, transakcijski rollback, Decimal upis, provjeru
fajlova na disku, Redis replay, puni Nest auth/audit lanac ni Coolify
bazu. P7 fajl `task-complete-authorization.integration.spec.ts` tek treba
nad pravom bazom potvrditi korisnika B (`403 NOT_ASSIGNEE`), izvršioca
(`200`) i korisnika C (`200`, AuditLog `COMPLETE` s `override=true`,
TaskEvent `OVERRIDE_COMPLETED`, `completedById=C`).


### Vraćanje zadatka među slobodne — peta cjelina Faze 5

`apps/api/test/unit/tasks.spec.ts` sada ima 38 testova. Dodatni release testovi pokrivaju uspješno `IN_PROGRESS → OPEN` s CAS verzijom, `releasedAt` i brisanje claim vremena/trajanja; vraćanje `OPEN_CLAIM`/`BROADCAST` assignee reda i očuvanje pozvanih/posmatrača; očuvanje direktnog izvršioca kao kandidata; `VERSION_CONFLICT`, nedozvoljen status, nedovoljan permission scope, event/outbox upise i route audit metadata.

`packages/shared/test/schemas.spec.ts` prolazi 33 testa, uključujući strict release DTO i granice/trimovanje opcionalnog razloga. Puni API paket prolazi 896 testova; `pnpm env:check` i workspace gate `lint typecheck test build` prolaze. `pnpm test:coverage` prolazi. Ovi testovi ne dokazuju stvarni PostgreSQL lock/rollback, HTTP idempotency replay ni Coolify ponašanje; ti dokazi ostaju otvoreni.


### Naknadna dodjela zadatka — šesta cjelina Faze 5

`apps/api/test/unit/tasks.spec.ts` sada ima 40 testova; dvije nove service provjere pokrivaju CAS dodjelu kandidata i direktnog izvršioca na `OPEN`, očuvanje posmatrača, audit route metadata, `TaskEvent(ASSIGNED)`, `OutboxEvent(TASK_ASSIGNED)`, zamjenu izvršioca za `IN_PROGRESS`, odbijanje `OPEN_CLAIM` tokom izvršavanja i zastarjelu verziju. `packages/shared/test/schemas.spec.ts` prolazi 33 testa uz provjere strict DTO-a, jednog direktnog korisnika, broadcast bez korisnika, duplikata i odbijanja dodatnih serverskih polja.

Testovi su jedinični i ne dokazuju PostgreSQL konkurentnost/rollback, HTTP replay ni Coolify isporuku outboxa.


### Komentari zadatka — sedma cjelina Faze 5

`apps/api/test/unit/tasks.spec.ts` pokriva kreiranje komentara uz `COMMENTED` događaj i jedinstveni `TASK_COMMENTED` outbox ključ, paginaciju liste, odbijanje nevidljivog zadatka i nedostajućeg `task:comment`, te `GET/POST` permission, status i audit metadata. `packages/shared/test/schemas.spec.ts` provjerava trimovanje teksta, prazan tekst i odbijanje nepoznatog polja za komentar.

Jedinični lažni klijent ne dokazuje rollback, HTTP retry ponašanje ni isporuku outboxa u Coolifyu.


### Historija događaja zadatka — osma cjelina Faze 5

`apps/api/test/unit/tasks.spec.ts` provjerava sortiranu/serijalizovanu `TaskEvent` historiju i skrivanje zadatka izvan vidljivosti. `TasksController` metadata test čuva zahtjev za `task:view` ili `task:view_all`. Test je jedinični; HTTP/RBAC integration i Coolify dokaz ostaju otvoreni.


### Web lista zadataka i claim — W09

`apps/web/src/features/tasks/tasks-model.test.ts` provjerava da segmenti koriste odgovarajuće API rute/parametre i prikaz broja zadataka. `tasks-page.test.tsx` provjerava učitavanje slobodnog zadatka i uspješno pozivanje claim endpointa uz potvrdu poruke. Ručni browser/UAT tok, API 409 preko pravog servera i Coolify nisu dio ovog jediničnog testa.


### Web detalj zadatka, historija i komentari — W09

`apps/web/src/features/tasks/task-detail-page.test.tsx` provjerava detalje, historiju, sakrivanje Claim akcije bez `task:claim` i dodavanje komentara kroz API. Završni obrazac (`task-completion-form.tsx`) učitava tačnu snapshotovanu verziju forme, uploaduje PHOTO/FILE fajlove kroz multipart `/attachments` uz `attachment:upload`, šalje ID-jeve u formData te šalje `version` kao CAS zaštitu i comment/odometerKm; mapira greške servera nazad na polja i osvježava detalj/liste nakon uspjeha. `api.test.ts` provjerava da multipart klijent ne postavlja ručno `Content-Type` (boundary postavlja browser). `task-status-actions.tsx` nudi otkazivanje (razlog obavezan), release i reopen uz odgovarajuće permisije/status te šalje `version`; API ostaje opseg/permisija konačni autoritet. `task-status-actions.test.tsx` provjerava obavezni razlog, trimovanje, CAS payload i status/permisija vidljivost. Browser UAT i API integracija nisu provedeni.

### Web kreiranje zadatka — W17

`task-create-page.tsx` implementira tri koraka i koristi liste aktivnih vrsta, aktivnih vozila (kada su potrebna), aktivnih korisnika uz `user:view` te efektivnu TASK formu. Kreiranje ide kroz postojeći `POST /tasks`; server bira i snapshotuje stvarnu objavljenu verziju. Podržani su tri načina dodjele i korisnici pozvani/posmatrači; PHOTO/FILE upload ide kroz multipart `/attachments`, a server `POST /tasks` provjerava attachment facts i transakcijski veže fajlove sa `ON_CREATE`. API `tasks.spec.ts` provjerava ON_CREATE zahtjev i vezivanje. `task-create-page.test.tsx` provjerava multipart upload PHOTO fajla, da browser postavlja boundary umjesto klijentskog `Content-Type`, slanje ID-a u `formData` i navigaciju na kreirani zadatak. API `tasks.spec.ts` provjerava odbijanje nepoznatog priloga i atomsku vezu validnog upload-a u `ON_CREATE`. Browser UAT i stvarna RBAC/PostgreSQL integracija nisu provedeni.
