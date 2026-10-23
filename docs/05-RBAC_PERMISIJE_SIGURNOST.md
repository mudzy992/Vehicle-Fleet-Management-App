# 05 — RBAC, permisije i sigurnost

**Verzija:** 1.0.0 · **Modul:** `roles`, `auth`, `audit` · **Faza:** 1 (uz dopune u fazama 2–8)

> Temeljno pravilo (§3.1 zadatka): **backend je jedini autoritet.** UI sakriva akcije radi
> korisničkog iskustva, ali svaki endpoint i svaki zapis prolaze kroz guard. Permisije su podatak u
> bazi, ne kod u frontendu.

---

## 1. Model prava

```
Permission = MODULE  ×  ACTION  ×  SCOPE
                │          │         └── ALL | OWN | VEHICLE_IDS | DRIVER_IDS  (+ conditions jsonb)
                │          └────────── view, create, update, archive, delete, assign, claim,
                │                      complete, complete_override, export, manage_schema,
                │                      publish_version, view_pii, cancel, reopen, release
                └───────────── auth, users, roles, permissions, drivers, vehicles, odometer,
                               registrations, insurance, services, tires, tasks, task_types,
                               forms, attachments, notifications, reports, audit, settings, system

Role ──< RolePermission >── Permission        (scope + conditions po vezi)
User ──< UserRole >── Role                     (validFrom/validUntil, revokedAt)
```

**Efektivne permisije korisnika** = unija svih `RolePermission` svih aktivnih rola, s najširim
scope-om (ako jedna rola daje `ALL`, rezultat je `ALL`). Računaju se **na serveru** pri svakom
zahtjevu (keš 60 s + invalidacija verzijom).

### 1.1 Scope

| Scope | Značenje | Primjer |
|---|---|---|
| `ALL` | Svi zapisi modula | Administrator vidi sva vozila |
| `OWN` | Samo zapisi koje je korisnik kreirao / koji su mu dodijeljeni | Obični korisnik vidi samo svoje zadatke |
| `VEHICLE_IDS` | Samo navedena vozila (+ sve vezano) | Vozač vidi samo vozilo koje koristi |
| `DRIVER_IDS` | Samo navedeni vozači | |

`conditions` (jsonb) omogućava dodatna pravila bez novog koda, npr.:
```json
{ "onlyOwnTasks": true, "onlyActiveVehicles": true, "maxRecordAgeDays": 365 }
```
Evaluator scope-a je **whitelist** podržanih uslova — nepoznat uslov se ignoriše i logira kao WARN.

---

## 2. Akcije

| Akcija | Značenje | Napomena |
|---|---|---|
| `view` | čitanje liste i detalja | bez `view` nema ni export-a |
| `create` | kreiranje zapisa | |
| `update` | uređivanje | poštuje `version` (optimistic lock) |
| `archive` | arhiviranje (soft) | ne briše historiju |
| `delete` | trajno brisanje | **samo Super Admin**, audit `CRITICAL` |
| `assign` | dodjeljivanje zadatka/drugog zapisa korisniku | |
| `claim` | preuzimanje slobodnog zadatka | atomski |
| `complete` | završetak zadatka | samo izvršilac |
| `complete_override` | završetak tuđeg zadatka | eksplicitno, auditovan |
| `cancel` / `reopen` / `release` | otkazivanje / ponovno otvaranje / vraćanje među slobodne | |
| `export` | PDF/Excel/CSV izvoz | auditovan svaki put |
| `manage_schema` | upravljanje definicijama formi (draft) | |
| `publish_version` / `retire_version` | objava / povlačenje verzije forme | |
| `migrate_records` | migracija historijskih zapisa na novu verziju forme | |
| `view_pii` | pristup ličnim podacima vozača/korisnika | |
| `manage_permissions` | izmjena matrice prava | |
| `manage_settings` | globalne postavke i šifarnici | |
| `view_audit` | čitanje audit loga | |
| `impersonate` | (v2, default **isključeno**) rad u ime drugog korisnika | puni audit |

---

## 3. Katalog permisija (seed — `Permission` tabela)

| Modul | Permisije |
|---|---|
| `auth` | `auth:login`, `auth:logout`, `auth:refresh`, `auth:change_password`, `auth:reset_password`, `auth:manage_sessions` |
| `users` | `user:view`, `user:create`, `user:update`, `user:archive`, `user:delete`, `user:assign_role`, `user:reset_password`, `user:view_pii`, `user:force_logout` |
| `roles` | `role:view`, `role:create`, `role:update`, `role:archive`, `role:manage_permissions` |
| `permissions` | `permission:view`, `permission:catalog_sync` |
| `drivers` | `driver:view`, `driver:create`, `driver:update`, `driver:archive`, `driver:delete`, `driver:view_pii`, `driver:export` |
| `vehicles` | `vehicle:view`, `vehicle:create`, `vehicle:update`, `vehicle:archive`, `vehicle:delete`, `vehicle:export`, `vehicle:view_history` |
| `odometer` | `odometer:view`, `odometer:create`, `odometer:correct` |
| `registrations` | `registration:view`, `registration:create`, `registration:update`, `registration:archive`, `registration:delete`, `registration:export` |
| `insurance` | `insurance:view`, `insurance:create`, `insurance:update`, `insurance:archive`, `insurance:delete`, `insurance:export` |
| `services` | `service:view`, `service:create`, `service:update`, `service:archive`, `service:delete`, `service:export` |
| `tires` | `tire:view`, `tire:create`, `tire:update`, `tire:archive`, `tire:delete`, `tire:mount`, `tire:dismount`, `tire:swap`, `tire:export` |
| `tasks` | `task:view`, `task:view_all`, `task:create`, `task:update`, `task:assign`, `task:claim`, `task:complete`, `task:complete_override`, `task:cancel`, `task:reopen`, `task:release`, `task:comment`, `task:export` |
| `task_types` | `task_type:view`, `task_type:create`, `task_type:update`, `task_type:archive` |
| `forms` | `form:view`, `form:create`, `form:update`, `form:manage_schema`, `form:publish_version`, `form:retire_version`, `form:migrate_records` |
| `attachments` | `attachment:view`, `attachment:upload`, `attachment:delete`, `attachment:download_original` |
| `notifications` | `notification:view`, `notification:mark_read`, `notification:broadcast`, `notification:manage_preferences` |
| `reminders` | `reminder:view`, `reminder:manage_policies`, `reminder:acknowledge`, `reminder:snooze` |
| `reports` | `report:view`, `report:export`, `report:manage_definitions`, `report:view_costs` |
| `audit` | `audit:view`, `audit:export`, `audit:view_security` |
| `settings` | `settings:view`, `settings:update`, `settings:manage_lists` |
| `system` | `system:view_health`, `system:view_metrics`, `system:run_maintenance`, `system:view_queue` |

Ukupno: **120+** permisija (tačan popis se seeduje u Fazi 1 i drži u
`packages/shared/src/permissions.ts` — jedan izvor za API, web i mobilnu).

---

## 4. Početna matrica (default konfiguracija)

Legenda: **✓** = `ALL`, **○** = `OWN`, **—** = nema pravo.

Matrica je **konfigurabilna u bazi** i mijenja se kroz `PUT /roles/matrix` (puna zamjena grantova
po roli, jedna transakcija). Svaka izmjena diže `Role.permissionsVersion` i briše keš
(`vfm:perm:*`) → revokacija važi za postojeće tokene u ≤ 5 s (§5.3). `SUPER_ADMIN` se ne uređuje
matricom: ima sve permisije implicitno (R-07), pa bi upis grantova davao lažan osjećaj revokacije.

| Permisija | SUPER_ADMIN | ADMINISTRATOR | OBICNI_KORISNIK |
|---|---|---|---|
| `user:*` (sve) | ✓ | — | — |
| `role:*`, `permission:*` | ✓ | — | — |
| `settings:*` | ✓ | — | — |
| `form:*` (uklj. publish/migrate) | ✓ | — | — |
| `audit:view`, `audit:view_security` | ✓ | — | — |
| `system:*` | ✓ | — | — |
| `vehicle:view` | ✓ | ✓ | ✓ |
| `vehicle:create/update` | ✓ | ✓ | — |
| `vehicle:archive` | ✓ | ✓ | — |
| `vehicle:delete` | ✓ | — | — |
| `vehicle:export` | ✓ | ✓ | — |
| `odometer:view` | ✓ | ✓ | ✓ |
| `odometer:create` | ✓ | ✓ | ○ (uz zadatak) |
| `odometer:correct` | ✓ | ✓ | — |
| `driver:view` | ✓ | ✓ | — |
| `driver:view_pii` | ✓ | — | — |
| `driver:create/update` | ✓ | ✓ | — |
| `registration:*`, `insurance:*` | ✓ | ✓ (view/create/update/export) | view |
| `service:*` | ✓ | ✓ | view |
| `tire:view` | ✓ | ✓ | ✓ |
| `tire:mount/dismount/swap` | ✓ | ✓ | — |
| `tire:create/update` | ✓ | ✓ | — |
| `task:view_all` | ✓ | ✓ | — |
| `task:view` | ✓ | ✓ | ○ |
| `task:create` | ✓ | ✓ | — |
| `task:update` | ✓ | ✓ | ○ (svoj, dok je OPEN) |
| `task:assign` | ✓ | ✓ | — |
| `task:claim` | ✓ | — | ✓ |
| `task:complete` | ✓ | ○ | ○ |
| `task:complete_override` | ✓ | — | — |
| `task:cancel` / `reopen` / `release` | ✓ | ✓ | — |
| `task:comment` | ✓ | ✓ | ✓ |
| `task_type:*` | ✓ | view | view |
| `attachment:upload` | ✓ | ✓ | ✓ |
| `attachment:view` | ✓ | ✓ | ○ |
| `attachment:download_original` | ✓ | ✓ | — |
| `attachment:delete` | ✓ | ✓ | ○ (svoj, 15 min) |
| `notification:view` | ✓ | ✓ | ✓ |
| `notification:broadcast` | ✓ | — | — |
| `reminder:view` | ✓ | ✓ | ○ |
| `reminder:manage_policies` | ✓ | — | — |
| `report:view` | ✓ | ✓ | — |
| `report:view_costs` | ✓ | ✓ | — |
| `report:export` | ✓ | ✓ | — |
| `report:manage_definitions` | ✓ | — | — |

**Napomene**
- **R-07 (odluka vlasnika):** Super Admin **vidi sve** — `driver:view_pii`, `user:view_pii` i svi
  ostali opsezi su `ALL`. Za Administratora i običnog korisnika `view_pii` ostaje zasebna permisija
  koju Super Admin dodjeljuje/oduzima iz matrice (default: nemaju je).
- Tabela je **seed**, ne hardkod: Super Admin je može mijenjati iz matrice prava (uključujući
  davanje `driver:create` običnom korisniku ili oduzimanje istog administratoru — §3.1 zadatka).
- `SUPER_ADMIN` je jedina rola čiji se skup prava ne može smanjiti ispod sistemskog minimuma
  (DB provjera: ne može se oduzeti `role:manage_permissions` posljednjem Super Adminu).
- `allowedClientTypes`: `SUPER_ADMIN = {WEB}`, ostali `{WEB, MOBILE_ANDROID}` (§6).

---

## 5. Tokeni, sesije i revokacija

### 5.1 Access token (JWT, 10 min)

```jsonc
{
  "iss": "vfm-api",
  "aud": "vfm-clients",
  "sub": "0b6c…",                 // userId
  "jti": "…",
  "iat": 1760000000,
  "exp": 1760000600,
  "roles": ["ADMINISTRATOR"],       // samo kodovi rola (ne permisije!)
  "tv": 3,                          // tokenVersion iz DB
  "pv": 12,                         // permissionsVersion (max svih rola + globalni)
  "ct": "MOBILE_ANDROID",           // clientType za koji je refresh session izdat
  "sid": "…"                        // RefreshSession.id
}
```

**Permisije NIKAD nisu u tokenu.** Guard ih učitava iz keša/DB na svaki zahtjev.

### 5.2 Refresh token

- Nasumičan 256-bitni token; u DB se čuva **SHA-256 hash** (`RefreshSession.tokenHash`).
- **Rotacija:** svaki `POST /auth/refresh` izdaje novi refresh i označava stari `replacedById`.
- **Reuse detection:** ako se koristi već zamijenjen/istekao token iz istog `familyId` → ukidaju se
  **sve** sesije korisnika, `tokenVersion++`, audit `SECURITY`.
- Web: `Set-Cookie: vfm_refresh=…; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`.
- Mobilna: `expo-secure-store` (KeyStore/Keystore enkripcija).

### 5.3 Mehanizam brze revokacije (B-06)

| Događaj | Akcija | Efekat |
|---|---|---|
| Promjena permisija role | `Role.permissionsVersion++` + `DEL vfm:perm:*` za članove + `INCR vfm:permver:role:{id}` | ≤ 5 s (Redis TTL keša) |
| Dodjela/ukidanje role korisniku | `User.tokenVersion++` (ako je kritično) ili samo invalidacija keša | odmah / ≤ 5 s |
| Deaktivacija naloga, promjena lozinke, „odjavi sve uređaje" | `User.tokenVersion++` + revoke svih `RefreshSession` | **odmah** (401 na sljedećem zahtjevu) |
| Globalna promjena kataloga permisija | `INCR vfm:permver:global` | ≤ 5 s |

Guard pseudokod:

```ts
const claimed = jwt.pv, current = await permissionsVersion.get();   // Redis, DB fallback
if (claimed < current) throw new UnauthorizedException('PERMISSIONS_STALE');  // klijent refresh-uje
const perms = await permissionsService.effective(userId);           // keš 60 s + DB
if (!perms.has(code)) throw new ForbiddenException('PERMISSION_DENIED');
scopeService.assert(perms.scopeOf(code), record);                   // provjera po zapisu
```

`PERMISSIONS_STALE` vraća `401` uz `Retry-After: 0`; klijent poziva `/auth/refresh` i dobija token s
novim `pv` → korisnički doživljaj je „nastavi rad", sigurnosni efekat je „stara prava ne važe".

---

## 6. Zabrana mobilnog pristupa Super Admina (P1, B-07)

Tri nezavisna sloja:

1. **Login:** `clientType ∈ {MOBILE_ANDROID, MOBILE_IOS}` i korisnik ima rolu s
   `allowedClientTypes` bez mobilnog → `403 MOBILE_ACCESS_FORBIDDEN` + `AuditLog(SECURITY)`.
2. **Refresh:** refresh sesija izdata za `WEB` ne može izdati mobilni token i obrnuto
   (`sid.ct` se provjerava).
3. **Svaki zahtjev:** `ClientTypeGuard` upoređuje `ct` iz tokena s `allowedClientTypes` rola iz DB.
   Čak i ako neko ručno izmjeni `clientType` na klijentu ili ukrade web token i pošalje ga s
   mobilnog uređaja, zahtjev za mobilne tokove (`X-Client-Type: MOBILE_ANDROID` header + `ct` claim)
   se odbija.

Dodatno: mobilni endpointi za Super Admin tokove (`/roles`, `/form-schemas`, `/settings`, `/audit`)
vraćaju `403 MOBILE_SCOPE_NOT_ALLOWED` kada je `ct` mobilni, neovisno o permisijama.

---

## 6.1 Statusi naloga i prijava

| Status | Prijava | Pristup |
|---|---|---|
| `ACTIVE` | ✅ | pun pristup prema permisijama |
| `PENDING_PASSWORD_CHANGE` | ✅ (s privremenom lozinkom) | **samo** promjena lozinke, `GET /auth/me`, odjava i vlastite sesije; sve ostalo `403 PASSWORD_CHANGE_REQUIRED`; efektivna prava su prazna |
| `SUSPENDED` | ❌ `403 ACCOUNT_INACTIVE` | ništa |
| `DEACTIVATED` | ❌ `403 ACCOUNT_INACTIVE` | ništa |

`PENDING_PASSWORD_CHANGE` je stanje nakon bootstrapa, seed-a i kreiranja korisnika od strane
administratora. Prijava **mora** biti dozvoljena — bez nje korisnik ne može doći do ekrana za promjenu
lozinke, pa bi svaki novi nalog bio trajno zaključan. Ograničenje pristupa je na serveru
(`JwtAuthGuard`), ne u UI-u. Uspješna promjena lozinke prebacuje nalog u `ACTIVE` i gasi sve sesije.

Isto važi i za `ACTIVE` nalog s `mustChangePassword=true` (administrator je postavio privremenu
lozinku): prijava prolazi, ali pristup je ograničen dok se lozinka ne promijeni.

---

## 7. Autentifikacija — pravila

| Pravilo | Vrijednost |
|---|---|
| Hash lozinke | argon2id, `memoryCost=64 MB`, `timeCost=3`, `parallelism=1` |
| Dužina lozinke | min 12 znakova (zadatak: bez fiksnih lozinki), max 128 |
| Kompleksnost | min 3 od 4 klase; provjera protiv liste najčešćih 100k lozinki |
| Lockout | 5 neuspjelih / 15 min po (email + IP); nakon 20 → trajno zaključano do admin intervencije |
| Rate limit login | `THROTTLE_LOGIN_LIMIT` / `THROTTLE_LOGIN_TTL_SECONDS` |
| 2FA | **NE implementira se** (R-05, odluka vlasnika). Kompenzacija: politika lozinke (min 12), lockout, rate limit, rotacija refresh tokena s reuse detection, `tokenVersion`, audit |
| Reset lozinke | jednokratni token, 30 min, jednokratno korištenje; u bazi samo SHA-256 hash (`PasswordResetToken`), novi reset gasi stare; **uspjeh revokuje sve sesije** (`tokenVersion++`). U Fazi 1 token izdaje admin (`POST /users/:id/reset-password` → `deliveredBy: 'ADMIN'`), u Fazi 5 ide e-mailom kroz outbox |
| Enumeracija korisnika | odgovor `/auth/login` je generičan: „Pogrešan e-mail ili lozinka" |
| Sesije | max `AUTH_MAX_SESSIONS_PER_USER`; pregled i revokacija iz profila |
| Bootstrap prvog Super Admina | `scripts/bootstrap-super-admin.mjs`, slučajna lozinka, `mustChangePassword=true` |

---

## 8. Sigurnosne kontrole po sloju

### 8.1 HTTP / aplikacija
- `helmet` (HSTS, `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, CSP za API).
- CORS: allowlista iz `CORS_ORIGINS`, `credentials: true` samo za web domenu; mobilna koristi
  direktni API poziv bez cookie-ja (Bearer).
- Body limiti: `1mb` JSON, `25mb` multipart.
- Timeout: 30 s po zahtjevu (upload izuzet).
- Rate limiting (Redis) po profilima: global / login / upload / export / claim.
- **Idempotency-Key** na `POST /tasks`, `/tasks/:id/claim`, `/tasks/:id/complete`, `/attachments`.
- ETag/`If-Match` za optimistic locking na `PUT` (uz `version`).
- Bez izlaganja stack trace-a u produkciji; `X-Request-ID` u svakom odgovoru.
- Redigovanje tajni (`AUDIT_REDACT_FIELDS`) u logovima, audit diff-u i error odgovorima.

### 8.2 Podaci
- Šifrovanje u tranzitu (TLS 1.2/1.3, Traefik), interne veze kroz privatne Docker mreže.
- PII polja (`Driver.licenseNumber`, `dateOfBirth`, `address`, `phone`, `email`, `notes`,
  `restrictions`, slobodni `formData`, foto-privitak i napomene/ograničenja kategorija dozvole;
  `User.email`) dostupna su samo uz odgovarajući `view_pii`. Bez prava se maskiraju ili izostavljaju;
  u listama se vraćaju redigovana (`A***@example.ba`, `•••••`).
- EXIF/GPS se uklanja pri uploadu fotografija (`exifStripped=true`).
- Soft delete + audit; `AuditLog` i `TaskEvent` bez `UPDATE`/`DELETE` (trigger).
- Backup šifrovan (restic/`pg_dump -Fc` + GPG ili šifrovani off-site).

### 8.3 Prilozi (B-15)
- Whitelist MIME + provjera **magic bytes** (npr. `file-type`), ne samo `Content-Type`.
- Max veličina `ATTACHMENT_MAX_SIZE_MB`; max dimenzije + kompresija.
- Ekstenzija se **ne** izvodi iz korisničkog imena fajla (generiše se iz detektovanog tipa).
- Fajlovi se čuvaju van web root-a; pristup samo kroz `GET /attachments/:id/content` s
  permisijom + potpisani URL (`FILE_SIGNING_SECRET`, TTL 300 s).
- `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, bez inline izvršavanja.
- SHA-256 deduplikacija; audit svakog pristupa (`FILE_ACCESS`).

### 8.4 Infrastruktura
- Kontejneri: non-root (`vfm:vfm`, uid 1001), `no-new-privileges`, `cap_drop: ALL`, read-only root
  fs (web), healthchecks, memorijski/CPU limiti.
- Redis: ACL (`REDIS_ACL.md`), `default off`, bez `+config/+acl/+keys`, `noeviction`, AOF.
- PostgreSQL: bez objavljenog porta, `db_net` interna mreža, odvojeni korisnik `vfm` bez superuser
  prava (osim za `CREATE EXTENSION` pri inicijalizaciji).
- Firebase service account: file mount `:ro` samo za `api`/`worker`; nikad u Git-u, nikad u
  web/mobile bundle-u (`.dockerignore` + `.gitignore` + gitleaks u CI).
- CI: `pnpm audit`, Trivy (image scan), gitleaks (secret scan), `env-sync-check` + provjera
  fiksnih lozinki (`grep` po `PATTERN` iz B-16). Ta provjera preskače **samo** blocklist-u
  (`packages/shared/src/schemas.ts`, `password.service.ts`) i test fajlove — isključenja su po
  tačnoj putanji, da novi fajl istog imena ne bi bio tiho preskočen.

---

## 9. Audit zahtjevi

**Obavezno se audituje** (`AuditLog`):

| Kategorija | Događaji |
|---|---|
| Autentifikacija | login (uspjeh/neuspjeh), logout, refresh reuse, lockout, promjena lozinke, reset lozinke, odjava svih sesija |
| Prava | kreiranje/izmjena role, promjena matrice permisija (diff), dodjela/ukidanje role korisniku, promjena scope-a |
| Sigurnost | mobilni pristup Super Admina (odbijen), pristup bez permisije (403), neuspjela validacija forme, sumnjivi upload, više od 10 × 403 u minuti |
| Forme | draft/promjena drafta, validate, publish, retire, migracija (job + po zapisu) |
| Poslovni zapisi | create/update/archive/delete za vozila, vozače, registracije, osiguranja, servise, gume, montaže, zadatke; claim, complete, cancel, reopen, release, override |
| Podaci | export (koji izvještaj, filteri, format, broj redova), pristup prilogu, pristup PII |
| Sistem | izmjena postavki, pokretanje održavanja, migracije baze, seed/bootstrap |

Za svaki zapis: `actorId`, `actorRoles`, `action`, `severity`, `entityType/Id`, `changedFields`,
`before/after` (samo promijenjena polja), `requestId`, `ipAddress`, `userAgent`, `clientType`,
`createdAt`. **Bez `updatedAt`/`deletedAt`** — immutabilno.

---

## 10. Prijetnje i kontrole (threat model)

| # | Prijetnja | Uticaj | Kontrola |
|---|---|---|---|
| T-01 | Brute force login | Visok | Throttle (5/15 min) + lockout + audit + politika lozinke (min 12, provjera najčešćih 100k). 2FA **nije** u obimu (R-05) → preporučena kompenzacija: VPN/IP allowlist za web portal u produkciji |
| T-02 | Ukraden access token | Visok | Kratak TTL (10 min) + `tv`/`pv` provjera + revokacija sesija |
| T-03 | Ukraden refresh token | Kritičan | Hash u DB + rotacija + reuse detection (ukida sve sesije) |
| T-04 | Super Admin na mobilnoj | Kritičan | Tri sloja provjere (§6), audit SECURITY |
| T-05 | Race pri preuzimanju zadatka (dva izvršioca) | Kritičan | Uslovni `UPDATE … RETURNING` + unique partial index + idempotency + stress test |
| T-06 | Escalation kroz izmjenu `formData` (npr. `status`) | Kritičan | Rezervisani ključevi (§5 u `04-FORM_ENGINE.md`) + server-side whitelist kolona |
| T-07 | Ubacivanje JS-a kroz formu | Kritičan | AST evaluator bez `eval`, whitelist funkcija, limiti, static check |
| T-08 | Neovlašten pristup prilogu (direktan URL) | Visok | Fajlovi van web roota, signed URL + provjera permisija + audit |
| T-09 | Malicious upload (SVG s skriptom, polyglot) | Visok | Magic bytes + whitelist + `nosniff` + `Content-Disposition: attachment` |
| T-10 | SQL injection | Kritičan | Prisma parametrizirani upiti; `$executeRaw` **samo** s `Prisma.sql`/parametrima; nikad template string |
| T-11 | Mass assignment (PUT s dodatnim poljima) | Visok | Zod DTO whitelist + `UNKNOWN_FIELD` greška |
| T-12 | Denial of service (veliki export/upload) | Srednji | Rate limit, body limiti, export kroz worker, resurs limiti |
| T-13 | Curenje tajni u logove | Visok | `AUDIT_REDACT_FIELDS`, gitleaks u CI, strukturirani logovi s whitelist poljima |
| T-14 | Push spam / tuđi token | Srednji | `DeviceToken.userId` provjera pri registraciji, unique `tokenHash`, quiet hours, `notificationKey` dedupe |
| T-15 | Gubitak podataka (disk, ljudska greška) | Kritičan | Backup (dnevno) + testirani restore + volume backup za priloge + soft delete + audit |
| T-16 | Neovlašten izvoz ličnih podataka | Visok | `report:export` + `driver:view_pii` + audit izvoza |
| T-17 | Redis kompromitovan (dijeljeni host) | Srednji | ACL `~vfm:*`, bez opasnih komandi, `default off`; Redis ne sadrži trajne poslovne podatke (sve je u DB) |
| T-18 | Supply chain (npm paket) | Srednji | `pnpm-lock.yaml` + `--frozen-lockfile`, `pnpm audit` u CI, Renovate/Dependabot |
| T-19 | CSRF (web cookie) | Srednji | `SameSite=Lax` + `Path=/api/v1/auth` + provjera `Origin` headera za mutacije |
| T-20 | Klikjacking | Nizak | `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'` |

---

## 11. Implementacijski checklist (Faza 1)

- [ ] `packages/shared/src/permissions.ts` — katalog permisija (jedan izvor istine).
- [ ] Prisma modeli: `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `RefreshSession`, `AuthAttempt`, `AuditLog`, `Setting`.
- [ ] Seed: katalog permisija + 3 role + default matrica (§4).
- [ ] `JwtAuthGuard`, `TokenVersionGuard`, `PermissionsVersionGuard`, `ClientTypeGuard`, `PermissionsGuard`, `ScopeGuard`.
- [ ] `@RequirePermissions('module:action')` + `@ScopeOf()` dekoratori.
- [ ] Redis konekcija s `vfm-api` ACL korisnikom; keš permisija + verzija.
- [ ] `AuditInterceptor` + `AuditService` (diff, redigovanje).
- [ ] Throttler profili (global/login/upload/export).
- [ ] argon2id + password policy + lockout + reuse detection (bez 2FA — R-05).
- [ ] `scripts/bootstrap-super-admin.mjs` + `scripts/gen-secrets.mjs`.
- [ ] Testovi: P1, P2, P3, P14 + T-01…T-04, T-11, T-19.
- [ ] Web: matrica prava, korisnici, audit pregled, profil/sesije.
- [ ] `.env.example` dopunjen (JWT/COOKIE/THROTTLE/AUTH/BOOTSTRAP/AUDIT).
