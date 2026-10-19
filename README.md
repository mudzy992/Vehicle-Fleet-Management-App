# Vehicle Fleet Management App — Vozni park (VFM)

Sistem za upravljanje službenim voznim parkom: vozila, vozači, registracije, osiguranje, servisi,
gume, radni zadaci s atomskim preuzimanjem, dinamičke verzionisane forme, obavijesti (FCM),
izvještaji i pun audit trag.

| | |
|---|---|
| **Stack** | NestJS 12 · PostgreSQL 17 · Prisma 7 · Redis 7.4 (ACL, prefix `vfm`) · BullMQ 6 · Vite 8 + React 19 + Tailwind 4 + shadcn/ui · Expo 57 (Android) · Firebase Cloud Messaging |
| **Monorepo** | pnpm workspaces + Turborepo (`apps/api`, `apps/web`, `apps/mobile`, `packages/*`) |
| **Deploy** | Coolify (Docker Compose), mreže `db_net` (Postgres) i `redis_net` (Redis) |
| **Jezik / valuta / TZ** | bosanski (`bs`) · `BAM/KM` · `Europe/Sarajevo` (baza u UTC) |

---

## Status

**Trenutno:** završena dokumentacija i deployment skeleton (faza 0 — priprema). Implementacija
kreće fazom 0 → 9 prema planu.

| Šta postoji | Gdje |
|---|---|
| Master plan implementacije (faze 0–9) | [`docs/PLAN_IMPLEMENTACIJE.md`](docs/PLAN_IMPLEMENTACIJE.md) |
| Unapređenja koncepta i ispravke zadatka | [`docs/01-KONCEPT_UNAPREDJENJA.md`](docs/01-KONCEPT_UNAPREDJENJA.md) |
| Arhitektura i tokovi | [`docs/02-ARHITEKTURA.md`](docs/02-ARHITEKTURA.md) |
| Model podataka (entiteti, indeksi, pravila) | [`docs/03-MODEL_PODATAKA.md`](docs/03-MODEL_PODATAKA.md) |
| Form engine (verzionisanje formi) | [`docs/04-FORM_ENGINE.md`](docs/04-FORM_ENGINE.md) |
| RBAC, permisije, sigurnost | [`docs/05-RBAC_PERMISIJE_SIGURNOST.md`](docs/05-RBAC_PERMISIJE_SIGURNOST.md) |
| UX/UI dizajn (tokeni, wireframe-ovi, microcopy) | [`docs/06-UX_UI_DIZAJN.md`](docs/06-UX_UI_DIZAJN.md) |
| API specifikacija | [`docs/07-API_SPECIFIKACIJA.md`](docs/07-API_SPECIFIKACIJA.md) |
| Docker / Coolify deployment | [`docs/08-DOCKER_COOLIFY_DEPLOYMENT.md`](docs/08-DOCKER_COOLIFY_DEPLOYMENT.md) |
| Test plan i kriteriji prihvatanja | [`docs/09-TEST_PLAN.md`](docs/09-TEST_PLAN.md) |
| Operacije i runbook | [`docs/10-OPERACIJE.md`](docs/10-OPERACIJE.md) |

---

## ⚠️ Dva fajla koja se moraju držati sinhronizovana

| Fajl | Zašto |
|---|---|
| [`.env.example`](.env.example) | Aplikacija se podiže na **Coolify**-u; sve varijable okruženja su ovdje. Svaka nova varijabla u kodu/compose-u ide u isti commit. |
| [`REDIS_ACL.md`](REDIS_ACL.md) | Redis ACL useri se postavljaju kroz **poseban fajl** na Coolify Redis resursu, ne kroz `.env`. Ako se promijene Redis ključevi, prefixi ili queue-ovi → ACL fajl **mora** biti ažuriran na serveru (`ACL LOAD`). |

Automatska provjera sinhronizacije (CI + lokalno):

```bash
node scripts/env-sync-check.mjs
```

---

## Brzi start (lokalni razvoj)

```bash
# 1) Zavisnosti
corepack enable && pnpm install

# 2) Okruženje
cp .env.example .env
node scripts/gen-secrets.mjs --write .env --redis   # tajne + Redis ACL hash-ovi

# 3) Infrastruktura (PostgreSQL 17 + Redis 7.4 s ACL-om) i aplikacija
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# 4) Provjera
curl -s localhost:3000/health/live
curl -s localhost:8080/healthz
node scripts/env-sync-check.mjs
```

Dev portovi: API `127.0.0.1:3000` · web `127.0.0.1:8080` · PostgreSQL `127.0.0.1:5433` ·
Redis `127.0.0.1:6380`.

> Do implementacije faze 0 kontejneri `api`/`web` neće imati kod — `docker-compose.dev.yml`
> pokreće `vfm-postgres` i `vfm-redis` koji su dostupni odmah:
> `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d vfm-postgres vfm-redis`

---

## Deployment (Coolify)

> ✅ **Infrastruktura već postoji (R-02):** na istom Docker hostu rade **globalni PostgreSQL**
> (mreža `db_net`, baza/user/lozinka kreirani) i **globalni Redis** (mreža `redis_net`, dijeljen s
> drugim aplikacijama). Ovaj compose ih **ne pokreće** — samo se povezuje (`external: true`).

1. Provjeri nazive globalnih kontejnera (`docker network inspect db_net` / `redis_net`) i kreiraj
   host direktorije (`docs/08-DOCKER_COOLIFY_DEPLOYMENT.md` §3).
2. Redis: primijeni ACL **varijantu B** iz `REDIS_ACL.md` §1 (na dijeljenoj instanci **ne dirati**
   `default` usera) + dogovoriti `maxmemory-policy noeviction` i `appendonly yes`.
3. Podigni aplikaciju: Build strategy **Compose**, `docker-compose.yml`, domene za `web` (:80) i
   `api` (:3000), **Connect to predefined network** → `db_net`/`redis_net`, ENV iz `.env.example`.
4. `migrate` servis pokreće migracije prije `api`/`worker`; **bez domene**.
5. `web` je namjerno **samo** na Coolify mreži (Traefik + dvije mreže = rizik od 504).

Detaljno, uključujući backup/restore, rollback i troubleshooting:
[`docs/08-DOCKER_COOLIFY_DEPLOYMENT.md`](docs/08-DOCKER_COOLIFY_DEPLOYMENT.md).

---

## Struktura repozitorija

```
apps/api        NestJS REST API (/api/v1) + Prisma + BullMQ (api/worker/migrate iz istog image-a)
apps/web        Vite + React + Tailwind + shadcn/ui (nginx image)
apps/mobile     Expo SDK 57 (Android APK/AAB, EAS Build) — NIJE dio Docker stacka
packages/       shared · form-engine · form-renderer · api-client · config
infra/          redis (ACL + redis.conf) · postgres (init SQL)
scripts/        env-sync-check · gen-secrets · bootstrap-super-admin · backup/restore
docs/           sva dokumentacija (10 dokumenata + master plan)
docker-compose.yml / .dev.yml / .coolify.yml
.env.example    ← uvijek ažuran
REDIS_ACL.md    ← uvijek ažuran
```

---

## Pravila projekta (ne krše se)

1. Autorizacija je **uvijek** na backendu; UI samo sakriva akcije.
2. Nema proizvoljnog JavaScript-a u definiciji forme (AST evaluator + whitelist).
3. Objavljena verzija forme i audit zapis su **immutabilni**.
4. Dinamička polja nikad ne prepisuju sistemska polja (ID, status, izvršilac, serverska vremena).
5. Nema stvarnih tajni u repozitoriju (`.env.example` i `REDIS_ACL.md` sadrže samo upute).
6. Funkcionalnost nije „gotova" dok build i relevantni testovi ne prođu.
7. `.env.example` i `REDIS_ACL.md` se ažuriraju **u istom commit-u** kao i promjena koja ih je
   izazvala, uz eksplicitno upozorenje vlasniku šta treba prenijeti u Coolify.
