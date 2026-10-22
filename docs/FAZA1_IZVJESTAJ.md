# Faza 1 — Izvještaj: Identitet

**Izvorni izvještaj:** 20.10.2026. · **Dopuna:** 22.10.2026. · **Grana:** `arena/d46d9ae6-vehicle-fleet-management-app` · **HEAD:** `720c655` + necommitovane auditne izmjene

> Ovaj dokument dokazuje šta je od **Definition of Done** iz [`PLAN_IMPLEMENTACIJE.md`](./PLAN_IMPLEMENTACIJE.md) §5
> i prihvatnih kriterija **P1/P2/P3/P14** iz [`09-TEST_PLAN.md`](./09-TEST_PLAN.md) §2 ispunjeno, šta je
> provjereno samo unit testovima (sandbox nema živu bazu/Redis) i šta vlasnik mora pokrenuti na pravoj bazi.

---

## 1. Rezime

| Stavka | Rezultat |
|---|---|
| Kvalitet-kapije (22.10) | `corepack pnpm exec turbo run lint typecheck test build` → **25/25 taskova**, exit `0` ✅ |
| Testovi (22.10) | API **916/916**; ciljani web session **5/5**; raniji ciljano izvršeni API subset **197/197** ✅ |
| Coverage | **Nije ponovo izračunat** u dopuni 22.10; coverage brojevi izvornog izvještaja su historijski (20.10), ne aktuelni dokaz |
| ENV | Izvorni izvještaj: `.env.example` ⇄ šema 1:1, `env-sync-check` **0 upozorenja** (154 varijable); nije ponovljeno 22.10 |
| Migracije | `0_extensions`, `1_init`, `2_manual`, `3_password_reset_tokens`, `4_super_admin_guard_lock` ⚠️ migracije 3–4 **nisu primijenjene na živu bazu** |
| Endpointi Faze 1 | `/api/v1/auth/*` (9 ruta), `/roles` (4), `/permissions` (2), `/users` (10), `/audit-logs` (2) ✅ |
| Web ekrani | Prijava, Korisnici, Matrica prava, Audit log, Profil (+ guard-ovi, `usePermission`) ✅ |
| Pokrenuti seed/bootstrap u sandboxu | ❌ — traži PostgreSQL (skripte su kompajlirane i unit-testirane, ali nisu izvršene nad pravom bazom) |

---

## 2. Implementirano po oblastima

### 2.1 Prisma sloj i baza

| Šta | Gdje | Napomena |
|---|---|---|
| `PrismaService` (`@Global`), Prisma 7 + `@prisma/adapter-pg` | `apps/api/src/prisma/` | `ping()` = stvarni `SELECT 1`; `/health/ready` ga prijavljuje |
| Generator `prisma-client` (Rust-free) | `prisma/schema.prisma`, `prisma.config.ts` | `datasource.url` u konfiguraciji (Prisma 7 breaking change), `migrations.seed` |
| Migracije | `prisma/migrations/{0,1,2,3,4}` | `1_init` = 45 tabela / 9 `ux_` / 18 `ck_` / 2 EXCLUDE / 76 FK / 6 triggera; `2_manual` = partial unique, EXCLUDE, guard triggeri; `4_super_admin_guard_lock` serijalizuje posljednjeg Super Admina |
| `PasswordResetToken` | `3_password_reset_tokens` | SHA-256, 30 min, jednokratno (`usedAt`) |

Provjereno **primjenom** na PostgreSQL 16 u ranijoj fazi (`scripts/db-verify/`: `0→1→2`, `behavior_tests.py` **95/95**).
Migracije **3 i 4 su ručno napisani SQL** (Prisma 7 `migrate diff` traži native engine koji sandbox ne može preuzeti).
Migracija 4 dodaje transaction advisory lock prije posljednjeg-Super-Admin guard triggera; `scripts/db-verify/` uključuje
primjenu/idempotentnost migracije 4 i paralelni test deaktivacije dva Super Admina (očekivano jedan uspjeh, jedan `LAST_SUPER_ADMIN_PROTECTED`).
Verifikator je **kompajliran, ali nije izvršen nad PostgreSQL-om**; prije deploya obavezno ga pokrenuti u izoliranoj bazi
(`apps/api/prisma/README.md` §A), nikad direktno na produkciji.

### 2.2 Autentifikacija (`/api/v1/auth`)

| Ruta | Šta radi |
|---|---|
| `POST /login` | argon2id (m=64 MB, t=3, p=1), lockout nakon `AUTH_MAX_FAILED_ATTEMPTS`, `AuthAttempt` za svaki pokušaj, client-type provjera (N-05), `vfm_refresh` httpOnly cookie (web) ili `refreshToken` u tijelu (mobilni) |
| `POST /refresh` | rotacija (`replacedById`), reuse detection → **revokacija svih sesija** + `tokenVersion++`, `ct` vezan za sesiju |
| `POST /logout` · `/logout-all` | jedna sesija / sve + `tokenVersion++` |
| `GET /me` | profil + efektivna prava + `pv`/`tv` + `timezone`/`locale` |
| `POST /change-password` | stara lozinka + politika; revoku sve sesije |
| `POST /reset-password` | jednokratni token (hash u bazi), istek 30 min, revoku sve sesije |
| `GET /sessions` · `DELETE /sessions/:id` | vlastiti uređaji; tuđa sesija → `404`; opoziv trenutne sesije označava `currentSessionRevoked` i briše web refresh cookie |

Access token 10 min (`JWT_ACCESS_TTL`), refresh 30 dana; `tv` (tokenVersion) se provjerava u Redis-u na svakom zahtjevu
(`vfm:tokenver:{userId}`), `pv` (permissionsVersion) daje `401 PERMISSIONS_STALE` → klijent osvježi prava.

### 2.3 RBAC

- `PermissionsGuard` + `@RequirePermissions` + evaluator opsega `ALL | OWN | VEHICLE_IDS | DRIVER_IDS`
  (`OWN < VEHICLE_IDS/DRIVER_IDS < ALL`), keš `vfm:perm:{userId}` TTL 60 s.
- Invalidacija: `Role.permissionsVersion++` + `DEL vfm:perm:*` + preslikavanje `vfm:permver:role:{id}` na DB verziju;
  globalna permission-version se čita i pri izdavanju tokena i `/me`, pa nov token ostaje poravnat s aktivnom verzijom.
  → revokacija važi za **postojeće** tokene bez ponovne prijave (P3).
- Globalne administratorske user/role/permission/audit rute zahtijevaju scope `ALL`; `OWN`/ID scope sami po sebi ne otključavaju globalne kolekcije.
- Redoslijed guard-ova: **RateLimit → Jwt → ClientType → Permissions**.
- Super Admin: web-only na prijavi **i** na svakom zahtjevu (P1); mobilni → `403 MOBILE_ACCESS_FORBIDDEN` + SECURITY zapis.
- Rate limit na Redis-u (`vfm:rl:{scope}:{identity}`): login 5/15 min, globalno 300/min, upload 30/min; fail-open
  (degradirano stanje je vidljivo u `meta`), `429 RATE_LIMITED`.

### 2.4 Role i matrica prava (P2)

`GET /roles`, `GET /roles/matrix`, `PUT /roles/matrix`, `POST /roles`, `GET/PATCH /roles/:id`, `POST /roles/:id/archive`,
`GET /permissions`, `POST /permissions/sync`.

`PUT /roles/matrix` je **puna zamjena** grantova po roli u **jednoj transakciji**; `permissionsVersion++` po diranoj roli;
Redis se invalidira **nakon** commit-a. `SUPER_ADMIN` se ne uređuje matricom (R-07). Zaštite: rezervisani kodovi,
sistemske role se ne arhiviraju, rola s aktivnim korisnicima se ne arhivira, `409 LAST_SUPER_ADMIN_PROTECTED`.

### 2.5 Korisnici (P14)

`GET /users` (paginacija + `q`/`status`/`roleId`), `POST /users` (server generiše privremenu lozinku, `mustChangePassword`),
`GET/PATCH /users/:id`, `POST /users/:id/archive`, `DELETE /users/:id`, `POST /users/:id/roles`,
`DELETE /users/:id/roles/:roleId`, `POST /users/:id/reset-password`, `POST /users/:id/force-logout`.

- **PII**: `email`/`phone` maskirani bez `user:view_pii` (+ `piiRedacted`); `user:view_pii:OWN` otkriva PII samo vlastitog korisničkog reda, `ALL` — sve.
- **Zaštita zadnjeg Super Admina** na svakoj radnji koja bi ga uklonila; migracija 4 zaključava konkurentnu provjeru DB transakcijama. PostgreSQL verifier nije izvršen.
- `DELETE` = **anonimizacija** PII-a (fizički `DELETE` bi pokidao immutabilni `AuditLog`).
- Promjena statusa/rola i reset lozinke revokuju sesije i brišu RBAC keš.

### 2.6 Audit

- `AuditInterceptor` + `PrismaAuditSink` pišu **jedan** red u `AuditLog` (before/after diff, `requestId`, IP, UA, `clientType`),
  uz redakciju osjetljivih polja i na `after` strani.
- SECURITY događaji (guard odbijanja, mobilni Super Admin, reuse detection) idu u istu tabelu (`severity='SECURITY'`).
- Tabela je immutabilna (DB trigger); retencija/arhiva je Faza 8.
- `GET /audit-logs` (+ `/:id`) uz `audit:view`; `SECURITY` redovi traže `audit:view_security`.

### 2.7 Seed i bootstrap

| Skripta | Šta radi |
|---|---|
| `apps/api/src/tools/seed.ts` (`pnpm --filter @vfm/api seed`) | katalog permisija, 3 sistemske role, grantovi iz `defaultGrantsForRole()`, forma vozila; **samo van produkcije ili uz `SEED_DEMO_DATA=true`**: 2 demo korisnika (generisane lozinke, ispisane jednom) i 10 fiktivnih vozila. Idempotentno (`skipDuplicates`, ne dira ručne izmjene matrice). |
| `scripts/bootstrap-super-admin.mjs` | prvi Super Admin, generisana lozinka ispisana **jednom**, `mustChangePassword`, odbija rad ako Super Admin već postoji (nema `--force`) |

**Nijedna lozinka nije u repou** — sve se generišu (`PasswordService.generateTemporaryPassword`), a u bazi je argon2id hash.

### 2.8 Web

`lib/api.ts` (access token u memoriji, single-flight refresh, retry na 401), `SessionProvider`,
`RequireAuth`/`RequirePermission`/`AnonymousOnly`, `usePermission()`, shell s navigacijom filtiranom po pravima.
Ekrani: Prijava, Korisnici, Matrica prava, Audit log, Profil (vidi [`06-UX_UI_DIZAJN.md`](./06-UX_UI_DIZAJN.md) §9.1).

---

## 3. Prihvatni kriteriji — status

| ID | Kriterij | Status | Dokaz |
|---|---|---|---|
| **P1** | Super Admin: web OK, mobilno 403 | ✅ unit (login + guard + audit) · ⏳ e2e | `auth-service.spec.ts` (login `WEB` 200; `MOBILE_ANDROID` → `MOBILE_ACCESS_FORBIDDEN` + SECURITY), `auth-guards.spec.ts` (token s `ct=MOBILE_*` → 403 na svakom zahtjevu) |
| **P2** | Rola + izmjena prava + audit | ✅ unit · ⏳ HTTP integracija | `roles-service.spec.ts` (23), `roles-controller.spec.ts` (22: permisije po ruti, `PERMISSION_CHANGE` audit, `AuditContext` diff) |
| **P3** | Oduzeto pravo blokira API ≤ 5 s bez re-logina | ✅ logika (verzije/keš/guard) · ⏳ mjerenje latencije | `permissions-service.spec.ts`, `auth-guards.spec.ts` (`PERMISSIONS_STALE`, `PERMISSION_DENIED`), `users-service.spec.ts` (revokacija pri promjeni role) |
| **P14** | Bez prava nema podataka ni preko direktnog URL-a | ✅ unit (rute + guard-ovi + web) · ⏳ sweep | `roles-controller`/`users-controller`/`audit-log-service` specovi (permisije po ruti, SECURITY redovi skriveni), `apps/web/src/app/guards.test.tsx` |

**Šta ovo NE dokazuje:** da cijeli lanac radi nad **živim** PostgreSQL-om i Redis-om (migracija 3, seed, bootstrap,
stvarni HTTP, latencija < 5 s). Sandbox nema Docker ni bazu — ti koraci su u §5.

---

## 4. Komande i rezultati (ponovljivo)

```bash
pnpm --filter @vfm/shared build                       # shared se konzumira iz dist/
PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm turbo run lint typecheck test build
# → Tasks: 17 successful, 17 total
# → shared 234 · api 495 · web 47 testova

node scripts/env-sync-check.mjs                       # → ✅ 0 upozorenja (154 varijable)

cd apps/api && VITE_CONFIG_NATIVE_IGNORE_WARNING=true pnpm exec vitest run --coverage   # exit 0
cd apps/web && pnpm exec vitest run --coverage                                          # exit 0
```

Trajanje pune kapije: ~30 s na ovom sandboxu. Nijedan test ne dira mrežu, bazu ni Redis
(`FakePrismaClient`, `FakeRedis`, `FakeLoader`).

---

## 5. Šta vlasnik mora pokrenuti (obavezno prije korištenja)

1. **Migracije + seed** (na pravoj bazi; prije toga `scripts/db-verify/` da se potvrdi da migracija 3 odgovara šemi):

   ```bash
   docker compose run --rm migrate node dist/tools/migrate.js --seed
   # ili odvojeno:
   pnpm --filter @vfm/api exec prisma migrate deploy
   pnpm --filter @vfm/api seed        # dev; u image-u: node dist/tools/seed.js
   ```

2. **Prvi Super Admin** — automatski kroz `migrate` (varijanta A, bez ručnog koraka):

   ```dotenv
   RUN_DB_SEED=true
   BOOTSTRAP_SUPER_ADMIN_ENABLED=true
   BOOTSTRAP_SUPER_ADMIN_EMAIL=super@firma.ba
   BOOTSTRAP_SUPER_ADMIN_FIRST_NAME=Ime
   BOOTSTRAP_SUPER_ADMIN_LAST_NAME=Prezime
   BOOTSTRAP_SUPER_ADMIN_PASSWORD=<jaka lozinka, min 12 znakova>
   ```

   `migrate` = `migrate deploy` → seed → bootstrap; lozinka se **ne ispisuje**, a
   korisnik je mijenja pri prvoj prijavi. Kad Super Admin postoji, korak se
   preskače uz `WARN` (redeploy ne pada) — tada vrati `ENABLED=false` i obriši
   `PASSWORD`. Ručna alternativa (generisana lozinka, ispiše se jednom):

   ```bash
   node scripts/bootstrap-super-admin.mjs --email super@firma.ba --name "Ime Prezime"
   ```

3. **Coolify env**: **nema novih varijabli** u Fazi 1. Postojeće (`JWT_*`, `COOKIE_*`, `AUTH_*`, `PERMISSIONS_CACHE_TTL_SECONDS`,
   `DATABASE_*`, `REDIS_*`) su dovoljne; `SEED_DEMO_DATA` postaviti samo na demo okruženjima.
4. **Redis ACL**: **nema izmjena** — Faza 1 ne uvodi nove ključeve (audit stream `vfm:stream:audit` je odgođen, §6).
5. **Redeploy** web-a i API-ja (novi endpointi i ekrani).

### Kako provjeriti P1–P3/P14 uživo (5 minuta)

```bash
# P1 — web OK, mobilni 403
curl -s -X POST https://api.vehicle.ba101.top/api/v1/auth/login \
  -H 'Content-Type: application/json' -H 'X-Client-Type: WEB' \
  -d '{"email":"super@firma.ba","password":"<iz-bootstrapa>","clientType":"WEB"}' | jq '.data.user.isSuperAdmin'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.vehicle.ba101.top/api/v1/auth/login \
  -H 'Content-Type: application/json' -H 'X-Client-Type: MOBILE_ANDROID' \
  -d '{"email":"super@firma.ba","password":"<…>","clientType":"MOBILE_ANDROID"}'      # → 403

# P3 — oduzmi pravo i provjeri postojeći token (bez ponovne prijave), cilj < 5 s
# PUT /api/v1/roles/matrix (ukloni vehicle:create) → isti access token → POST /api/v1/vehicles → 403 PERMISSION_DENIED

# P14 — direktan URL bez prava
curl -s -o /dev/null -w '%{http_code}\n' https://api.vehicle.ba101.top/api/v1/users -H "Authorization: Bearer <token-bez-user:view>"  # → 403
```

---

## 6. Odstupanja i odluke (svjesne, obrazložene)

| # | Tema | Odluka | Zašto |
|---|---|---|---|
| 1 | Lista zabranjenih lozinki | kompaktna lista + injektabilna `PASSWORD_BLOCKLIST` (umjesto ~100k redova u repou) | 100k lista u repou je ~2 MB šuma; lista se može ubaciti kroz env/deploy fajl bez izmjene koda |
| 2 | `DELETE /users/:id` | **anonimizacija** (PII → `deleted-<id>@invalid`), ne fizički `DELETE` | `AuditLog` je immutabilan i nosi `actorId`; brisanje bi pokidalo audit trag |
| 3 | Reset lozinke | token izdaje admin (`deliveredBy: 'ADMIN'`), korisnik ga unosi kroz `/auth/reset-password` | Faza 1 nema e-mail/outbox; fiksne lozinke su zabranjene. U Fazi 5 token ide e-mailom i uklanja se iz odgovora |
| 4 | `XADD vfm:stream:audit` (SSE tok audit-a) | **odgođeno** | uvodi novi Redis ključ → obavezan `REDIS_ACL.md` + `infra/redis/users.acl.example` + ponovno pokretanje Redis-a; ide s Faza 6 (obavijesti) |
| 5 | Swagger dekoratori (checklist docs/09) | **nije primjenjivo** | `@nestjs/swagger` nije dependencija; OpenAPI se uvodi kad zatreba (npr. Faza 3 s mobilnim klijentom) |
| 6 | Matrica prava u UI-u | samo `—` / `ALL` / `OWN` | `VEHICLE_IDS`/`DRIVER_IDS` traže izbor vozila/vozača (Faza 3); server ih podržava i validira |
| 7 | Web coverage | mjeri se nad **logikom** (api klijent, sesija, guard-ovi, nav, diff matrice, badge), ne nad ekranima | ekrani se provjeravaju E2E testovima (Faza 6); DOM-klikanje bez provjere ponašanja bi tjeralo lažne testove |
| 8 | `PERMISSIONS_STALE` | `401` + `Retry-After: 0` → klijent odmah osvježi profil | 403 bi korisniku trajno zaključao ekran i pored toga što prava možda ima |

### Popravke otkrivene i riješene tokom faze

- **`1_init` FK tipovi** — `Attachment.uploadedById`/`IdempotencyKey.userId` bili `TEXT` a cilj `UUID` → `migrate deploy` bi pao;
  popravljeno u šemi i SQL-u, verifier hvata regresiju.
- **`bumpTokenVersion` INCR od nule** — Redis brojač je ostajao **ispod** DB `tokenVersion`, pa guard ne bi poništio token
  nakon odjave/promjene lozinke (P1/P3 bi pali u produkciji). Sada se DB verzija **preslikava** u Redis (`max`).
- **`logout` dupla revokacija** — sesija je revokovana dva puta (`revokedSessions: 0`); razdvojeno na `logout` (jedna sesija)
  i `logoutAll` (sve + `tokenVersion++`).
- **Audit `after` nije bio redaktovan** — odgovor handlera (npr. login) mogao je u `AuditLog.after` nositi token;
  sada `redactRecord` važi i za `after`.
- **Nalog s privremenom lozinkom nije se mogao prijaviti (kritično)** — `login`, `refresh`, `me` i
  `change-password` tražili su `status === 'ACTIVE'`, a bootstrap/seed/„korisnik kojeg kreira administrator"
  postavljaju `PENDING_PASSWORD_CHANGE`. Posljedica: **nijedan novi nalog nije mogao ući** (403
  `ACCOUNT_INACTIVE`), pa nije mogao ni promijeniti lozinku. Sada: `PENDING_PASSWORD_CHANGE` smije na
  prijavu i `me`, a `JwtAuthGuard` ga pušta samo na promjenu lozinke, profil, odjavu i vlastite sesije —
  sve ostalo je `403 PASSWORD_CHANGE_REQUIRED` (novi kod). Uspješna promjena prebacuje nalog u `ACTIVE`
  (ranije se status nije mijenjao, pa je korisnik trajno ostajao „pending"). `change-password` više ne
  traži `auth:change_password` (vlastiti nalog; taj nalog nema efektivna prava).
- **`RolesModule`/`UsersModule` nisu bili u grafu aplikacije** nakon reseta sandboxa — rute `/roles` su bile nedostupne
  i pored zelenih testova; registracija je vraćena i pokrivena DI testovima modula.

---

## 7. Otvoreno / sljedeće

| # | Stavka | Faza |
|---|---|---|
| 1 | Migracije 3–4 + seed + bootstrap nad izoliranom pravom bazom (§5; verifier briše/kreira bazu) | **prije deploya** |
| 2 | E2E/integration testovi: P1 (HTTP), P2 (HTTP), P3 (mjerenje latencije), P14 sweep | 6 (uz Maestro/Playwright) |
| 3 | `POST /auth/forgot-password` + slanje reset tokena e-mailom (Outbox) | 5 |
| 4 | `XADD vfm:stream:audit` + SSE live audit (uz ACL izmjenu i upozorenje vlasniku) | 6 |
| 5 | `POST /audit-logs/export` (xlsx/pdf) | 7 |
| 6 | `VEHICLE_IDS`/`DRIVER_IDS` editor u matrici (nakon modula vozila/vozača) | 3 |
| 7 | OpenAPI/Swagger | 3 |
| 8 | Retencija `AuthAttempt` (180 dana) i isteklih reset tokena | 8 |
| 9 | Form engine (prava verzija forme umjesto seed šablona) | 2 |

---

## 8. Zaključak

Faza 1 isporučuje **funkcionalan identitet i autorizaciju**: prijava s rotirajućim sesijama, Super Admin web-only
(na prijavi i na svakom zahtjevu), konfigurabilni RBAC s trenutnom revokacijom, korisnici s PII zaštitom i
jednokratnim resetom lozinke, audit svih značajnih akcija i web ekrane za upravljanje.

Dopuna 22.10.2026: puna lokalna kapija zelena (**25/25 taskova**, API **916/916**, ciljano web session **5/5**).
Detaljni findings, fixes, regresijski testovi i pre-release uslovi: [`audit/FAZA1_AUDIT.md`](../audit/FAZA1_AUDIT.md).
Coverage i ENV-sync nisu ponovo izračunati u ovoj dopuni. Migracije 3–4, PostgreSQL/Redis live provjere i E2E nisu izvršeni;
bez tih provjera se ne smije tvrditi da je P1–P3/P14 dokazan end-to-end.
