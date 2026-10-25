# VOZNI PARK (VFM) — Master plan implementacije

| | |
|---|---|
| **Dokument** | Master (krovni) plan implementacije |
| **Verzija dokumenta** | 1.0.0 |
| **Datum** | 19.10.2026. |
| **Izvor zahtjeva** | `Projektni_zadatak_Vozni_park_Unaprijedjen.md` (v2.0) |
| **Status** | Odobren za implementaciju — faza po faza |
| **Prefix aplikacije** | `vfm` (kontejneri, Redis ključevi, Redis ACL useri, queue-ovi, volumeni) |
| **Deployment** | Coolify (Docker Compose build pack), privatni server |

---

## 0. Kako čitati ovu dokumentaciju

Ovaj fajl je **hub**. Sve ostalo je u `docs/` i povezano ovdje. Ako se nešto mijenja, mijenja se **prvo** ovdje, pa u odgovarajućem poddokumentu.

| Dokument | Šta sadrži |
|---|---|
| [`01-KONCEPT_UNAPREDJENJA.md`](01-KONCEPT_UNAPREDJENJA.md) | Delta u odnosu na projektni zadatak: unaprijeđenja koncepta, logike, funkcionalnosti + registrovani bug-ovi/rizici originalnog zadatka |
| [`02-ARHITEKTURA.md`](02-ARHITEKTURA.md) | Sistem arhitektura, monorepo struktura, verzije paketa, tokovi podataka, transakcije, outbox, dijagrami |
| [`03-MODEL_PODATAKA.md`](03-MODEL_PODATAKA.md) | Kompletni entiteti, polja, indeksi, unique/CHECK/exclusion ograničenja, poslovna pravila na nivou baze, Prisma smjernice |
| [`04-FORM_ENGINE.md`](04-FORM_ENGINE.md) | Verzionisanje formi, JSON shema polja, sigurni izrazi (bez JS-a), validacija, migracija historijskih zapisa |
| [`05-RBAC_PERMISIJE_SIGURNOST.md`](05-RBAC_PERMISIJE_SIGURNOST.md) | Matrica permisija, kodovi permisija, opseg podataka, token model, brza revokacija, zabrana mobilnog pristupa Super Admina, sigurnosne kontrole |
| [`06-UX_UI_DIZAJN.md`](06-UX_UI_DIZAJN.md) | Zvanični UX/UI izvor: dizajn sistem, IA, wireframe-ovi i pristupačnost; prije većeg redizajna obavezan detaljan audit [referentnog projekta `vehicle-fleet-management-application.zip`](../vehicle-fleet-management-application.zip), uz matricu šta se preuzima, prilagođava ili odbacuje — bez cilja potpune replike |
| [`07-API_SPECIFIKACIJA.md`](07-API_SPECIFIKACIJA.md) | REST `/api/v1` konvencije, kompletan popis endpointa, greške, paginacija, idempotency |
| [`08-DOCKER_COOLIFY_DEPLOYMENT.md`](08-DOCKER_COOLIFY_DEPLOYMENT.md) | Dockerfile-ovi, compose varijante, `db_net`/`redis_net`, Coolify koraci, HTTPS/DNS/firewall, backup/restore, rollback |
| [`09-TEST_PLAN.md`](09-TEST_PLAN.md) | Test strategija, 16 obaveznih kriterija prihvatanja mapiranih na testove, e2e scenariji, seed |
| [`10-OPERACIJE.md`](10-OPERACIJE.md) | Monitoring, logovi, incidenti, runbook, kapaciteti, nadogradnja |
| [`11-PRODUKCIJA_DEPLOY.md`](11-PRODUKCIJA_DEPLOY.md) | **Operativni runbook za Coolify**: PostgreSQL/REDIS konekcija, `redis-cli` ACL komande, ENV lista, domene, auto-deploy, verifikacija, troubleshooting |
| [`FAZA0_IZVJESTAJ.md`](FAZA0_IZVJESTAJ.md) | **Izvještaj o Fazi 0**: šta je isporučeno, dokazi (komande/rezultati), odstupanja, blokeri i obaveze vlasnika prije Faze 1 |
| [`FAZA1_IZVJESTAJ.md`](FAZA1_IZVJESTAJ.md) | **Izvještaj o Fazi 1 (identitet)**: P1/P2/P3/P14 status, 776 testova, coverage, šta vlasnik mora pokrenuti (migracija 3, seed, bootstrap) i odstupanja (anonimizacija umjesto DELETE, reset token preko admina, odgođeni audit stream) |
| [`.env.example`](../.env.example) | **Jedini izvor istine** za sve varijable okruženja (Coolify + lokalno) |
| [`REDIS_ACL.md`](../REDIS_ACL.md) | **Jedini izvor istine** za Redis ACL (useri, ključevi, komande) — setuje se kroz poseban fajl na Coolify Redis resursu |
| [`docker-compose.yml`](../docker-compose.yml) / [`.dev.yml`](../docker-compose.dev.yml) / [`.coolify.yml`](../docker-compose.coolify.yml) | Coolify/produkcijski stack (`db_net`, `redis_net`), lokalni dev, hardening override |
| [`apps/api/Dockerfile`](../apps/api/Dockerfile) · [`apps/web/Dockerfile`](../apps/web/Dockerfile) | Multi-stage image-i (api/worker/migrate iz istog image-a; web = nginx) |
| [`scripts/env-sync-check.mjs`](../scripts/env-sync-check.mjs) | CI provjera: compose ↔ `.env.example` ↔ `REDIS_ACL.md` |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI: env-sync → lint/typecheck → unit → integration/stress → security → build/docker |

> ⚠️ **Pravilo sinhronizacije (obavezno):** svaka promjena u `docker-compose*.yml`, `Dockerfile*`, ili u kodu koja uvede novu env varijablu **mora** istovremeno ažurirati `.env.example`. Svaka promjena Redis ključeva/prefiksa/queue-ova **mora** istovremeno ažurirati `REDIS_ACL.md` (i obrnuto). Agent je dužan na kraju svake faze eksplicitno upozoriti: *"Provjeri da li su `.env.example` i `REDIS_ACL.md` sinhronizovani"* i navesti tačne izmjene koje vlasnik mora prenijeti u Coolify.

---

## 1. Sažetak sistema (jedan pasus)

VFM je interni sistem za upravljanje službenim voznim parkom od ~10 vozila (proširivo). Sastoji se od: **NestJS REST API-ja** (`/api/v1`) nad **PostgreSQL-om**, **React/Vite web portala** (Super Admin + administratori), **Expo Android aplikacije** (administratori + obični korisnici), **BullMQ workera** na **Redisu** (outbox, FCM push, podsjetnici, izvještaji) i **Firebase Cloud Messaging** isporuke. Ključne karakteristike: konfigurabilan RBAC čije se promjene odmah primjenjuju, verzionisane dinamičke forme (Form Builder) gdje svaki zapis trajno čuva verziju forme kojom je nastao, atomsko preuzimanje zadataka (tačno jedan izvršilac pri paralelnim zahtjevima), pun audit trag i transactional outbox za pouzdane obavijesti.

---

## 2. Ciljevi i mjera uspjeha

| Cilj | Mjera |
|---|---|
| Pouzdan tok zadatka | 1000 paralelnih `claim` poziva nad istim zadatkom → tačno 1 `IN_PROGRESS`, 999 `409 TASK_ALREADY_CLAIMED` |
| Revokacija prava | Oduzeta permisija blokira API poziv u ≤ 5 s (bez ponovnog logina) |
| Pouzdanost obavijesti | Push greška ne gubi zadatak; outbox retry bez duplikata (unique `notification_key`) |
| Stabilnost historije | Promjena forme ne mijenja i ne reinterpretira stare zapise |
| Podaci preživljavaju restart | `docker compose down && up` → svi podaci i prilozi netaknuti |
| Performanse | Lista zadataka/vozila: p95 < 400 ms pri 50k zapisa; dashboard p95 < 800 ms |
| Pristupačnost | WCAG 2.2 AA na svim web ekranima; mobilni touch targeti ≥ 44×44 px |

---

## 3. Obim

### 3.1 U obimu (faze 0–9)
Autentifikacija i RBAC, upravljanje korisnicima/rolama/permisijama, profili vozača, evidencija vozila, kilometraža, registracije, osiguranje, servisi s dijelovima i troškovima, gume (komplet + pojedinačne + montaža/demontaža + ciklusi), vrste zadataka, dinamičke verzionisane forme s Form Builder-om, radni zadaci s atomskim preuzimanjem, obavijesti (in-app + FCM), prilozi/fotografije na host volume-u, izvještaji s PDF/Excel izvozom, audit log, Docker/Compose/Coolify deployment, backup/restore, testovi.

### 3.2 Van obima (eksplicitno — da ne curi obim)
- Offline unos na mobilnoj aplikaciji s lokalnim queue-om i conflict rezolucijom → **Faza 10 / v2** (mobile je online-first po odluci).
- Automatsko očitavanje kilometraže (OBD/GPS telematika) → samo pripremljen `OdometerReading.source` model.
- Više organizacija/tenanta, više valuta s konverzijom, obračun PDV-a i fiskalizacija.
- iOS aplikacija, web push, SMS/Viber/WhatsApp kanali.
- Integracija s eksternim servisima (registracijske agencije, osiguranja, e-uprava).
- ERP/finansijski obračun troškova po cost center-ima (model ima `costCenter`, ali bez obračuna).
- BI dashboard s custom grafovima (postoje fiksni, unaprijed definisani widgeti).

### 3.3 Pretpostavke
1. Početni obim 10 vozila, ≤ 20 korisnika, ≤ 5 administratora, 1–2 Super Admina.
2. PostgreSQL i Redis su **globalni resursi koji već rade na istom Docker hostu** (potvrđeno, R-02) i dostupni su preko eksternih mreža `db_net` odnosno `redis_net`. Naš compose ih **ne** pokreće; baza (host/user/dbname/password) je već kreirana, a Redis se dijeli s drugim aplikacijama (ACL varijanta B).
3. Jedan server, jedan region, jezik `bs` (bosanski), valuta `BAM/KM`, vremenska zona `Europe/Sarajevo`.
3a. **Domene (R-03):** web `https://vehicle.ba101.top`, API `https://api.vehicle.ba101.top`; Coolify izdaje HTTPS.
3b. **2FA se NE implementira (R-05)** — iz modela/API-ja/ENV-a uklonjene 2FA stavke.
3c. **Backup/restore se NE implementira u ovom ciklusu (R-10)** — ostaje dokumentovan i u backlog-u (P16 odgođen).
3d. **Firebase kreira vlasnik ručno (R-04)** — do tada `FIREBASE_ENABLED=false`, obavijesti in-app.
3e. **Dev/prod podjela compose-a:** `docker-compose.yml` (Coolify/prod) **NE** sadrži postgres ni redis — samo se povezuje na globalne instance preko `db_net`/`redis_net` (`external: true`). `docker-compose.dev.yml` (lokalne sesije) **podže** lokalni `vfm-postgres` i `vfm-redis`.
4. Mobilna aplikacija se distribuira interno (APK) + Google Play (AAB) preko EAS Build-a; ne builda se u Dockeru.
5. Firebase projekat i `service_account.json` obezbjeđuje vlasnik; tajna je dostupna **samo** backend kontejneru.

---

## 4. Odluke o tehnologiji (ADR sažetak)

| # | Odluka | Izbor | Obrazloženje / odbačeno |
|---|---|---|---|
| ADR-01 | Monorepo | **pnpm workspaces + Turborepo** | Dijeljenje Zod shema i tipova (`packages/shared`) između api/web/mobile bez publishovanja; keš buildova u CI. Odbačeno: Nx (teži), odvojeni repo-i (duplikacija koda). |
| ADR-02 | Backend | **NestJS 12 + TypeScript strict** | Traženo zadatkom; modularna DI struktura mapira 1:1 na module permisija. |
| ADR-03 | ORM / migracije | **Prisma 7.10 (stable)**, verzionirane migracije u Git-u | Traženo zadatkom. **Ne** koristimo `prisma db push` u produkciji. Za CHECK/EXCLUSION ograničenja i atomične transakcije pišemo ručni SQL u migracijama i koristimo `$queryRaw`/`$executeRaw` gdje Prisma nije dovoljna (npr. atomski `claim`). |
| ADR-04 | Baza | **PostgreSQL 17** | Jedina primarna baza; `timestamptz`, JSONB, exclusion constraint za preklapanje perioda. |
| ADR-05 | Redis | **Redis 7.4+ sa ACL fajlom**, mreža `redis_net`, prefix `vfm:` | Queue, cache, rate-limit, lock, verzije permisija. ACL useri: `vfm-api`, `vfm-worker`, `vfm-readonly`. Vidi `REDIS_ACL.md`. |
| ADR-06 | Queue | **BullMQ 6** | Zreo, Redis-native, retry/backoff/DLQ, repeatable jobs za podsjetnike. Odbačeno: pg-boss (manje operativne vidljivosti), RabbitMQ (dodatna infrastruktura). |
| ADR-07 | Validacija | **Zod 4** — jedna shema u `packages/shared`, koristi je API (DTO), web (RHF resolver) i mobilna | Traženo zadatkom ("Zod ili ekvivalent"); jedna shema = nema drifta između klijenta i servera. |
| ADR-08 | Web | **Vite 8 + React 19 + TypeScript + Tailwind 4 + shadcn/ui + TanStack Query 5 + React Router 8 + react-hook-form** | Traženo zadatkom. shadcn/ui = komponente u našem repo-u (ne npm dependencija) → puna kontrola nad dizajnom i pristupačnošću. |
| ADR-09 | Tabele | **TanStack Table 8** (server-side paging/sort/filter) | Konzistentno sa Query-om; izbjegava duplo stanje. |
| ADR-10 | Mobilna | **Expo SDK 57 + expo-router + React Native**, Android APK/AAB preko **EAS Build** | Traženo zadatkom. FCM direktno (Firebase Admin SDK u API-ju), **ne** Expo push servis → jedan izvor istine za tokene. |
| ADR-11 | Push | **Firebase Admin SDK (FCM v1)** iz `worker` kontejnera | Service account tajna nikad nije u web/mobile bundle-u. |
| ADR-12 | Autentifikacija | **Access JWT (10 min) + rotirajući refresh token (hash u DB)**, web = `httpOnly` cookie, mobilna = secure storage | Revokacija je moguća (refresh session tabela) + `tokenVersion`/`permissionsVersion` za trenutno oduzimanje prava. Odbačeno: čisti stateless JWT (zadatak eksplicitno traži brzu primjenu revokacije). |
| ADR-13 | Autorizacija | **DB-driven RBAC** (module × action × scope), permisije se nikad ne čitaju iz JWT payloada nego iz keša/DB uz `permissionsVersion` | Traženo zadatkom; UI samo sakriva akcije, backend odlučuje. |
| ADR-14 | Prilozi | **Host bind-mount** (`${VFM_STORAGE_PATH}` na hostu → `/data/vfm` u kontejneru), pristup isključivo preko API-ja uz potpisani URL i provjeru permisija | Odluka vlasnika. Odbačeno: S3 (dodatni resurs), BYTEA (rast baze). |
| ADR-15 | Reverse proxy | **Coolify Traefik** (ne dodajemo Caddy/Nginx proxy u compose) | Traefik već terminira HTTPS i rutira po domenama; `web` (nginx) samo servira statiku. Dodatni proxy = dupli TLS i rizik od 504. |
| ADR-16 | Novac | `integer` u **feninzima** (1 KM = 100), valuta `BAM` | Bez floating-point grešaka u izvještajima. |
| ADR-17 | Vrijeme | Sve `timestamptz` u **UTC**, prikaz `Europe/Sarajevo`, "datum isteka" = `date` + TZ pravilo | Traženo zadatkom; podsjetnici se računaju po lokalnom datumu. |
| ADR-18 | Form Builder | **Deklarativna JSON shema + bijela lista tipova polja + AST evaluator za izraze** | Bez proizvoljnog JS-a (traženo). Renderer je zajednički paket (`packages/form-renderer`) za web i mobilnu. |
| ADR-19 | Izvještaji | SQL view-ovi + `ReportDefinition` + export worker (PDF: `pdfmake`/`puppeteer`-free; Excel: `exceljs`) | Izvoz van API procesa → ne blokira requeste. |
| ADR-20 | CI/CD | GitHub Actions: lint → typecheck → test → build → (ručni) deploy webhook na Coolify | Bez auto-deploya na produkciju dok se ne prođe UAT. |

**Pinnane verzije (stable, provjereno 19.10.2026.):** `@nestjs/core 12.1.3`, `prisma 7.10.1`, `bullmq 6.3.17`, `ioredis 6.0.0`, `zod 4.6.7`, `react 19.3.1`, `vite 8.3.4`, `tailwindcss 4.3.3`, `react-router 8.4.0`, `@tanstack/react-query 5.104.4`, `expo 57.0.30` (tag `sdk-57`). Node **22 LTS**, pnpm **10**, PostgreSQL **17**, Redis **7.4**.

---

## 5. Struktura repozitorija

```
Vehicle-Fleet-Management-App/
├── apps/
│   ├── api/                      # NestJS REST API + Swagger + health
│   │   ├── src/
│   │   │   ├── main.ts           # bootstrap, helmet, CORS allowlist, prefix /api/v1
│   │   │   ├── app.module.ts
│   │   │   ├── common/           # filteri, guard-ovi, interceptor-i, dekoratori, paginacija
│   │   │   ├── config/           # env.ts (Zod validated), configuration.ts
│   │   │   ├── infra/            # prisma, redis, bullmq, mail, storage, firebase
│   │   │   └── modules/
│   │   │       ├── auth/         # login, refresh, logout, 2FA (opcija), device sessions
│   │   │       ├── users/        # nalozi, profil, tokenVersion
│   │   │       ├── roles/        # role, permisije, matrica, permissionsVersion
│   │   │       ├── drivers/
│   │   │       ├── vehicles/     # vozila + odometer
│   │   │       ├── registrations/
│   │   │       ├── insurance/
│   │   │       ├── services/     # servis + stavke
│   │   │       ├── tires/        # setovi, gume, montaže
│   │   │       ├── form-schemas/ # Form Builder backend + engine
│   │   │       ├── task-types/
│   │   │       ├── tasks/        # kreiranje, claim (atomski), complete, release, cancel
│   │   │       ├── attachments/  # upload, signed URL, download
│   │   │       ├── notifications/# in-app + device tokeni
│   │   │       ├── reminders/    # pravila i due-skener
│   │   │       ├── reports/      # view-ovi, izvoz
│   │   │       ├── settings/     # globalne postavke, šifarnici
│   │   │       └── audit/        # audit log, security events
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/       # verzionirane migracije (uklj. ručni SQL za constrainte)
│   │   │   └── seed/             # dev/demo seed (10 vozila, 3 role, primjeri)
│   │   ├── test/                 # unit / integration / e2e (jest + supertest + testcontainers)
│   │   └── Dockerfile
│   ├── web/                      # Vite + React + Tailwind + shadcn/ui
│   │   ├── src/
│   │   │   ├── app/              # router, providers, layout, route guards
│   │   │   ├── features/         # vehicles, drivers, tasks, forms, reports, admin...
│   │   │   ├── components/ui/    # shadcn/ui (generisano, commit-ovano)
│   │   │   ├── lib/              # api client, auth, permissions hook, utils
│   │   │   └── styles/           # tokens.css, globals.css
│   │   ├── nginx/                # nginx.conf (SPA fallback, gzip, security headers)
│   │   └── Dockerfile
│   └── mobile/                   # Expo SDK 57, expo-router, Android APK/AAB
│       ├── src/app/              # route-ovi (login, tasks, vehicle, notifications, profile)
│       ├── src/features/
│       ├── eas.json              # build profili (dev, preview=APK, production=AAB)
│       └── app.json / app.config.ts
├── packages/
│   ├── shared/                   # Zod sheme, DTO tipovi, enum-i, konstante, permisije kodovi
│   ├── form-renderer/            # renderer dinamičkih formi (React web + React Native)
│   ├── form-engine/              # validacija sheme, evaluator sigurnih izraza, migracija vrijednosti
│   ├── api-client/               # tipizirani klijent (fetch + TanStack Query helpers)
│   └── config/                   # eslint, tsconfig, prettier, tailwind preset
├── infra/
│   ├── redis/
│   │   └── users.acl.example     # sadržaj koji se lijepi u Coolify "Custom Redis configuration"
│   └── postgres/
│       └── init/                 # opcionalni init SQL (ekstenzije: pgcrypto, btree_gist, citext)
├── scripts/
│   ├── env-sync-check.mjs        # CI: svaka ${VAR} iz compose mora postojati u .env.example
│   ├── bootstrap-super-admin.mjs # siguran bootstrap prvog Super Admina (bez fiksnih lozinki)
│   ├── backup-db.sh              # pg_dump + rotacija
│   ├── restore-db.sh             # testirani restore
│   └── gen-secrets.mjs           # generisanje JWT/cookie/file secrets
├── docs/                         # sva dokumentacija (ovaj folder)
├── docker-compose.yml            # Coolify/production stack (db_net + redis_net external)
├── docker-compose.dev.yml        # lokalni dev: vlastiti postgres + redis + mreže
├── docker-compose.coolify.yml    # override: eksternost mreža kroz varijable
├── .dockerignore
├── .env.example                  # ← UVIJEK AŽURAN
├── REDIS_ACL.md                  # ← UVIJEK AŽURAN
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## 6. Faze implementacije

Legenda: **DoD** = Definition of Done. Svaka faza završava s: (1) prolazećim build-om i testovima, (2) ažuriranim `.env.example`, (3) ažuriranim `REDIS_ACL.md` ako je dirano, (4) izvještajem "šta je urađeno / koje komande / rezultati / šta vlasnik mora popuniti / blokera".

---

### FAZA 0 — Temelji: monorepo, infrastruktura, CI (≈ 2–3 dana)

> **Status: ✅ isporučeno** (19.10.2026) — vidi [`FAZA0_IZVJESTAJ.md`](FAZA0_IZVJESTAJ.md).
> Kvalitet-kapije: `turbo lint typecheck test build` = 16/16 zeleno; 287 unit testova;
> `env-sync-check` = 0 upozorenja. **Otvoreno:** Prisma engine (`binaries.prisma.sh`
> nedostupan u sandboxu) → `prisma generate` pokrenuti na mašini s internetom; PG
> ekstenzije (`citext`, `btree_gist`) i Redis ACL na Coolify hostu.


**Cilj:** Repozitorij koji se može buildovati, linterovati, testirati i podići lokalno i na Coolify-u, bez ijedne poslovne funkcionalnosti.

**Zadaci**
1. `pnpm-workspace.yaml`, `turbo.json`, root `package.json`, `packages/config` (tsconfig base, eslint flat config, prettier).
2. Scaffold `apps/api` (NestJS 12, strict TS, `/api/v1` prefix, Swagger/OpenAPI 3.1, `helmet`, CORS allowlist iz env, globalni exception filter → RFC-7807-ish format, globalni validation pipe (Zod), request-id + pino strukturirani logovi, `/health/live` i `/health/ready`).
3. `config/env.ts`: **sve** env varijable prolaze kroz Zod shemu pri startu; nedostajuća/loša vrijednost = fail fast s jasnom porukom. Nema `process.env` čitanja van ovog modula.
4. Scaffold `apps/web` (Vite 8, React 19, TS, Tailwind 4, shadcn/ui init, React Router 8, TanStack Query 5, layout shell, error boundary, `/healthz` statika).
5. Scaffold `apps/mobile` (Expo 57, expo-router, TS strict, EAS profili) — samo skeleton + health ekran.
6. `packages/shared` (enum-i, konstante, Zod primitivi, kodovi permisija) i `packages/api-client`.
7. Docker: `apps/api/Dockerfile` (multi-stage, pnpm+turbo prune, non-root, dumb-init, healthcheck), `apps/web/Dockerfile` (multi-stage → nginx:alpine), `.dockerignore`.
8. Compose: `docker-compose.yml` (Coolify: `api`, `worker`, `migrate`, `web`; `db_net`/`redis_net` external), `docker-compose.dev.yml` (lokalni `vfm-postgres`, `vfm-redis` s ACL fajlom, `vfm-api`, `vfm-web`, `vfm-worker`), `docker-compose.coolify.yml` override.
9. `.env.example` (kompletan, sekcije + `CHANGELOG` na dnu), `scripts/env-sync-check.mjs`, GitHub Actions (`.github/workflows/ci.yml`: install → lint → typecheck → unit → integration → build → env-sync-check).
10. `REDIS_ACL.md` + `infra/redis/users.acl.example`.
11. Prisma: inicijalni `schema.prisma` s `User`/`Role`/`Permission` + migracija, `prisma migrate dev` flow, `migrate` servis u compose-u (`depends_on` postgres healthcheck).

**Isporuke:** gore navedeni fajlovi, CI zelen, `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` diže API+web+postgres+redis lokalno.

**DoD / prihvatanje**
- `pnpm -w lint && pnpm -w typecheck && pnpm -w test && pnpm -w build` prolazi.
- `GET /api/v1/health/live` → 200; `/health/ready` → 200 tek kad su DB i Redis dostupni.
- `node scripts/env-sync-check.mjs` → 0 razlika između compose i `.env.example`.
- Swagger dostupan na `/api/v1/docs` (samo u dev/staging, u produkciji iza `SWAGGER_ENABLED=false`).
- Kontejneri restart-ovani → podaci u `vfm_pgdata`/host volume ostaju.
- Kriterij prihvatanja **P15** (podaci nakon restarta) djelimično pokriven ovdje, finalno u Fazi 8.

---

### FAZA 1 — Identitet: auth, RBAC, korisnici, audit, zabrana mobilnog pristupa (≈ 5–7 dana)

**Cilj:** Sigurna prijava, DB-driven prava koja se trenutno oduzimaju, Super Admin portal, audit trag.

**Zadaci**
1. Prisma modeli: `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `UserIdentity`, `RefreshSession`, `AuthAttempt`, `AuditLog`, `Setting`.
2. Auth: `POST /auth/login` (email + lozinka, argon2id), `POST /auth/refresh` (rotacija + reuse detection → ukida sve sesije korisnika), `POST /auth/logout`, `GET /auth/me` (profil + dozvole + `permissionsVersion`). **2FA se ne implementira (R-05)** — kompenzacijske kontrole: politika lozinke, lockout, rate limit, reuse detection, audit.
3. **Client type enforcement:** login prima `clientType: WEB | MOBILE_ANDROID | MOBILE_IOS`. Ako je korisnik Super Admin (ili rola ima `allowedClientTypes` bez mobile) → `403 MOBILE_ACCESS_FORBIDDEN`, upisan `SECURITY_EVENT` u audit. Provjera se ponavlja na **svakom** zahtjevu preko guard-a (ne samo pri loginu), jer stari token ne smije zaobići pravilo.
4. RBAC: `PermissionsGuard` + `@RequirePermissions('vehicle:create')` dekorator; scope evaluator (`ALL` / `OWN` / `VEHICLE_IDS` / `DRIVER_IDS`); permisije se učitavaju iz Redis keša `vfm:perm:{userId}` (TTL 60 s) + invalidacija bump-om `permissionsVersion` (globalni i po roli u `vfm:permver:*`).
5. Revokacija: promjena role/permisije → bump verzije → sljedeći zahtjev (≤ 5 s) odbija staru permisiju. Test **P3**.
6. Zaštita posljednjeg Super Admina: DB trigger + servisna provjera (ne može se deaktivirati/obrisati/ukloniti mu `SUPER_ADMIN` rola ako je zadnji aktivan).
7. Users modul: CRUD, deaktivacija, reset lozinke (jednokratni token, istek 30 min), prisilno odjavljivanje svih sesija, dodjeljivanje rola (auditovano).
8. Roles modul: CRUD rola, matrica permisija (bulk update u transakciji), `permissionsVersion` bump, audit diff.
9. Audit: `AuditInterceptor` (before/after diff, `requestId`, IP, UA, `clientType`), `SECURITY` događaji (login, neuspjeli login, lockout, promjena prava, izvoz podataka, pristup prilogu).
10. Rate limiting: `@nestjs/throttler` na Redis (`vfm:rl:*`) — login 5/15 min po IP+email, global 300/min po useru, upload 30/min.
11. Web: login, layout (sidebar/topbar/breadcrumbs), Dashboard placeholder, `Korisnici`, `Role i prava` (matrica editor), `Audit log`, `Postavke` (osnovno), route guard-ovi + `usePermission()` hook.
12. Bootstrap: `scripts/bootstrap-super-admin.mjs` (čita email iz env, generiše slučajnu lozinku, ispisuje je **jednom** na stdout, traži promjenu pri prvom loginu) — bez fiksnih lozinki u repo-u.
13. Seed (dev/demo): 3 role, demo korisnici s generisanim lozinkama, šifarnici.

**Isporuke:** API moduli auth/users/roles/audit/settings; web Super Admin portal (korisnici, matrica prava, audit); `docs/05-RBAC_PERMISIJE_SIGURNOST.md` implementiran u kodu.

**DoD / prihvatanje (kriteriji P1, P2, P3, P14)**
- P1: Super Admin se loguje na web; mobilni login → `403 MOBILE_ACCESS_FORBIDDEN`; direktni API poziv s mobilnim tokenom Super Admina → `403`.
- P2: Super Admin kreira rolu, dodijeli/oduzme pravo po modulu i akciji; matrica se sačuva i audituje.
- P3: Nakon oduzimanja `vehicle:create`, postojeći access token istog korisnika odmah (≤ 5 s) vraća `403 PERMISSION_DENIED` — bez ponovnog logina.
- P14: Korisnik bez prava ne dobija podatke ni preko direktne URL-adrese (npr. `/api/v1/users` bez `user:view` → 403).
- Unit + integration testovi: ≥ 80 % coverage na `auth`, `roles`, `guards`.
- `.env.example` dopunjen: `JWT_*`, `COOKIE_*`, `THROTTLE_*`, `BOOTSTRAP_*`.

---

### FAZA 2 — Form engine i Form Builder (≈ 7–10 dana)

**Cilj:** Verzionisane, validirane, sigurne dinamičke forme koje renderuju i web i mobilna aplikacija.

**Zadaci**
1. `packages/form-engine`: JSON shema definicije (`FormDefinition`), Zod meta-shema, whitelist tipova polja (17 tipova iz `04-FORM_ENGINE.md`), pravila (required/min/max/pattern/precision/step), uslovna vidljivost (`when`), sekcije/grupe, `reservedKeys` zaštita.
2. **Sigurni izrazi:** parser + AST evaluator (bez `eval`, bez `Function`, bez JS-a), operatori `+ - * / % ( )`, usporedbe, logika, funkcije (`round`, `sum`, `min`, `max`, `daysBetween`, `year`, `month`, `if`, `coalesce`), dubina/dužina limitirana, deterministički i timeout-ovan.
3. Modeli: `FormSchema`, `FormSchemaVersion` (immutabilna, `contentHash`, `status`, `changeNote`), `FieldKeyRegistry`, `FormMigrationJob`, `FormMigrationItem`.
4. Workflow: `DRAFT → PUBLISHED → RETIRED`; publish uz obaveznu bilješku i provjere (validna shema, jedinstveni ključevi, kompatibilnost s postojećim zapisima, rezervisani ključevi, mobilna podrška tipova); objavljeni `definition` se **ne** može mijenjati (DB trigger + aplikacijska provjera).
5. Record binding: svaki zapis čuva `formSchemaId`, `formSchemaVersionId`, `formData` (JSONB) + normalizovane kolone (`normalizedName` mapirana na kolone tabele).
6. Validacija na serveru: pri create/update backend ponovo validira vrijednosti **prema tačnoj verziji** forme; nepoznat ključ, pogrešan tip, izostavljen obavezan → `422 FORM_VALIDATION_FAILED` s listom grešaka po polju. Test **P11**.
7. Migracija historijskog zapisa: eksplicitan job (preview → validacija → primjena → zapis rezultata → rollback snapshot). Test **P12**. Nikad automatski.
8. API: `GET /form-schemas`, `POST /form-schemas`, `POST /form-schemas/:id/versions`, `PUT .../versions/:vid` (draft), `POST .../versions/:vid/validate`, `POST .../versions/:vid/preview`, `POST .../versions/:vid/publish`, `POST .../versions/:vid/retire`, `GET /form-schemas/active?subject=...`.
9. `packages/form-renderer`: **jedan** paket, dva adaptera (`web` na shadcn/ui, `mobile` na RN komponente); podrška za sve tipove polja, greške, uslovnu vidljivost, izračune (klijentski preview + server autoritet), upload polja.
10. Web Form Builder: lista formi, editor (drag&drop redoslijed, sekcije), panel svojstava polja, preview (web + mobilni okvir), validator panel, diff između verzija, publish modal s bilješkom, historija verzija.
11. Seed forma: `vehicle.core`, `registration.core`, `insurance.core`, `service.core`, `tireset.core`, `tire.installation`, `task.WASH` itd.

**DoD / prihvatanje (P9, P10, P11, P12)**
- P9: Napravljena, validirana, preview-ovana i objavljena nova verzija forme bez izmjene koda; objava bez bilješke → `422`.
- P10: Stari zapis i dalje otvara originalnu verziju (uklj. polja koja više ne postoje u novoj).
- P11: Backend odbija payload koji ne odgovara shemi te verzije (tip, obavezno, nepoznat ključ, izračun).
- P12: Migracija historijskog zapisa je eksplicitna, auditovana, s preview-om i mogućnošću povrata.
- Nijedan put u kodu ne izvršava proizvoljan JS iz `definition` (test + code review checklist).
- Renderer isti rezultat daje na web i mobilnom snapshot testu (Zod fixture set).

---

### FAZA 3 — Vozila, vozači, registracije, osiguranje (≈ 6–8 dana)

**Zadaci**
1. Modeli: `Vehicle`, `OdometerReading`, `Driver`, `DriverLicenseCategory`, `RegistrationRecord`, `InsuranceRecord`, `Reminder`, `ReminderPolicy`, `List`/`ListItem` (šifarnici).
2. Vozila: CRUD + arhiviranje (arhiva ne briše povezane evidencije), jedinstvenost `internalNo` i `VIN` (partial unique gdje je `deletedAt IS NULL`), status mašina (`ACTIVE/IN_SERVICE/INACTIVE/DAMAGED/ARCHIVED`), profil vozila s tabovima (Osnovno, Registracije, Osiguranje, Servisi, Gume, Zadaci, Kilometraža, Prilozi, Historija).
3. Kilometraža: `OdometerReading` s `source` (`MANUAL/TASK/SERVICE/REGISTRATION/INSURANCE/SYSTEM`), pravilo monotoniciteta (novija vrijednost < maksimalne → `422` uz eksplicitan `correctionReason` + audit), vozilo ima denormalizovan `odometerKm` + `odometerUpdatedAt` (ažurira se u istoj transakciji).
4. Vozači: profil bez obaveznog naloga; veza `UserIdentity` (nalog ↔ vozač); kategorije dozvole s istekom; pristup ličnim podacima ograničen permisijom `driver:view_pii`.
5. Registracije/osiguranje: historija perioda, **exclusion constraint** protiv preklapanja perioda po vozilu, normalizovani `validFrom/validUntil` i denormalizovani `Vehicle.registrationExpiresAt` / `insuranceExpiresAt` (sync trigger ili servis u transakciji).
6. Podsjetnici: `ReminderPolicy` (konfigurabilni dani, default 5; po vrsti i po korisniku), `ScheduledReminder` s `dedupeKey` (unique) → idempotentnost po (zapis, vrsta, rok); worker skenira u 06:00 `Europe/Sarajevo`; primaoce određuje konfiguracija prava/postavki.
7. Prilozi: `Attachment`/`FileAttachment` + host bind-mount, magic-byte provjera, max veličina, SHA-256, signed URL (HMAC + istek), pristup samo uz permisiju i audit pristupa.
8. Web: liste (filteri, sort, pagination, bulk akcije), detalji, forme kroz `form-renderer`, "rokovi" dashboard widget (zeleno/žuto/narandžasto/crveno), upozorenja.
9. Seed: **10 izmišljenih vozila**, registracije/osiguranja (uklj. jednu isteklu i jednu koja ističe za 3 dana), 5 vozača.

**DoD / prihvatanje (P13, P14, dio P10/P11)**
- P13: Registracije/osiguranja imaju tačnu historiju; podsjetnik se generiše tačno jednom po roku (dokaz: dupli run skenera → 0 novih redova).
- Preklapajući period registracije → `409 PERIOD_OVERLAP`.
- Pad kilometraže bez korekcije → `422`; s korekcijom → auditovan zapis.
- Prilog bez permisije → `403`, s permisijom → auditovan pristup; eksterne URL-adrese nisu javne.
- Svaki zapis čuva `formSchemaVersionId`.

---

### FAZA 4 — Servisi i gume (≈ 5–7 dana)

**Zadaci**
1. `ServiceRecord` + `ServiceItem` (dijelovi/rad, količina, cijena), radionica, trošak u feninzima, `nextServiceDueDate`/`nextServiceDueKm` (barem jedno obavezno ako je politika uključena), prilozi (račun).
2. Podsjetnici za servis (datum i/ili kilometraža): kilometražni podsjetnik koristi `OdometerReading` + `reminderThresholdKm`.
3. Gume: `TireSet` (komplet) + `Tire` (pojedinačna, pozicija FL/FR/RL/RR), `TireInstallation` (montaža/demontaža, km pri oba događaja, razlog, pozicije).
4. **Pravilo:** isti set/guma ne može biti istovremeno montirana na više vozila → partial unique index + transakcijska provjera + `409 TIRE_ALREADY_MOUNTED`.
5. Ciklus: `daysInUse`, `kmDriven` (računa se pri demontaži i snapshot-uje), historija ponovljenih montaža, lokacija/skladište, stanje (profilaža, oštećenja) — kroz formu + normalizovane kolone.
6. Zamjena guma kao operacija u jednom pozivu: `POST /tires/installations/swap` (demontaža seta A + montaža seta B u jednoj transakciji, uz oba `odometerKm`).
7. Web: servisna historija po vozilu (timeline), tabela guma s filterom sezona/status, wizard montaže, izvještaj iskorištenosti.
8. Seed: 3 seta guma (ljetne/zimske), 2 ciklusa montaže, 4 servisa.

**DoD / prihvatanje (P13)**
- Dva paralelna zahtjeva za montažu istog seta na dva vozila → tačno jedan uspije.
- `kmDriven` i `daysInUse` tačni i zaokruženi po definisanom pravilu (testovi).
- Svaki servis i svaka instalacija čuva verziju forme.

---

### FAZA 5 — Zadaci, atomsko preuzimanje, outbox, FCM (≈ 8–10 dana)

**Najkritičnija faza — tok iz §19 projektnog zadatka.**

**Zadaci**
1. `TaskType` (kod, naziv, ikona, `requiresVehicle`, `defaultPriority`, `defaultAssignMode`, `allowMultipleClaimants`, forma), CRUD + seed 8 početnih vrsta (pranje, unutrašnje čišćenje, gorivo, servis, zamjena guma, tehnički pregled, registracija, proizvoljni tip).
2. `Task` + `TaskAssignment` + `TaskEvent` (immutabilan) + sistemsko stanje: status mašina `OPEN → IN_PROGRESS → COMPLETED`, `CANCELLED`, `REOPENED→OPEN`, `RELEASED→OPEN`; dinamička forma **ne može** prepisati `id`, `status`, `assigneeUserId`, serverska vremena.
3. **Atomsko preuzimanje** — ručni SQL u transakciji (Prisma `$executeRaw`):
   ```sql
   UPDATE "Task" SET "status"='IN_PROGRESS', "claimedAt"=now(), "version"="version"+1
   WHERE "id"=$1 AND "status"='OPEN' AND "deletedAt" IS NULL
   RETURNING "id","version";
   ```
   `RETURNING` prazan → `409 TASK_ALREADY_CLAIMED` + (ako korisnik ima pravo) ime izvršioca. Dodatno: unique partial index `("taskId") WHERE "role"='ASSIGNEE'` u `TaskAssignment` kao drugi pojas zaštite; `SELECT ... FOR UPDATE` varijanta za assign-mode tokove. Idempotency-Key header + `IdempotencyKey` tabela → retry ne duplira.
4. Završetak: samo izvršilac, ili korisnik s `task:complete_override` (eksplicitno dodijeljeno, auditovano); bilježi `completedAt`, `durationMinutes`, obavezna forma + prilozi prema `TaskTypeCompletionRequirement`.
5. Otkazivanje / ponovno otvaranje / vraćanje među slobodne (`task:cancel`, `task:reopen`, `task:release`) → svaki stvara `TaskEvent` + audit + obavijest.
6. Dodjela: `ASSIGN_DIRECT` (pozvani korisnici jasno prikazani i auditovani), `OPEN_CLAIM` (svi pozvani vide slobodan zadatak), `BROADCAST`.
7. **Transactional outbox:** u istoj transakciji kao i promjena zadatka piše se `OutboxEvent`; BullMQ worker (`vfm-queue-outbox`) ga konzumira → kreira `Notification` redove (unique `notification_key`) → FCM push s retry/backoff (5 pokušaja) → `FAILED`/`DEAD` nakon iscrpljenih pokušaja; nevažeći tokeni se označavaju `INVALID` i brišu. Greška push-a **ne** utiče na zadatak (test P8).
8. FCM: Firebase Admin SDK samo u worker/API kontejneru (`FIREBASE_SERVICE_ACCOUNT_PATH` = file mount); `DeviceToken` s unique `(userId, tokenHash)`; `vfm:lock:fcm:*` za serijalizaciju slanja po korisniku.
9. Notifications API: lista, `POST /notifications/:id/read`, `read-all`, unread count i SSE (`GET /notifications/stream`). Trenutni SSE MVP koristi PostgreSQL polling svakih 5 s s `Last-Event-ID`; Redis pub/sub fan-out i Redis unread-count cache (`vfm:cache:unread:{userId}`) ostaju optimizacija koja nije uvedena. WebSocket nije potreban u MVP-u.
10. Web: kanban/lista zadataka, wizard "Novi zadatak" (korak po korak), detalji s timeline-om, akcije po permisijama, in-app zvono.
11. Postavke obavijesti: Super Admin uključuje/isključuje vrste događaja i primaoce (`NotificationPreference`).

**DoD / prihvatanje (P4, P5, P6, P7, P8)**
- P6: **Stress test** — 200 paralelnih `claim` poziva (k6/jest + `Promise.all` nad pravom bazom) → tačno jedan `IN_PROGRESS`, ostali `409`; `TaskEvent` ima jedan `CLAIMED`.
- P7: Korisnik koji nije izvršilac ne može završiti zadatak (`403`), osim s eksplicitnim override pravom (auditovan).
- P8: Simuliran FCM 500/timeout → zadatak ostaje `IN_PROGRESS`, outbox retry, **bez duplih** `Notification` redova.
- P5: Oba obična korisnika vide isti slobodan zadatak i dobijaju obavijest; nakon preuzimanja drugi vidi "Zadatak je preuzeo X".
- Idempotency: isti `Idempotency-Key` 2× → jedan zapis.
- `.env.example` dopunjen: `FIREBASE_*`, `NOTIFICATIONS_*`, `OUTBOX_*`, `QUEUE_*`; `REDIS_ACL.md` osvježen (queue ključevi `vfm:queue:*`).

---

### FAZA 6 — Expo Android aplikacija (≈ 6–8 dana)

> **UX/UI ulazni kriterij za veći web/mobilni redizajn:** prije implementacije vizuelnog redizajna završiti audit referentnog ZIP-a i isporuke iz [`06-UX_UI_DIZAJN.md` §0](06-UX_UI_DIZAJN.md#0-referentni-projekat-i-metod-redizajna). ZIP je referenca za selektivno preuzimanje/prilagodbu, ne zahtjev za replatformiranje ili potpunu repliku. Ovo ne mijenja funkcionalni redoslijed faza niti pokreće redizajn unaprijed.

**Zadaci**
1. Login (bez Super Admina — server odbija, ali i UI daje jasnu poruku), refresh token u `expo-secure-store`, biometrijski/PIN lock (opcija).
2. Navigacija: tabovi **Zadaci / Vozila / Obavijesti / Profil**; dubinski linkovi (`vfm://tasks/:id`).
3. Zadaci: lista (Slobodni / Moji / Završeni / Svi), pull-to-refresh, beskonačni scroll, detalji, **Preuzmi** (optimistic UI + `409` handling s porukom "Zadatak je preuzeo {ime}"), **Završi** (dinamička forma + kamera/galerija upload), komentari.
4. Dinamičke forme: `packages/form-renderer` mobile adapter; keš sheme po verziji (`GET /form-schemas/:id/versions/:vid` → ETag); pri submitu backend ponovo validira; razumljiva greška po polju, bez tihe reinterpretacije.
5. Vozila: lista + profil (read-only prema pravima), registracija/osiguranje/servis historija, prilozi.
6. Obavijesti: in-app centar + FCM (data + notification poruke), badge, tap → deep link; registracija `DeviceToken` pri loginu, deregistracija pri logoutu.
7. Offline-tolerancija (bez punog offline unosa): keš posljednjeg odgovora, jasan indikator "Nema veze", queue **samo** za upload fotografija s retry-jem.
8. UX za teren: veliki touch targeti (≥ 48 px), tamna tema, `expo-camera` s kompresijom prije uploada, progress i greške.
9. Build: `eas.json` (dev/preview APK/production AAB), verzionisanje, potpisivanje, dokumentovan reproducibilan proces, `google-services.json` samo u build-u (nikad service account).
10. Testovi: detox-free — jest unit + Maestro E2E tokovi (login → preuzmi → završi).

**DoD / prihvatanje (P1, P4, P5, P6, P7)**
- P1: Super Admin → mobilni login odbijen server-side (`403`), UI prikazuje poruku.
- P4: Administrator kreira zadatak u mobilnoj aplikaciji kada ima pravo; bez prava → dugme ne postoji **i** API vraća `403`.
- P6 na mobilu: dva uređaja istovremeno "Preuzmi" → jedan uspijeva, drugi dobija jasnu poruku.
- APK instaliran na fizičkom/emuliranom uređaju, FCM push primljen, fotografija završila na host volume-u.

---

### FAZA 7 — Izvještaji i izvoz (≈ 4–6 dana)

**Zadaci**
1. SQL view-ovi: `vfm_vehicle_costs`, `vfm_task_stats`, `vfm_user_activity`, `vfm_deadlines`, `vfm_tire_usage` — računaju se iz **normalizovanih** kolona, ne iz JSONB-a.
2. Izvještaji po vozilu (registracije, osiguranje, servisi, troškovi, historija guma, pranja, svi zadaci), po korisniku (preuzeti/završeni, broj pranja, aktivni, historija), opći (troškovi po periodu/kategoriji, zadaci po statusu, rokovi, aktivnost).
3. Filteri (period, vozilo, korisnik, tip, status, izvor) + sačuvane definicije (`ReportDefinition`, pristup samo uz `report:view`).
4. Izvoz **PDF** (`pdfmake`) i **Excel** (`exceljs`) preko BullMQ joba (`vfm-queue-reports`) → fajl na host volume → signed URL → `Attachment`; `audit` bilježi svaki izvoz (ko, šta, kada, filteri).
5. Dashboard: KPI kartice (aktivna vozila, istekli/uskoro rokovi, otvoreni zadaci, troškovi mjeseca), grafovi (troškovi po mjesecu, zadaci po tipu), rokovi lista.
6. Web: `Izvještaji` stranica s tabovima, export progress, download centar.

**DoD:** izvoz bez prava → `403`; iznad 10k redova export ide kroz job (ne blokira request); brojevi u izvještaju == brojevi u DB (property testovi); PDF/Excel otvoreni i čitljivi na bosanskom (š/č/ć/ž/đ + UTF-8).

---

### FAZA 8 — Hardening, backup/restore, security review, ops (≈ 4–6 dana)

**Zadaci**
1. Backup: `scripts/backup-db.sh` (`pg_dump -Fc` + rotacija + kopija na drugu lokaciju), backup host volume-a (prilozi), cron/systemd timer ili Coolify scheduled backup; **testiran restore** u čistom okruženju (P16) s zapisanim vremenom trajanja.
2. Sigurnosni review: OWASP ASVS L2 checklist, dependency audit (`pnpm audit`, `npm audit`, Trivy na image-ovima), secret scanning (gitleaks) u CI, CSP, cookie flagovi, helmet, CORS allowlist, redigovanje tajni iz logova, upload zaštita, SSRF provjera, SQL injection (samo parametrizirani upiti).
3. Operacije: healthchecks, log rotation (json-file max-size), restart policy, resource limiti, `worker` scale=1 (BullMQ leader), graceful shutdown (SIGTERM → drain), health `/ready` provjera DB+Redis+disk prostora za priloge.
4. Monitoring: `/metrics` (Prometheus format) + opciono Uptime Kuma / Coolify notifications; alerti: queue depth > 100, outbox `DEAD` > 0, disk > 85 %, failed login spike.
5. Nadogradnja i rollback: dokumentovani postupak (build image tag → deploy → `prisma migrate deploy` → smoke testovi → rollback plan s prethodnim image tagom i DB backup-om), backward-compatible migracije (expand/contract).
6. Runbook: česti incidenti (Redis down, DB down, FCM greške, disk pun, migration failed) + koraci.
7. Finalno: svi testovi P1–P16 prolaze u staging okruženju koje je **identično** produkciji.

**DoD (P15 + security gate; P16 odgođen)**
- P15: `docker compose down && up` → podaci i prilozi netaknuti (uklj. Coolify redeploy).
- ~~P16~~: **odgođeno (R-10)** — dokumentovano, ne implementira se sada.
- 0 kritičnih/visokih nalaza dependency i secret skena; svi srednji imaju plan.
- Load test: 50 korisnika, 200 zadataka/min, p95 < 400 ms, 0 grešaka 5xx.

---

### FAZA 9 — UAT, dokumentacija za vlasnika, go-live (≈ 2–3 dana)

**Zadaci**
1. UAT scenariji s vlasnikom (10 vozila, stvarni korisnici), zapisnik o nalazima, trijaža.
2. Korisnička dokumentacija: `docs/KORISNICKO_UPUTSTVO.md` (web + mobilna, po ulogama, sa screenshot-ovima), kratki video tokovi (opcionalno).
3. Admin dokumentacija: kako dodati vrstu zadatka, kako objaviti novu verziju forme, kako promijeniti prava, kako dodati korisnika.
4. Deploy na produkciju, DNS/HTTPS/TLS provjera, firewall, monitoring uključen, backup raspored aktivan.
5. Hiper-care period (5 radnih dana): dnevna provjera outbox-a, grešaka, performansa.
6. Retrospektiva i backlog za v2 (offline, telemetrija, iOS, integracije).

**DoD:** sistem u produkciji 5 dana bez kritičnog incidenta; svi P1–P16 potvrđeni na produkciji ili stagingu; vlasnik samostalno može dodati korisnika, promijeniti pravo i objaviti novu verziju forme.

---

## 6.x Pregled faza

| Faza | Naziv | Trajanje | Ključni kriteriji | Glavni rizik |
|---|---|---|---|---|
| 0 | Temelji / infra / CI | 2–3 d | build, health, env-sync | Coolify mreže (`db_net`/`redis_net`) |
| 1 | Auth + RBAC + audit | 5–7 d | P1, P2, P3, P14 | brza revokacija prava |
| 2 | Form engine + Builder | 7–10 d | P9–P12 | sigurnost izraza, mobile/web paritet |
| 3 | Vozila, vozači, reg., osig. | 6–8 d | P13, P14 | idempotentni podsjetnici |
| 4 | Servisi + gume | 5–7 d | P13 | istovremena montaža |
| 5 | Zadaci + outbox + FCM | 8–10 d | P4–P8 | atomski claim, push pouzdanost |
| 6 | Expo Android | 6–8 d | P1, P4–P7 | FCM tok, EAS build |
| 7 | Izvještaji + izvoz | 4–6 d | — | performanse exporta |
| 8 | Hardening + security (backup odgođen) | 3–5 d | P15 | sigurnosni nalazi |
| 9 | UAT + go-live | 2–3 d | svi | prihvat vlasnika |
| **Ukupno** | | **≈ 50–68 radnih dana** | | |

---

## 7. Mapiranje kriterija prihvatanja (§16 zadatka) na faze

| # | Kriterij | Faza | Test ID |
|---|---|---|---|
| P1 | Super Admin: web OK, mobilno NE | 1, 6 | `auth-superadmin-mobile-blocked.e2e` |
| P2 | Kreiranje rola i izmjena prava | 1 | `roles-matrix.integration` |
| P3 | Oduzeto pravo odmah blokira API | 1 | `rbac-revocation-latency.integration` |
| P4 | Admin kreira zadatak na mobilu | 5, 6 | `mobile-task-create.e2e` |
| P5 | Oba korisnika vide/dobiju slobodan zadatak | 5, 6 | `task-open-visibility.integration` |
| P6 | Paralelno preuzimanje → 1 izvršilac | 5, 6 | `task-claim-concurrency.stress` |
| P7 | Samo izvršilac/ovlaštena osoba završava | 5 | `task-complete-authorization.integration` |
| P8 | Push greška ne briše zadatak, retry bez duplikata | 5 | `outbox-fcm-failure.integration` |
| P9 | Forma: kreirati, validirati, preview, objaviti | 2 | `form-publish-workflow.e2e` |
| P10 | Stari zapisi vezani za originalnu verziju | 2, 3 | `form-version-binding.integration` |
| P11 | Backend odbija vrijednosti van sheme | 2 | `form-validation-rejection.unit+integration` |
| P12 | Migracija historijskog zapisa eksplicitna i auditovana | 2 | `form-migration-job.integration` |
| P13 | Registracije/servisi/gume: historija + podsjetnici | 3, 4 | `reminders-idempotency.integration` |
| P14 | Bez prava nema pristupa endpointima/dokumentima | 1, 3 | `authorization-sweep.e2e` |
| P15 | Compose čuva podatke nakon restarta | 0, 8 | `persistence-restart.ops` |
| ~~P16~~ | Backup se uspješno vraća | **odgođeno (R-10)** | `backup-restore.ops` (backlog) |

---

## 8. Rizici i mitigacije

| Rizik | Uticaj | Vjerovatnoća | Mitigacija |
|---|---|---|---|
| Coolify: kontejner na 2 mreže → Traefik bira pogrešnu → 504/hang | Visok | Srednja | `web` **nije** na `db_net`/`redis_net`; samo `api`/`worker`/`migrate`. Alternativa: `web` kao zaseban Coolify resurs (Dockerfile build pack). Dokumentovano u `08-DOCKER_COOLIFY_DEPLOYMENT.md` |
| DNS kolizija: hostname `postgres`/`redis` na dijeljenoj mreži riješi na tuđi kontejner | **Kritičan** | Srednja | `DATABASE_HOST`/`REDIS_HOST` = **tačan naziv globalnog kontejnera** očitano iz `docker network inspect db_net/redis_net`; nikad `localhost`; provjera konekcije prije prvog deploya |
| Redis ACL user nema komandu koju BullMQ treba → worker padne | Visok | Srednja | `+@all` uz restrikciju **ključeva** (`~vfm:*`) i `&*` kanala; dokumentovano i testirano u Fazi 0 |
| **Globalni Redis je dijeljen**: `user default off` ili `noeviction` promjena sruši druge aplikacije | **Kritičan** | Srednja | `REDIS_ACL.md` **varijanta B** (ne diramo `default`), backup `ACL LIST` prije izmjene, promjene `maxmemory-policy`/`appendonly` samo uz dogovor s adminom Redisa, izolacija kroz `~vfm:*` |
| **Globalni Postgres je dijeljen**: pool/migracije drugih aplikacija | Visok | Srednja | `DATABASE_CONNECTION_LIMIT=10`, migracije samo nad `vfm` bazom, backup/restore dogovoren s adminom baze, ekstenzije kreira DB admin ako `vfm` nema pravo |
| Race pri preuzimanju zadatka | **Kritičan** | Niska (uz dizajn) | Jedan `UPDATE ... WHERE status='OPEN' RETURNING` + unique partial index + idempotency key + stress test u CI |
| Push greška prekine poslovni tok | Visok | Visoka | Transactional outbox; push je **nuspojava**, nikad dio iste transakcije; retry + DLQ |
| Dupli podsjetnici | Srednji | Srednja | `ScheduledReminder.dedupeKey` unique; skener je idempotentan; test duplog runa |
| Form Builder postane "programski jezik" (feature creep, sigurnost) | Visok | Visoka | Zatvorena lista tipova polja; AST evaluator bez `eval`; eksplicitan scope u `04-FORM_ENGINE.md`; sve van liste = zahtjev za promjenu |
| Rast obima (offline, telemetrija, iOS) | Srednji | Visoka | §3.2 "Van obima" je ugovoren; promjene idu kroz backlog za v2 |
| Prilozi na host volume-u = rizik pri migraciji servera | Srednji | Srednja | Backup skripta uključuje volume; dokumentovan restore; `Attachment` red čuva relativni `storageKey` → portabilno na S3 kasnije |
| Prisma 7 nema sve constrainte (EXCLUSION/CHECK) | Srednji | Visoka | Ručni SQL u migracijama (`migrations/*/migration.sql`), `prisma migrate diff` kao pomoć, nikad `db push` u produkciji |
| Jedan server = single point of failure | Srednji | Srednja | Monitoring + runbook (`10-OPERACIJE.md`); dokumentovan manual failover |
| **Backup odgođen (R-10)** → gubitak podataka je nepovratan | **Kritičan** | Srednja | Vlasnik svjesno odgodio; procedura i skripte dokumentovani i spremni za aktivaciju u bilo kojem trenutku; preporuka da se uključi prije stvarnih podataka u produkciji |
| Dijeljeni globalni Postgres/Redis: tuđa aplikacija potroši resurse ili promijeni postavke | Visok | Srednja | Konzervativan pool (`DATABASE_CONNECTION_LIMIT=10`), ACL `~vfm:*`, dogovor o `noeviction`, monitoring `NOPERM`/`ECONN` grešaka |

---

## 9. Tok rada i izvještavanje po fazama

Na kraju svake faze agent isporučuje:

```
## Faza X — izvještaj
**Implementirano:** …
**Komande pokrenute:** pnpm -w lint / typecheck / test / build, docker compose up, migration
**Rezultati:** … (broj testova, coverage, trajanje)
**Izmjene koje vlasnik mora prenijeti u Coolify:**
  - .env.example → dodato/promijenjeno: VAR1, VAR2 (vrijednosti postaviti u Environment Variables)
  - REDIS_ACL.md → ⚠️ promijenjen ACL: dodan user `vfm-…` / novi pattern `~vfm:…` → ažurirati "Custom Redis configuration" i ponovno pokrenuti Redis / `ACL LOAD`
  - Compose → nove servise/volumene preuzeti kroz redeploy
**Preostali blokeri:** …
```

**Pravila koja se ne krše**
1. Ne tvrditi da je funkcionalnost gotova dok build i relevantni testovi ne prođu.
2. Nema stvarnih tajni u repozitoriju (`.env.example` sadrži samo placeholder-e i upute za generisanje).
3. Autorizacija je uvijek na backendu; UI samo sakriva.
4. Nema proizvoljnog JS-a u definiciji forme.
5. Objavljena verzija forme i audit zapis su immutabilni.
6. Dinamička polja nikad ne prepisuju sistemska polja (ID, status, izvršilac, serverska vremena).
7. `.env.example` i `REDIS_ACL.md` se ažuriraju **u istom commit-u** kao i promjena koja ih je izazvala.

---

## 10. Changelog plana

| Verzija | Datum | Izmjena |
|---|---|---|
| 1.0.0 | 19.10.2026. | Inicijalni master plan na osnovu projektnog zadatka v2.0 + 4 odluke vlasnika (pnpm+Turborepo, puni Redis/BullMQ stack, prilozi na host bind-mount, mobilna online-first) |
