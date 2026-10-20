# Prisma — model podataka i migracije

**Šema:** `schema.prisma` (45 modela, 30 enuma) · **Specifikacija:** [`docs/03-MODEL_PODATAKA.md`](../../../docs/03-MODEL_PODATAKA.md) · **Baza:** PostgreSQL 17 (globalni Postgres na mreži `db_net`)

---

## 🔴 Status u Fazi 0 — zašto Prisma još nije u `package.json`

`prisma generate`, `prisma validate`, `prisma format` i `prisma migrate`
preuzimaju **engine binarne fajlove** (`schema-engine`, `query-engine`) s
`https://binaries.prisma.sh/all_commits/<hash>/<platform>/…`.

Okruženje u kojem je ovaj kod napisan ima izlazni pristup **samo** ka
`github.com`, `registry.npmjs.org` i `pypi.org`, pa:

- `binaries.prisma.sh` **nije dostupan** → `prisma generate` pada s
  `Client network socket disconnected before secure TLS connection was established`,
- platformski npm paketi (`@prisma/query-engine-linux-openssl-3.0.x` i dr.)
  **ne postoje** na `registry.npmjs.org` (404) — engine se distribuira samo
  preko `binaries.prisma.sh`.

Zato su `prisma` i `@prisma/client` **namjerno izostavljeni** iz
`apps/api/package.json`, a `src/prisma/**` je izuzet iz sandbox build-a
(`tsconfig.build.json`). Sve ostalo (ENV validacija, Redis, redovi, health,
error katalog) radi bez toga.

> Ovo **nije** arhitekturna promjena: Prisma ostaje ORM po planu
> (`docs/PLAN_IMPLEMENTACIJE.md`, ADR-03). Riječ je samo o ograničenju mreže u
> jednom okruženju.

---

## Aktivacija (jednom, ~5 minuta)

Pokrenuti na mašini/build serveru koji ima otvoren izlaz ka internetu — npr.
Coolify build, GitHub Actions runner ili lokalna mašina vlasnika.

```bash
# 1) Dodaj Prisma dependencije (verzije su pinovane u docs/PLAN_IMPLEMENTACIJE.md)
pnpm --filter @vfm/api add prisma@7.10.1
pnpm --filter @vfm/api add @prisma/client@7.10.1

> ⚠️ Sve komande se pokreću s **root-a monorepo-a**. Skripta `prisma:generate`
> definisana je samo u `apps/api/package.json`, pa se poziva preko
> `pnpm --filter @vfm/api …` (poziv `pnpm prisma:generate` s root-a pada).

```bash
# 2) Generiši client
pnpm --filter @vfm/api prisma:generate

# 3) Validiraj šemu i provjeri da li se nešto razlikuje od očekivanog
pnpm --filter @vfm/api exec prisma validate --schema prisma/schema.prisma
pnpm --filter @vfm/api exec prisma format   --schema prisma/schema.prisma

# 4) Kreiraj inicijalnu migraciju nad dev bazom (docker-compose.dev.yml)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d vfm-postgres vfm-redis
#    korisnik/lozinka/port su defaulti iz docker-compose.dev.yml:
#    POSTGRES_USER=vfm, POSTGRES_PASSWORD=${DEV_DB_PASSWORD:-vfm_dev_only}, port 5433
export DATABASE_URL="postgresql://vfm:vfm_dev_only@localhost:5433/vfm?schema=public"
pnpm --filter @vfm/api exec prisma migrate dev --name init --schema prisma/schema.prisma

# 5) Dodaj ručne SQL dijelove u generisanu migraciju (vidi sekciju ispod)
#    i ponovo primijeni:
#    5a) prvo ispiši svih 19 mjesta označenih komentarom `// SQL:`
grep -n "// SQL:" apps/api/prisma/schema.prisma
#    5b) sadržaj tih markera + apps/api/prisma/sql/0000_bootstrap_extensions.sql
#        zalijepi u apps/api/prisma/migrations/<timestamp>_init/migration.sql
#        (mora biti idempotentno: IF NOT EXISTS / CREATE OR REPLACE)
pnpm --filter @vfm/api exec prisma migrate dev --schema prisma/schema.prisma

# 6) Build s Prisma modulom uključenim
pnpm --filter @vfm/api build:full

# 7) Commit generisanih migracija (obavezno u Git — pravilo 2 ispod)
git add apps/api/prisma/migrations apps/api/package.json pnpm-lock.yaml
git commit -m "chore(prisma): aktivacija — deps 7.10.1, generate i inicijalna migracija init"
git push origin main
```

Nakon toga:

- uključiti `PrismaService` u `src/infra/database/database.module.ts`
  (zamijeniti `DatabaseAvailabilityService` kao izvor `/health/ready` provjere),
- u `src/health/database.health-indicator.ts` postaviti
  `DATABASE_CHECK_NON_CRITICAL = false` i koristiti `prisma.$queryRaw\`SELECT 1\``,
- skinuti `prisma` s `ignoredBuiltDependencies` u `pnpm-workspace.yaml`
  **samo ako** build okruženje ima pristup `binaries.prisma.sh`.

---

## Ručni SQL koji Prisma ne može izraziti

Svaki od ovih dijelova je označen komentarom `// SQL:` u `schema.prisma`.
Dodaje se **u generisanu migraciju** i mora biti **idempotentan**
(`IF NOT EXISTS`, `CREATE OR REPLACE`).

| Šta | Gdje | Zašto |
|---|---|---|
| Ekstenzije `pgcrypto`, `citext`, `btree_gist` | `sql/0000_bootstrap_extensions.sql` | `citext` e-mail, `EXCLUDE USING gist` |
| Partial unique indeksi (`User.email`, `Vehicle.internalNo`, `Vehicle.vin`, `TireSet.code`, `Task.idempotencyKey`, `TaskAssignment` ASSIGNEE, `TireInstallation` aktivna) | migracija | Prisma ne podržava `WHERE` u `@@unique` |
| `EXCLUDE USING gist` za periode registracije/osiguranja (B-10) | migracija | sprječava preklapanje perioda po vozilu |
| CHECK ograničenja (`odometerKm >= 0`, `year BETWEEN 1950 AND 2100`, `length(vin)=17`, `validUntil > validFrom`, status/assignee invarianti) | migracija | integritet na nivou baze |
| Trigger `vfm_guard_last_super_admin()` | migracija | P-03: sistem mora imati ≥1 aktivnog Super Admina |
| Triggeri immutabilnosti (`AuditLog`, `TaskEvent`, `FormSchemaVersion` kad je `PUBLISHED`) | migracija | P-10, P-14 |
| SQL view-ovi `vfm_v_*` (7 komada) | migracija (Faza 7) | izvještaji čitaju samo normalizovane kolone (U-03) |
| `AuditLog.id` kao `GENERATED ALWAYS AS IDENTITY` | migracija | Prisma `autoincrement()` na `BigInt` daje `bigserial` |

`sql/0000_bootstrap_extensions.sql` je **spreman za ručno izvršenje** nad
globalnim Postgresom (jednom, prije prve migracije) — vidi
[`docs/08-DOCKER_COOLIFY_DEPLOYMENT.md`](../../../docs/08-DOCKER_COOLIFY_DEPLOYMENT.md) §4.1.

> ⚠️ Ako korisnik baze **nema** pravo `CREATE EXTENSION` (R-02b), skriptu mora
> izvršiti DBA/superuser. U tom slučaju `DATABASE_CREATE_EXTENSIONS=false`
> (default u produkciji) i aplikacija samo provjerava da ekstenzije postoje.

---

## Pravila rada s migracijama

1. **Nikad** `prisma db push` nad produkcijskom bazom — isključivo
   `prisma migrate deploy` (compose servis `migrate`).
2. Migracije su u Git-u (`prisma/migrations/`), jedna po promjeni modela.
3. Atomski `claim` zadatka, `swap` guma i `publish` forme idu kroz
   `$transaction` + `$executeRaw` s **parametriziranim** upitima (bez string
   interpolacije) — SQL je naveden u komentarima `schema.prisma` i u
   `docs/05-RBAC_PERMISIJE_SIGURNOST.md`.
4. Soft delete se implementira kroz Prisma **client extension** (`$extends`)
   koji automatski dodaje `where.deletedAt = null`, uz eksplicitan `withDeleted`
   opt-in za izvještaje.
5. JSONB polja (`formData`, `definition`, `payload`) se **ne** filtriraju u
   `WHERE` za liste — za to postoje normalizovane kolone (U-03).
6. Novac je `Int` (feninzi), kilometraža `Int`, decimalne količine
   `Decimal(10,2)`, datum `@db.Date`, timestamp `@db.Timestamptz(6)`.

---

## Sinhronizacija dokumentacije

Promjena `schema.prisma` **obavezno** povlači:

- `docs/03-MODEL_PODATAKA.md` (tabela entiteta/enuma),
- `packages/shared/src/enums.ts` + `status-labels.ts` (bosanski nazivi),
- `docs/07-API_SPECIFIKACIJA.md` (ako se mijenja API ugovor),
- `.env.example` ako se pojavi nova varijabla + `node scripts/env-sync-check.mjs`,
- **upozorenje vlasniku** ako se pojavi novi Redis ključ/red → `REDIS_ACL.md` §4
  i `ACL LOAD` na globalnom Redisu.
