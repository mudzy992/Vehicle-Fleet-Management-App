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

## Migracije — redoslijed i kako do prve

Prisma primjenjuje migracije **abecednim redoslijedom direktorija**, pa su
direktoriji u `apps/api/prisma/migrations/` imenovani:

| Direktorij | Sadržaj | Ko ga pravi |
|---|---|---|
| `0_extensions` | `pgcrypto`, `citext`, `btree_gist` (+ opciono `pg_stat_statements`) i trigger **funkcije** (`vfm_guard_last_super_admin`, `vfm_reject_write`, `vfm_guard_published_form_version`) | ✅ commit-ovano |
| `1_init` | sav DDL iz `schema.prisma` (45 modela, enumi, FK-ovi, indeksi) | 🔴 generiše se komandom ispod |
| `2_manual` | CHECK-ovi, `EXCLUDE USING gist`, partial unique indeksi, `AuditLog.id` kao IDENTITY i **vezivanje triggera** na tabele (19 `// SQL:` markera) | ⏳ nakon što `1_init` postoji (imena indeksa/ograničenja moraju odgovarati generisanom DDL-u) |

`migration_lock.toml` (`provider = "postgresql"`) je commit-ovan — bez njega
`prisma migrate deploy` odbija rad.

### A) Inicijalna migracija BEZ Docker-a i BEZ baze (preporučeno)

`prisma migrate diff --from-empty` ne spaja se ni na jednu bazu — treba samo
native `schema-engine` (preuzima se s `binaries.prisma.sh`, pa mora imati izlaz
ka internetu). Rezultat je čist SQL:

```bash
git switch main && git pull origin main
pnpm install --frozen-lockfile

mkdir -p apps/api/prisma/migrations/1_init
pnpm --filter @vfm/api exec prisma migrate diff \
  --from-empty --to-schema prisma/schema.prisma --script \
  > apps/api/prisma/migrations/1_init/migration.sql

# provjera: fajl mora imati CREATE TABLE "User" i ~45 tabela
grep -c "CREATE TABLE" apps/api/prisma/migrations/1_init/migration.sql

git add apps/api/prisma/migrations
git commit -m "chore(prisma): inicijalna migracija 1_init (DDL iz schema.prisma)"
git push origin main
```

Zatim redeploy: compose servis `migrate` (`node dist/tools/migrate.js`) uzme
Redis lock `vfm:lock:migrate`, sačeka Postgres i primijeni `0_extensions` +
`1_init` preko `prisma migrate deploy`.

> ⚠️ `migrate deploy` koristi native `schema-engine`, pa ga runtime kontejner
> preuzima pri prvom pokretanju (otvorena stavka 5). Ako log servisa `migrate`
> pokaže grešku mreže/keša, rješenje je preuzeti engine u builder fazi
> Dockerfile-a.

### B) Lokalni dev s Docker-om (za kasnije izmjene šeme)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d vfm-postgres vfm-redis
export DATABASE_URL="postgresql://vfm:vfm_dev_only@localhost:5433/vfm?schema=public"
pnpm --filter @vfm/api exec prisma migrate dev --name <naziv_izmene>
pnpm --filter @vfm/api prisma:generate     # v7 NE pokreće generate automatski
```

`migrate dev` diže i gasi **shadow bazu** (treba `CREATEDB`), briše podatke pri
`reset`-u i nikad se ne pokreće nad produkcijskom bazom.

### C) Seed

U Prisma 7 `migrate dev` **ne** pokreće seed. Kad `prisma/seed.ts` bude napisan,
dodati `migrations.seed` u `prisma.config.ts` i zvati `prisma db seed` (compose
već ima `RUN_DB_SEED` / `SEED_DEMO_DATA`).

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
