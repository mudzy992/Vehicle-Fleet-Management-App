# Faza 0 — Izvještaj o temeljima

**Datum:** 19.10.2026. · **Grana:** `arena/0dd8429f-vehicle-fleet-management-app` · **Trajanje:** 1 radna sesija (planirano 2–3 dana)

> Ovaj dokument je dokaz da su ispunjeni **Definition of Done** kriteriji Faze 0 iz
> [`PLAN_IMPLEMENTACIJE.md`](./PLAN_IMPLEMENTACIJE.md) §4 i da su svi kvalitet-kapije
> iz [`09-TEST_PLAN.md`](./09-TEST_PLAN.md) §7 zeleni. Ujedno sadrži **blokere** i
> **obaveze vlasnika** koje treba riješiti prije Faze 1.

---

## 1. Rezime

| Stavka | Rezultat |
|---|---|
| Monorepo | pnpm 10.34.7 workspaces + Turborepo 2.11.9 ✅ |
| Paketi | `@vfm/shared`, `@vfm/config`, `@vfm/api`, `@vfm/web` ✅ · `apps/mobile` skeleton (Faza 6) |
| Kvalitet-kapije | `turbo lint typecheck test build` → **16/16 zadataka zeleno** ✅ |
| Testovi | **287** unit testova (shared 200, api 60, web 27) ✅ |
| ENV | `.env.example` **178** varijabli ⇄ šema **1:1**, `env-sync-check` exit 0, **0 upozorenja** ✅ |
| API | NestJS 12, health probe (`live`/`ready`/`startup`), envelope, error katalog, Redis (3 ACL uloge), BullMQ, graceful degradation ✅ |
| Web | Vite 8 + React 19 + Tailwind 4, sidebar po `docs/06` §5.5, dizajn-tokeni, health widget ✅ |
| Baza | `prisma/schema.prisma` — **45 modela, 30 enuma** + bootstrap SQL (ekstenzije, triggeri) ⚠️ **(vidi §5)** |
| Dokumentacija | 11 dokumenata + ovaj izvještaj, 0 pokvarenih linkova ✅ |

---

## 2. Šta je napravljeno

### 2.1 Monorepo i konfiguracija

```
package.json          pnpm 10.34.7, turbo 2.11.9, TS 5.9.3
pnpm-workspace.yaml   packages/* + apps/api + apps/web   (mobile namjerno izostavljen)
turbo.json            build/lint/typecheck/test + env allowlista
tsconfig.base.json    strict, ES2023, noUncheckedIndexedAccess
.npmrc                strict-peer-dependencies=false, save-exact=true
prettier + eslint     @vfm/config/eslint/base (flat config)
```

**Zašto `apps/mobile` nije u workspace-u:** Expo/React Native ≈ 1 GB dependencija i
zaseban build lanac (EAS); ne builda se u Dockeru niti u CI-u. Detalji:
[`apps/mobile/README.md`](../apps/mobile/README.md).

### 2.2 `packages/shared` — jedinstveni ugovor (200 testova)

| Modul | Sadržaj |
|---|---|
| `constants.ts` | prefiks `vfm`, `/api/v1`, domene R-03, TZ, valuta (feninzi), Redis namespace-ovi, ACL korisnici, limiti, `QUEUE_NAMES` |
| `enums.ts` | **30 enuma iz `docs/03` §2** + državne mašine zadatka (`TASK_TRANSITIONS`) i forme (`FORM_SCHEMA_TRANSITIONS`) + `requiredPermissionForTransition()` |
| `permissions.ts` | katalog **~120 permisija** (21 modul), `SENSITIVE_PERMISSIONS`, default matrica (docs/05 §4), R-07 (Super Admin = sve), N-05 (mobitel = ništa), scope rank `OWN < VEHICLE_IDS/DRIVER_IDS < ALL` |
| `errors.ts` | katalog kodova s `httpStatus`/`category`/`securityRelevant`/`messageBs`/`retryable` + envelope tipovi |
| `format.ts` | novac (feninzi→KM), datumi `dd.MM.yyyy HH:mm` u `Europe/Sarajevo`, `daysUntil`, `deadlineLevel` (>30 success · 8–30 info · 1–7 warning · ≤0 danger), trajanja, maskiranje e-maila/tablica |
| `status-labels.ts` | **bosanski nazivi za sve enum vrijednosti** + semantika boja + **domeni** (`statusLabel(v,'record')`) |
| `env-schema.ts` | **zod šema za sve 178 varijabli** iz `.env.example` (zaseban ulaz `@vfm/shared/env`) |

> `@vfm/shared/env` je namjerno **odvojen ulaz**: `zod` ne smije u browser bundle.
> Rezultat: web `index` chunk je pao s **579 kB → 86 kB**.

### 2.3 `apps/api` — NestJS 12 (60 testova)

| Komponenta | Detalj |
|---|---|
| `main.ts` | fail-fast ENV validacija, trust proxy (`TRUST_PROXY=loopback`), CORS allowlista, helmet-lite, globalni prefiks `/api/v1` **bez** health ruta, graceful shutdown |
| `common/` | `RequestIdMiddleware` (sanitizacija → zaštita od log injection), `AllExceptionsFilter` (katalog kodova, Zod→422, 500 bez otkrivanja detalja), `ApiEnvelopeInterceptor` (`{data, meta}`, izuzeci za health/binarno) |
| `infra/redis` | **3 ACL konekcije** (`vfm-api`, `vfm-worker`, `vfm-readonly`), lazyConnect, graceful degradation, `DistributedLockService` (Lua unlock/extend), `IdempotencyService` (hash payloada, replay/conflict) |
| `infra/queue` | BullMQ redovi iz ENV-a, `OutboxService` (publish-or-buffer, `reminderKey()`), retry/backoff politika iz ENV-a |
| `infra/database` | `DatabaseAvailabilityService` — TCP provjera + jasna poruka o `db_net`; **Prisma nije povezana** (vidi §5) |
| `health` | `/health/live` (bez zavisnosti), `/health/ready` (Redis kritičan, DB `degraded` u Fazi 0, disk), `/health/startup`, `/health/diagnostics` |
| `tools/` | `worker.ts` (heartbeat `vfm:metrics:worker:heartbeat`, graceful drain), `migrate.ts` (Redis lock `vfm:lock:migrate`, čeka Postgres, jasan ispis ako Prisma nedostaje), `healthcheck-worker.ts` |

**Politika health probe-ova:** `live` nikad ne provjerava zavisnosti (inače Coolify
restartuje kontejner pri svakom mrežnom treptaju); `degraded` ne ruši readiness, `down` ruši.

### 2.4 `apps/web` — Vite 8 + React 19 + Tailwind 4 (27 testova)

- **Sidebar** po `docs/06` §5.5 (4 grupe, sve stavke nose fazu), filtrira se prema
  pravima iz `/auth/me` (R-07: Super Admin vidi sve), mobilni drawer.
- **Dizajn sistem** (`/dizajn-sistem`): tokeni (svjetla/tamna tema), tipografija,
  dugmad, badge-ovi (nazivi iz `@vfm/shared`), rokovi, formati novca/datuma.
- **Zdravlje sistema** (`/zdravlje`): živi poziv na probe API-ja + sirovi odgovor.
- **Nema CORS-a u browseru:** svi zahtjevi su relativni (`/api`, `/health`), Vite
  proxy u dev-u, nginx u produkciji.
- 16 ekrana je postavljeno kao kostur s nazivom, oznakom (W05…) i fazom.

### 2.5 Baza — `prisma/schema.prisma`

- **45 modela / 30 enuma** prenesenih iz `docs/03` (identitet, vozila, gume,
  forme, zadaci, outbox, obavijesti, podsjetnici, prilozi, audit, izvještaji).
- Svako mjesto koje Prisma ne može izraziti označeno je `// SQL:` i pokriveno
  `prisma/sql/0000_bootstrap_extensions.sql` (ekstenzije, `vfm_guard_last_super_admin`,
  immutabilnost audit/historije/objavljene forme) + planom u `prisma/README.md`.

---

## 3. Dokazi (komande i rezultati)

```bash
$ corepack enable pnpm && pnpm install
Done in 11s using pnpm v10.34.7

$ pnpm turbo lint typecheck test build
 Tasks:    16 successful, 16 total

$ pnpm --filter @vfm/shared test
 Test Files  7 passed (7)
      Tests  200 passed (200)

$ pnpm --filter @vfm/api test
 Test Files  5 passed (5)
      Tests  60 passed (60)

$ pnpm --filter @vfm/web test
 Test Files  2 passed (2)
      Tests  27 passed (27)

$ pnpm --filter @vfm/web build
 dist/assets/index-*.js   86.39 kB   (prije razdvajanja shared/env: 579 kB)
 dist/assets/react-*.js  210.54 kB
 ✓ built in 290ms

$ node scripts/env-sync-check.mjs
 .env.example : 178 varijabli
 Compose reference: 152 varijabli
 ✅ OK — .env.example je sinhronizovan (upozorenja: 0)
```

### Smoke test API-ja (stvarni boot, bez baze i Redis-a)

Cilj: dokazati da se API **podiže** i da probe vraćaju smislene odgovore čak i kad
zavisnosti nisu dostupne (Coolify ne smije upasti u restart petlju).

```bash
$ ENV_PROFILE=api NODE_ENV=production APP_ENV=staging \
  DATABASE_URL=postgresql://vfm:***@127.0.0.1:5432/vfm?schema=public \
  REDIS_HOST=127.0.0.1 REDIS_PORT=6399 … node apps/api/dist/main.js

$ curl -s http://127.0.0.1:3999/health/live
{"status":"ok","uptimeSeconds":9,"at":"2026-10-19T13:42:59.276Z"}

$ curl -s http://127.0.0.1:3999/health/startup
{"status":"ok","startedAt":"2026-10-19T13:42:50.806Z","uptimeSeconds":8,
 "env":{"node":"production","app":"staging","profile":"api"}}

$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3999/health/ready
503        # očekivano: Redis nije dostupan (kritičan), DB je "degraded"

$ curl -s -H 'X-Request-Id: trace-obi-123' http://127.0.0.1:3999/api/v1/nema
{"error":{"code":"NOT_FOUND","message":"Cannot GET /api/v1/nema",
          "requestId":"trace-obi-123"}}
```

**Šta ovo dokazuje:**

1. **Fail-fast ENV** — bez obaveznih varijabli proces ne bi ni startao (§2.3).
2. **Graceful degradation** — Redis je nedostupan, a API radi i vraća 503 samo na
   `ready` (ne ruši `live`); nema restart petlje.
3. **Health detalji** — `/health/ready` vraća Terminus payload s tačnom
   zavisnošću koja je pala (`redis: down`, `database: degraded`, `storage: up`),
   a ne generički envelope. Docker/Coolify tako vidi **šta** je problem.
4. **Envelope + korelacija** — greške imaju kod iz kataloga i `requestId` koji je
   došao iz klijenta (Traefik ga prosljeđuje).

> Napomena: `ready` = 503 je **ispravno** ponašanje dok Redis nije dostupan;
> na Coolify hostu Redis postoji, pa je očekivano 200.

### Testovi koji čuvaju ugovore (najvažniji)

| Test | Šta čuva |
|---|---|
| `env-schema.spec.ts` → „sinhronizacija s .env.example“ | **svaka** varijabla iz `.env.example` postoji u šemi i obrnuto — deploy ne može pasti zbog nepoznate varijable |
| `permissions.spec.ts` | R-07 (Super Admin sve), N-05 (mobitel ništa), redoslijed granula, scope hijerarhija |
| `enums.spec.ts` | državne mašine zadatka i forme, nazivi redova `vfm-*` |
| `status-labels.spec.ts` | **svaka** enum vrijednost ima bosanski naziv (pada ako se doda novo stanje bez prijevoda) |
| `exceptions-filter.spec.ts` | envelope i kodovi grešaka; 500 ne otkriva SQL/stack |
| `health.spec.ts` | `live` bez zavisnosti, `degraded` ≠ `down`, ACL greška upućuje na `REDIS_ACL.md` |
| `badge.test.tsx` / `nav.test.ts` | UI koristi `@vfm/shared` (nema lokalnih prijevoda), permisije u navigaciji postoje u katalogu |

---

## 4. Odstupanja od plana (i zašto)

| Odstupanje | Razlog |
|---|---|
| `apps/api` **nema** `prisma`/`@prisma/client` u `package.json` | `binaries.prisma.sh` nije dostupan u okruženju (vidi §5). Deps se dodaju jednom komandom na mašini s internetom. |
| Health indikator baze vraća `degraded` umjesto `down` | Prisma client još nije generisan; `down` bi blokirao deploy ispravne aplikacije. Od Faze 1 → `down`. |
| `apps/api` testovi uvoze iz `src/` (ne `dist/`) | TypeScript bi inače tražio `.d.ts` iz build-a; testira se isti kod, ali bez build koraka u petlji. |
| Nema `2FA` | Odluka vlasnika **R-05** — uklonjeno iz svih dokumenata i šeme. |
| Nema backup skripti | Odluka vlasnika **R-10** — odgođeno; dokumentacija zadržana. |
| `SWAGGER_ENABLED` postoji, ali Swagger modul nije instaliran | Faza 1; u produkciji je ionako `false` (`validateEnvProfile` to provjerava). |
| Nema `ValidationPipe` u `main.ts` | Zahtijeva `class-validator`/`class-transformer`, a plan je **Zod** validacija (Faza 1). Zod šeme (`paginationQuerySchema`, `plateSchema`, …) su već u `@vfm/shared`. |
| `consistent-type-imports` isključen u `apps/api` | Nest `emitDecoratorMetadata`: `import type` u konstruktoru ruši DI („argument Function at index [0]“). Pravilo ostaje aktivno u shared/web. |

---

## 5. Blokeri i obaveze vlasnika

### 5.1 🔴 Prisma engine (blokira Fazu 1)

`prisma generate` preuzima binarne fajlove s `https://binaries.prisma.sh`; u
okruženju u kojem je kod nastao taj host nije dostupan, a npm ne distribuira
engine. **Schema je kompletna i spremna** — aktivacija traje ~5 minuta na mašini
s internetom (Coolify build, GitHub Actions ili lokalna mašina):

```bash
pnpm --filter @vfm/api add prisma@7.10.1 @prisma/client@7.10.1
pnpm prisma:generate
pnpm --filter @vfm/api exec prisma migrate dev --name init --schema prisma/schema.prisma
pnpm --filter @vfm/api build:full
```

Detalji i lista ručnih SQL dijelova: [`apps/api/prisma/README.md`](../apps/api/prisma/README.md).

### 5.2 🟠 Postgres ekstenzije (Coolify, jednom)

Prije prvog deploya na globalnu bazu:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- za EXCLUDE (B-10)
```

Ako korisnik `vfm` nema pravo `CREATE EXTENSION`, izvršiti kao DBA
(vidi `.env.example` §5 i `prisma/sql/0000_bootstrap_extensions.sql`).

### 5.3 🟠 Redis ACL (Coolify, jednom + pri svakoj promjeni)

Tri korisnika postoje u `.env.example` §6 (`REDIS_USER_API`, `REDIS_USER_WORKER`,
`REDIS_USER_READONLY` + lozinke) i u [`REDIS_ACL.md`](../REDIS_ACL.md).
**Obaveza:** ACL fajl na globalnom Redisu mora sadržavati iste korisnike, a
nakon svake izmjene pokrenuti `ACL LOAD` **i** `ACL SAVE`.

> ⚠️ Ako se promijeni bilo koji Redis ključ/namespace/red u kodu, **obavezno**
> ažurirati `REDIS_ACL.md` §4 i ACL na Redisu. Trenutni opseg: `~vfm:*` + `&*`.

### 5.4 🟡 Coolify varijable

`.env.example` je izvor istine (178 varijabli). U Coolify unijeti najmanje:
`DATABASE_URL`, `REDIS_HOST`, tri para Redis kredencijala, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `FILE_SIGNING_SECRET`, `VFM_STORAGE_PATH`, `CORS_ORIGINS`.
Obavezne varijable su označene `:?` u `docker-compose.yml` — Coolify neće
dozvoliti deploy dok su prazne.

---

## 6. Sinhronizacione obaveze (ponavljaju se u svakoj fazi)

| Promjena | Šta ažurirati |
|---|---|
| Nova ENV varijabla | `.env.example` (uz changelog) → `env-schema.ts` → `node scripts/env-sync-check.mjs` |
| Novi Redis ključ / red / ACL korisnik | `REDIS_ACL.md` §4 + changelog + `infra/redis/users.acl.example` → **upozoriti vlasnika na `ACL LOAD`** |
| Novi endpoint | `docs/07-API_SPECIFIKACIJA.md` §7 + `docs/09` P-mapping |
| Novi ekran | `docs/06-UX_UI_DIZAJN.md` §5.5 + `bs` mikrotekst |
| Nova metrika/alarm | `docs/10-OPERACIJE.md` §3 |
| Promjena modela | `docs/03` + `schema.prisma` + migracija + `status-labels.ts` |

---

## 7. Spremno za Fazu 1

- [x] Monorepo, CI kapije, lint/format
- [x] ENV ugovor (1:1 s `.env.example`) + fail-fast na bootu
- [x] Error katalog i envelope (klijent switch-uje po `code`)
- [x] RBAC model u dijeljenom paketu (katalog, matrica, evaluator)
- [x] Redis/BullMQ infrastruktura s graceful degradation
- [x] Health probe-ovi i dijagnostika
- [x] Web shell, dizajn tokeni, navigacija
- [x] Model podataka (schema) + plan migracija **→ čeka `prisma generate` (§5.1)**
- [ ] **Faza 1:** auth (JWT + refresh rotacija), RBAC guardovi, audit log, matrica prava u UI-u

**Preporuka:** prije Faze 1 riješiti §5.1 (Prisma) i §5.2 (ekstenzije), jer bez
toga nema perzistencije ni integracijskih testova (P1–P3, P14).
