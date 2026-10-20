# Prisma — model podataka i migracije

**Šema:** `schema.prisma` (45 modela, 30 enuma) · **Specifikacija:** [`docs/03-MODEL_PODATAKA.md`](../../../docs/03-MODEL_PODATAKA.md) · **Baza:** PostgreSQL 17 (globalni Postgres na mreži `db_net`)

---

## ✅ Status — Prisma 7.10.1 je aktivirana u `package.json`

| Paket | Verzija | Uloga |
|---|---|---|
| `prisma` | 7.10.1 | CLI (`generate`, `migrate`, `validate`, `format`). **`dependencies`**, ne devDependencies: runtime servis `migrate` (`dist/tools/migrate.js`) spawn-uje `prisma migrate deploy`, a `pnpm deploy --prod` reže dev dependencije. |
| `@prisma/client` | 7.10.1 | Runtime klijent; nosi i query compiler WASM (`runtime/query_compiler_fast_bg.postgresql.*`) koji generisani kod dinamički importuje. |
| `dotenv` | 18.0.8 | Prisma 7 **ne** učitava `.env` automatski → `prisma.config.ts` počinje s `import 'dotenv/config'`. |

Generator je **`prisma-client`** (Rust-free, Prisma 7 default) s izlazom u
`apps/api/src/generated/prisma`:

- izlaz je **TypeScript** (fajlovi nose `/* eslint-disable */` i `// @ts-nocheck`),
  pa ga naš `tsc` sastavlja u `dist/generated/prisma` — importi ostaju
  relativni i rade u CommonJS build-u (`tsconfig` je i dalje `module: commonjs`,
  `"type": "module"` **nije** potreban),
- direktorij je u `.gitignore`-u (`apps/api/src/generated/`) → generiše se u
  svakom okruženju (Docker builder to radi **prije** `tsc`),
- ESLint ga preskače (`src/generated/**` u `apps/api/eslint.config.mjs`).

Zastarjeli `prisma-client-js` generator nije korišten (u Prisma 7 je deprecated
i traži native engine).

### Connection URL — gdje živi (Prisma 7 breaking change)

| Šta | Gdje | Ko čita |
|---|---|---|
| `url` u `datasource` bloku `schema.prisma` | ❌ **uklonjeno** — vraća grešku `P1012` | — |
| `apps/api/prisma.config.ts` → `datasource.url` | ✅ izvor istine za CLI | `generate`, `migrate dev|deploy`, `db seed`, `studio` |
| Konstruktor klijenta (runtime) | ✅ driver adapter (`PrismaPg({ connectionString })`) | API/worker proces |

`prisma.config.ts` namjerno čita `process.env.DATABASE_URL`, a ne `env()` helper
iz `prisma/config`: `env()` **baca** ako varijabla nije postavljena, a
`prisma generate` se pokreće u Docker build-u i na čistom clone-u bez baze.

### Šta radi bez interneta (sandbox), a šta ne — verificirano

Prisma 7 nosi WASM u samom CLI paketu (`prisma/build/prisma_schema_build_bg.wasm`,
`query_compiler_*_<db>.wasm`, `schema_engine_bg.wasm`), pa:

| Komanda | Bez `binaries.prisma.sh` | Napomena |
|---|---|---|
| `prisma generate` | ✅ radi | validira šemu preko `getDmmf` WASM-a i generiše klijent (~0,55 s) |
| `prisma format` | ✅ radi | WASM |
| `prisma validate` | ❌ pada | traži native `schema-engine` |
| `prisma migrate dev|deploy|diff` | ❌ pada | traži native `schema-engine` |

> ⚠️ `migrate diff` uz `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` vrati **prazan**
> SQL i exit 0 — lažni uspjeh. Taj trik smije se koristiti samo da bi
> `generate`/`format` prošli u sandboxu, **nikad** za generisanje migracija.
> (Ispravno: `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` + `prisma generate`.)

### Ispravke šeme koje je Prisma 7 validacija otkrila (13 grešaka → 0)

Šema iz Faze 0 nikad nije bila validirana (CLI nije bio instaliran). Ove
ispravke su **verificirane** (`prisma generate` prolazi):

| Greška | Ispravka |
|---|---|
| `TaskType.formSchema` i `TaskType.formSchemas` se obje odnose na `FormSchema` bez imena → *ambiguous relation* | relacije imenovane: `TaskTypeDefaultFormSchema` (zadana forma tipa zadatka) i `TaskTypeFormSchemas` (forme čiji je `taskTypeId` ovaj tip); na `FormSchema` dodano `defaultForTaskTypes TaskType[]` |
| `formSchemaVersion` na 8 modela (`Vehicle`, `RegistrationRecord`, `InsuranceRecord`, `ServiceRecord`, `Driver`, `TireSet`, `TireInstallation`, `Task`) nema suprotnu stranu | dodane liste na `FormSchemaVersion` (U-02: svaki zapis pamti tačnu objavljenu verziju forme) |
| `Attachment.uploadedBy` → `User` nema suprotnu stranu | `User.attachments Attachment[]` |
| `Vehicle.photoAttachment` / `Driver.photoAttachment` (1:1) nemaju suprotnu stranu | `Attachment.vehiclePhotoOf` / `Attachment.driverPhotoOf` |
| 1:1 relacija bez UNIQUE na FK strani (`P1012`) | `photoAttachmentId @unique` na `Vehicle` i `Driver` (NULL se smije ponavljati) — `docs/03-MODEL_PODATAKA.md` usklađen |
| `quietHoursStart/End String? @db.Time` → native tip `Time` traži `DateTime` | `DateTime? @db.Time` (kolona ostaje PostgreSQL `time` po docs/03; Prisma vraća `Date` s datumom 1970-01-01, značajan je samo `HH:MM:SS`) |

---

## Aktivacija na mašini / build serveru (~5 minuta)

Dependencije su već u `apps/api/package.json` — **korak 1 iz starije verzije ovog
README-a (`pnpm add …`) više nije potreban.**

```bash
git checkout main && git pull origin main
pnpm install --frozen-lockfile

# 1) Generiši klijent (pnpm --filter postavlja cwd na apps/api, gdje je prisma.config.ts)
pnpm --filter @vfm/api prisma:generate

# 2) Validacija + format (ova dva koraka skidaju schema-engine s binaries.prisma.sh)
pnpm --filter @vfm/api prisma:validate
pnpm --filter @vfm/api prisma:format

# 3) Dev infrastruktura (docker-compose.dev.yml: vfm-postgres na 127.0.0.1:5433)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d vfm-postgres vfm-redis
#    defaulti iz compose-a: POSTGRES_USER=vfm, POSTGRES_PASSWORD=${DEV_DB_PASSWORD:-vfm_dev_only}
export DATABASE_URL="postgresql://vfm:vfm_dev_only@localhost:5433/vfm?schema=public"

# 4) Inicijalna migracija (Prisma 7 NE pokreće generate ni seed automatski)
pnpm --filter @vfm/api exec prisma migrate dev --name init

# 5) Ručni SQL koji Prisma ne može izraziti (sekcija ispod)
grep -n "SQL:" apps/api/prisma/schema.prisma      # 19 markera
#    + apps/api/prisma/sql/0000_bootstrap_extensions.sql
#    → zalijepiti u apps/api/prisma/migrations/<timestamp>_init/migration.sql
#      (idempotentno: IF NOT EXISTS / CREATE OR REPLACE)
pnpm --filter @vfm/api exec prisma migrate dev

# 6) Build s Prisma modulom uključenim
pnpm --filter @vfm/api build:full

# 7) Commit (migracije MORAJU u Git — pravilo 2 ispod)
git add apps/api/prisma/migrations pnpm-lock.yaml
git commit -m "chore(prisma): inicijalna migracija init + ručni SQL (ekstenzije, triggeri, CHECK-ovi)"
git push origin main
```

Bez Docker-a na lokalnoj mašini: umjesto koraka 3–4 može se privremeno
`DATABASE_URL` usmjeriti na praznu šemu na serveru, ali **nikad** na
produkcijsku bazu (`migrate dev` briše i ponovo kreira shadow bazu).

---

## Prisma 7 — otvorene stavke

1. **Driver adapter za runtime** (obavezno u Prisma 7): `PrismaService` mora
   konstruisati klijent kao
   `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` → dodati
   `@prisma/adapter-pg@7.10.1` i `pg` u `dependencies` kad `PrismaService` bude
   implementiran. ⚠️ Pool defaulti se razlikuju od Prisme 6 (`pg` nema
   connection timeout → eksplicitno postaviti `connectionTimeoutMillis`).
2. **`MIGRATIONS_STRICT`** je u `docker-compose.yml` još `false` (Faza 0 default).
   Nakon prve commit-ovane migracije prebaciti na `true`, da deploy **pada** ako
   migracije ne prolaze, umjesto da tiho nastavi.
3. **CI** (`.github/workflows/ci.yml`): poslovi `quality` i `build` ne pokreću
   `prisma generate`. Dok nijedan izvorni fajl ne importuje generisani klijent to
   je ispravno; čim `PrismaService` uđe u `src/`, dodati korak
   `pnpm --filter @vfm/api prisma:generate` **prije** lint/typecheck/build.
4. **Seed**: u Prisma 7 `migrate dev` ne pokreće seed. Kad `prisma/seed.ts` bude
   napisan (3 role, demo korisnici s generisanim lozinkama, 10 fiktivnih vozila),
   dodati `migrations.seed` u `prisma.config.ts` i zvati `prisma db seed`
   (compose već ima `RUN_DB_SEED` / `SEED_DEMO_DATA`).
5. **Runtime engine za `migrate deploy`** — *assumed, treba provjeriti pri prvom
   Coolify deploy-u*: `prisma migrate deploy` koristi native `schema-engine`, pa
   ga runtime kontejner preuzima s `binaries.prisma.sh` pri prvom pokretanju
   (ili ga nađe u `node_modules/@prisma/engines` ako je preuzet u builderu).
   Ako deploy padne zbog mreže/kesh-a (`HOME` korisnika `vfm` nije upisiv),
   rješenje je preuzeti engine u builder fazi i kopirati ga u `/prod/api`, ili
   pokrenuti migracije iz jednokratnog kontejnera s mrežom.
6. **SSL**: Prisma 7 koristi `node-pg`, pa se neispravni certifikati više ne
   ignorišu (`P1010`). Za globalni Postgres s validnim certifikatom nije potreban
   `ssl: { rejectUnauthorized: false }` — ne dodavati ga bez potrebe.

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
