# 07 — API specifikacija (`/api/v1`)

**Verzija:** 1.0.0 · **Protokol:** REST/JSON (+ SSE za obavijesti, multipart za upload)
**Dokumentacija:** Swagger/OpenAPI 3.1 (`SWAGGER_ENABLED`, u produkciji isključen)
**Autorizacija:** Bearer JWT (access) + refresh cookie/storage · **Sve** provjere na serveru

---

## 1. Konvencije

### 1.1 URL i verzionisanje
- Bazni put: `/api/v1` (`API_PREFIX`).
- Resursi u množini, kebab-case: `/task-types`, `/form-schemas`, `/tire-installations`.
- Verzionisanje kroz URL; lomljive promjene → `/api/v2` (nikad tiho mijenjanje v1).
- Vremena: ISO 8601 s `Z` (UTC) u payloadu; klijent prikazuje u `Europe/Sarajevo`.
- Novac: `{ "amount": 12345, "currency": "BAM" }` (iznos u **feninzima**).

### 1.2 Envelope odgovora

```jsonc
// 200/201
{
  "data": { … } | [ … ],
  "meta": {                       // samo za liste
    "page": 1, "pageSize": 20, "totalItems": 148, "totalPages": 8,
    "sort": "createdAt:desc", "requestId": "8f3c…"
  }
}
```

Greške (jedinstven format — `AllExceptionsFilter`):

```jsonc
{
  "error": {
    "code": "PERMISSION_DENIED",          // mašinski čitljiv, STABILAN
    "message": "Nemate pravo za ovu radnju.",  // na bosanskom, za ljude
    "details": { "required": "vehicle:create" },  // opciono
    "requestId": "8f3c…",
    "timestamp": "2026-10-19T09:41:22Z"
  }
}
```

### 1.3 Paginacija, sortiranje, filtriranje

```
GET /api/v1/tasks?page=1&pageSize=20&sort=createdAt:desc,dueAt:asc
                  &filter[status][in]=OPEN,IN_PROGRESS
                  &filter[vehicleId][eq]=<uuid>
                  &filter[dueAt][lte]=2026-10-31
                  &filter[q]=pranje                 ← puna pretraga po resursu
```
- `pageSize` max 100 (default 20).
- Operatori: `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `startsWith`, `between`, `isNull`.
- Sortiranje: whitelist kolona po resursu; nepoznato → `400 INVALID_SORT`.
- Nepoznat filter/operator → `400 INVALID_FILTER` (nikad tiho ignorisan).

### 1.4 Optimistic locking i idempotencija
- `PUT/PATCH` šalje `version` (ili `If-Match: "<version>"`); neusklađenost → `409 VERSION_CONFLICT`.
- Autentifikovane JSON mutacije (`POST`, `PUT`, `PATCH`, `DELETE`) prihvataju
  opciono `Idempotency-Key` zaglavlje (1–128 vidljivih ASCII znakova; preporučen
  je UUID po pokušaju klijenta). Ključ vrijedi u opsegu korisnika, a otisak
  zahtjeva obuhvata metodu, punu putanju s query dijelom i JSON tijelo. Prvi
  uspješan odgovor čuva se 24 h u Redisu (`vfm:idem:{userId}:{key}`); isti
  korisnik, ključ i otisak vraćaju isti status i tijelo bez ponovnog handlera,
  domenskog upisa, outbox događaja i audita. Rate limit, autentifikacija, tip
  klijenta i permisije i dalje se provjeravaju prije replaya.
- Isti ključ s različitim otiskom → `422 IDEMPOTENCY_KEY_REUSED`. Ako je prvi
  isti zahtjev još u obradi → `409 VERSION_CONFLICT` uz `retryAfterSeconds`
  i `idempotencyState: "in-progress"`; nezavršena rezervacija ističe za 5 min.
  Greška handlera oslobađa rezervaciju. Neispravno zaglavlje →
  `400 VALIDATION_ERROR`, a nedostupan Redis → `503 DEPENDENCY_UNAVAILABLE`.
- Globalni replay se ne primjenjuje na javne i `/auth/*` rute ni na multipart
  upload (fajl se ne može vjerno hashirati prije Multer obrade). Odgovori koji
  nose lozinku/token/tajnu, binarni/stream odgovori i tijela veća od 64 KiB ne
  keširaju se u Redis; za njih nema replay garancije.

### 1.5 Katalog kodova grešaka

| HTTP | `code` | Kada |
|---|---|---|
| 400 | `VALIDATION_FAILED`, `INVALID_FILTER`, `INVALID_SORT`, `MALFORMED_JSON` | loš zahtjev |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `PERMISSIONS_STALE`, `REFRESH_REUSED` | auth |
| 403 | `PERMISSION_DENIED`, `SCOPE_DENIED`, `MOBILE_ACCESS_FORBIDDEN`, `MOBILE_SCOPE_NOT_ALLOWED`, `LAST_SUPER_ADMIN_PROTECTED`, `PII_ACCESS_DENIED`, `PASSWORD_CHANGE_REQUIRED` | autorizacija |
| 404 | `NOT_FOUND`, `ATTACHMENT_NOT_FOUND` | resurs ne postoji (ili nije u scope-u) |
| 409 | `TASK_ALREADY_CLAIMED`, `TASK_NOT_OPEN`, `NOT_ASSIGNEE`, `VERSION_CONFLICT`, `DUPLICATE_ENTRY`, `PERIOD_OVERLAP`, `TIRE_ALREADY_MOUNTED`, `ODOMETER_REGRESSION` | sukob stanja |
| 413 | `PAYLOAD_TOO_LARGE` | upload |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | upload |
| 422 | `FORM_VALIDATION_FAILED`, `UNKNOWN_FIELD`, `FIELD_NOT_VISIBLE`, `RESERVED_FIELD_KEY`, `FORM_VERSION_NOT_PUBLISHED`, `NORMALIZATION_MISMATCH`, `SCHEMA_INVALID`, `COMPUTED_TIMEOUT`, `IDEMPOTENCY_KEY_REUSED` | forme/validacija domene |
| 429 | `RATE_LIMITED` | throttling (+ `Retry-After`) |
| 500 | `INTERNAL_ERROR` | neočekivano (bez stack trace-a) |
| 503 | `DEPENDENCY_UNAVAILABLE` | DB/Redis/FCM down |

---

## 2. Endpointi po modulima

Legenda: 🔒 = autorizovano; **P** = potrebna permisija; `Idem` = podržava `Idempotency-Key`.

### 2.1 Auth (`/auth`)

| Metoda | Put | P | Opis |
|---|---|---|---|
| POST | `/auth/login` | javno + limiter `login` (5/15 min po IP-u) | `{email, password, clientType, deviceInfo?}` → `{accessToken, tokenType, expiresIn, refreshExpiresIn, sessionId, user}`; web dobija refresh u httpOnly cookie, mobilni u `refreshToken` (tijelo) |
| POST | `/auth/refresh` | javno (cookie **ili** `refreshToken` u tijelu) | rotacija (`replacedById`); reuse detection → revoke **svih** sesija + `tokenVersion++`; `ct` je vezan za sesiju (docs/05 §6.2) |
| POST | `/auth/logout` | 🔒 | ukida **trenutnu** sesiju (prema refresh tokenu ili `sid`); ostali uređaji rade dalje |
| POST | `/auth/logout-all` | 🔒 `auth:manage_sessions` | revoke svih sesija + `User.tokenVersion++` → postojeći access tokeni padaju odmah |
| GET | `/auth/me` | 🔒 | profil + role + efektivne permisije + `pv`/`tv` + postavke (`timezone`, `locale`) |
| POST | `/auth/change-password` | 🔒 (bez permisije — vlastiti nalog) | provjera stare lozinke + politika; `mustChangePassword=false`; `PENDING_PASSWORD_CHANGE → ACTIVE`; revoke svih sesija + `tokenVersion++` |
| POST | `/auth/forgot-password` | javno | uvijek 200 (bez enumeracije) — ⏳ Faza 5 (treba Outbox/e-mail; token se u Fazi 1 izdaje adminu kroz `/users/:id/reset-password`) |
| POST | `/auth/reset-password` | javno + limiter `login` | `{token, newPassword}` → 200 `{userId, email}`; token se poredi po SHA-256 hashu, važi 30 min i koristi se **jednom**; uspjeh: `mustChangePassword=false`, `tokenVersion++`, revoke **svih** sesija + brisanje RBAC keša |
| GET | `/auth/sessions` | 🔒 `auth:manage_sessions` | lista aktivnih sesija/uređaja (ISO datumi, IP, UA, `deviceInfo`) |
| DELETE | `/auth/sessions/:id` | 🔒 `auth:manage_sessions` | revokacija jedne sesije + `tokenVersion++`; tuđa sesija → `404 NOT_FOUND` |

**Stanje (Faza 1):** implementirano `login`, `refresh`, `logout`, `logout-all`, `me`,
`change-password`, `reset-password`, `GET/DELETE /sessions`. Sve rute osim `login`/`refresh` prolaze lanac
guard-ova `RateLimit → Jwt → ClientType → Permissions` (docs/05 §5–§6), a svaki pokušaj prijave
piše se u `AuthAttempt` (retencija 180 dana) i — kod odbijanja — u `AuditLog` (severity `SECURITY`).
| ~~`/auth/2fa/*`~~ | — | **uklonjeno** | 2FA se NE implementira (R-05) |

### 2.2 Korisnici (`/users`)

| Metoda | Put | P |
|---|---|---|
| GET | `/users` | `user:view` — `?page&pageSize&q&status&roleId`, PII maskiran bez `user:view_pii` |
| POST | `/users` `Idem` | `user:create` |
| GET | `/users/:id` | `user:view` (+ `user:view_pii` za PII) |
| PATCH | `/users/:id` | `user:update` |
| POST | `/users/:id/archive` | `user:archive` |
| DELETE | `/users/:id` | `user:delete` |
| POST | `/users/:id/roles` · DELETE `/users/:id/roles/:roleId` | `user:assign_role` |
| POST | `/users/:id/reset-password` | `user:reset_password` |
| POST | `/users/:id/force-logout` | `user:force_logout` |

**Semantika (Faza 1):**

- **PII**: `email`/`phone` su maskirani (`a***@vfm.test`, `•••••222`) i odgovor nosi
  `piiRedacted: true` osim uz `user:view_pii` (Super Admin ga ima implicitno — R-07).
- **Kreiranje**: `POST /users` ne prima lozinku — server generiše 20-znakovnu privremenu
  lozinku (prolazi politiku, `mustChangePassword=true`) i vraća je **samo** u tom odgovoru.
- **Brisanje**: `DELETE /users/:id` je **anonimizacija** — e-mail → `deleted-<id>@invalid`,
  imena → „Obrisan korisnik", `phone=null`, `deletedAt=now`, role revokovane. Fizički `DELETE`
  nije dozvoljen jer je `AuditLog` immutabilan i nosi `actorId` (audit trag mora ostati).
- **Reset lozinke**: `POST /users/:id/reset-password` izdaje jednokratni token (default 30 min,
  `expiresInMinutes` 5–120). U Fazi 1 admin ga predaje korisniku (`deliveredBy: 'ADMIN'`);
  u Fazi 5 token ide e-mailom kroz outbox i uklanja se iz odgovora. Novi reset gasi stare tokene.
- **Revokacija**: promjena statusa, dodjela/skidanje role, reset i force-logout dižu
  `tokenVersion` (DB pa Redis) i briše `vfm:perm:{userId}` → stari token pada odmah (P3/P14).
- **Zaštite**: `409 LAST_SUPER_ADMIN_PROTECTED` za deaktivaciju/arhiviranje/brisanje/skidanje
  `SUPER_ADMIN` role zadnjem aktivnom Super Adminu; vlastiti nalog se ne može deaktivirati,
  arhivirati ni obrisati (`400 VALIDATION_ERROR`); e-mail se ne mijenja kroz `PATCH`.

**Nalog s privremenom lozinkom (`PENDING_PASSWORD_CHANGE`)** — stanje nakon bootstrapa, seed-a ili
kada korisnika kreira administrator:

- **prijava je dozvoljena** (inače korisnik nikad ne bi mogao promijeniti lozinku); `mustChangePassword=true`
  i efektivna prava su **prazna**;
- `JwtAuthGuard` pušta takav nalog samo na `POST /auth/change-password`, `GET /auth/me`,
  `POST /auth/logout`, `POST /auth/logout-all` i `/auth/sessions*`; svaka druga ruta → `403 PASSWORD_CHANGE_REQUIRED`
  (provjera je na serveru, pa se ne može zaobići direktnim pozivom API-ja);
- `POST /auth/change-password` uspjehom prebacuje nalog u `ACTIVE` i gasi sve sesije — korisnik se prijavljuje
  ponovo s novom lozinkom.

### 2.3 Role i permisije (`/roles`, `/permissions`)

| Metoda | Put | P |
|---|---|---|
| GET | `/roles` · `/roles/:id` | `role:view` |
| POST | `/roles` · PATCH `/roles/:id` · POST `/roles/:id/archive` | `role:create/update/archive` |
| GET | `/roles/matrix` | `role:view` — matrica modul×akcija×rola |
| PUT | `/roles/matrix` | `role:manage_permissions` — bulk update u transakciji + `permissionsVersion++` + audit diff |
| GET | `/permissions` | `permission:view` — katalog (modul, akcija, opis, `isSensitive`) |
| POST | `/permissions/sync` | `permission:catalog_sync` — sinhronizacija kataloga iz koda u DB (deploy korak) |

**Semantika (implementirano u Fazi 1):**

- `PUT /roles/matrix` je **puna zamjena** grantova za svaku navedenu rolu (lista `grants` je
  konačno stanje; prazna lista = sva prava ukinuta). Cijela izmjena ide u **jednoj** transakciji,
  svaka dirana rola dobija `permissionsVersion++`, a Redis (`vfm:perm:*`, `vfm:permver:role:{id}`)
  se invalidira **nakon** commit-a → postojeći access tokeni vide novo stanje u ≤ 5 s bez prijave (P3).
- `SUPER_ADMIN` se **ne** uređuje matricom — ima sve permisije implicitno (R-07); pokušaj vraća
  `400 VALIDATION_ERROR`.
- Opsezi: `VEHICLE_IDS` traži neprazan `scopeVehicleIds`, `DRIVER_IDS` neprazan `scopeDriverIds`;
  `ALL`/`OWN` ne primaju ID liste (schema odbija na ulazu). Dodatna pravila idu u `conditions`.
- `POST /roles/:id/archive` odbija sistemske role (`SUPER_ADMIN`, `ADMINISTRATOR`,
  `OBICNI_KORISNIK`) i role s aktivnim korisnicima (`400 VALIDATION_ERROR`);
  Super Admin → `409 LAST_SUPER_ADMIN_PROTECTED` (isto čuva DB trigger).
- `POST /permissions/sync` je idempotentan; `description` se ne dira (opisi žive u bazi).
  `GET /permissions` vraća `inDatabase` po permisiji — deploy provjera je li sync pokrenut.
- Grant čija permisija ne postoji u bazi (sync nije pokrenut) prekida transakciju s porukom koja
  upućuje na `POST /api/v1/permissions/sync` (bez toga bi pravo bilo tiho neupotrebljivo).

Primjer `PUT /api/v1/roles/matrix`:

```json
{ "roles": [ { "roleId": "…", "grants": [
    { "permission": "vehicle:view", "scope": "ALL" },
    { "permission": "vehicle:create", "scope": "ALL" },
    { "permission": "task:view", "scope": "DRIVER_IDS",
      "scopeDriverIds": ["…"] } ] } ] }
```

`200` → `{ "data": { "affectedRoles": 1, "added": 1, "removed": 0, "scopeChanged": 0,
"changed": [{ "roleId": "…", "roleCode": "OBICNI_KORISNIK", "permission": "vehicle:create",
"before": null, "after": "ALL" }], "permissionsVersion": { "…": 7 } } }`

### 2.4 Vozači (`/drivers`)

| Metoda | Put | P |
|---|---|---|
| GET | `/drivers` | `driver:view` — `?page&pageSize&q&status&includeArchived&expiringInDays&licenseCategory` |
| POST | `/drivers` | `driver:create` — `formData` prema objavljenoj `DRIVER` verziji |
| GET | `/drivers/:id` | `driver:view` — PII uz `driver:view_pii` |
| PATCH | `/drivers/:id` | `driver:update` — nosi `version` (optimističko zaključavanje) |
| POST | `/drivers/:id/archive` · `/restore` | `driver:archive` — `ARCHIVED` samo ovdje |
| DELETE | `/drivers/:id` | `driver:delete` — soft-delete (`deletedAt`) |
| GET | `/drivers/:id/license-categories` | `driver:view` |
| POST | `/drivers/:id/license-categories` | `driver:update` — `409 DUPLICATE_ENTRY` za istu kategoriju |
| PATCH | `/drivers/:id/license-categories/:catId` | `driver:update` |
| DELETE | `/drivers/:id/license-categories/:catId` | `driver:update` |
| GET | `/drivers/:id/tasks` | `task:view` — Faza 4 |

**PII (B-20, R-07):** `phone`, `email`, `dateOfBirth`, `address` i `licenseNumber` vraćaju se
samo uz `driver:view_pii` (Super Admin uvijek). Bez prava: e-mail `A***@example.ba`, telefon i
broj dozvole `•••••123`, datum rođenja i adresa `null`, uz `piiRedacted: true`. Datum isteka
dozvole **nije** PII — nosi ga rok i podsjetnik.

### 2.5 Vozila (`/vehicles`)

| Metoda | Put | P |
|---|---|---|
| GET | `/vehicles` | `vehicle:view` |
| POST | `/vehicles` `Idem` | `vehicle:create` |
| GET | `/vehicles/:id` | `vehicle:view` — profil s agregatima (rokovi, km, brojači po tabu) |
| PATCH | `/vehicles/:id` | `vehicle:update` |
| POST | `/vehicles/:id/archive` · `/restore` | `vehicle:archive` |
| DELETE | `/vehicles/:id` | `vehicle:delete` |
| GET | `/vehicles/:id/registrations` · `/insurances` · `/services` · `/tire-installations` · `/tasks` · `/odometer` · `/attachments` · `/history` | `vehicle:view_history` |
| POST | `/vehicles/:id/odometer` `Idem` | `odometer:create` — validacija monotoniciteta |
| POST | `/vehicles/:id/odometer/correct` | `odometer:correct` — uz obavezan razlog |
| POST | `/vehicles/:id/handover` | `vehicle:update` — primopredaja (N-05) |

### 2.6 Registracije i osiguranje

| Metoda | Put | P |
|---|---|---|
| GET | `/registrations` | `registration:view` — `?page&pageSize&q&vehicleId&status&expiringInDays` |
| POST | `/registrations` | `registration:create` — `formData` prema objavljenoj `REGISTRATION` verziji |
| GET | `/registrations/:id` | `registration:view` |
| PATCH | `/registrations/:id` | `registration:update` — nosi `version`, provjerava preklapanje |
| DELETE | `/registrations/:id` | `registration:delete` — soft-delete (oslobađa period) |
| GET | `/insurances` | `insurance:view` — `?…&type` |
| POST | `/insurances` | `insurance:create` |
| GET · PATCH · DELETE | `/insurances/:id` | `insurance:view` · `update` · `delete` |
| POST | `/registrations/:id/attachments` · `/insurances/:id/attachments` | `attachment:create` — Faza 3 |

**B-10 — bez preklapanja perioda:** period je zatvoren interval `[validFrom, validUntil]`; preklapanje
po istom vozilu → `409 PERIOD_OVERLAP` s `extra.conflictingId` i rasponom sukoba u `details[]`. Isto
pravilo čuva baza (`EXCLUDE USING gist`, migracija `2_manual`), pa paralelni zahtjev ne može proći.

**Denormalizovani rok:** nakon svake promjene `Vehicle.registrationExpiresAt` /
`Vehicle.insuranceExpiresAt` = najdalji `validUntil` zapisa koji nisu `CANCELLED`/`ARCHIVED` i nisu
obrisani — u istoj transakciji. `status` kroz `PATCH`: `ACTIVE ↔ CANCELLED`; `EXPIRED` postavlja
sistem, `ARCHIVED` je arhiva evidencije.

### 2.7 Servisi (`/services`)

**Implementirano — prva cjelina Faze 4:**

| Metoda | Put | Permisija | Napomena |
|---|---|---|---|
| GET | `/services` | `service:view` | `vehicleId`, `status`, `serviceType`, `q` (vrsta/radionica/opis), paginacija; sortiranje `serviceDate`, `totalCost`, `createdAt`, `serviceType`; default datum opadajuće, stabilni ID kao drugi ključ |
| GET | `/services/:id` | `service:view` | pregled osnovne evidencije; nepostojeći/soft-delete → `404 NOT_FOUND` |
| PATCH | `/services/:id` | `service:update` | potpuna CAS izmjena datuma/km/rokova i opisnih polja; detalji u §7.4 |
| DELETE | `/services/:id` | `service:delete` | soft-delete uz zaključano vozilo i ponovni obračun rokova; `204`; detalji u §7.4a |

Odgovor liste: `{items, page, pageSize, total, totalPages}`; zapis nosi
`formSchemaId`, `formSchemaVersionId`, `version`, datum, kilometražu, vrstu,
radionicu, opis, trošak u feningama i sljedeći rok (datum/km). Bez mutacija.
Stavke računa i puna dinamička forma još nisu dio odgovora pregleda.
`POST /services` je naknadno implementiran; ugovor i transakcija su u §7.2.

**Planirano u narednim cjelinama (nije još dostupno):**

Zasebni endpointi po jednoj stavci računa,
`POST /services/:id/attachments`. Pri kreiranju se opciono upisuje `OdometerReading` (ista
transakcija) i ažurira `Vehicle.nextServiceDue*`.

### 2.8 Gume (`/tire-sets`, `/tires`, `/tire-installations`)

| Metoda | Put | P |
|---|---|---|
| GET/POST | `/tire-sets` | `tire:view/create` |
| GET/PATCH/DELETE | `/tire-sets/:id` | `tire:view/update/delete` |
| GET/POST | `/tire-sets/:id/tires` | `tire:view/create` |
| GET | `/tire-installations?vehicleId=&setId=&active=true` | `tire:view` |
| POST | `/tire-installations` `Idem` | `tire:mount` — `409 TIRE_ALREADY_MOUNTED` ako je set već montiran |
| POST | `/tire-installations/:id/dismount` | `tire:dismount` — računa `daysInUse`/`kmDriven` |
| POST | `/tire-installations/swap` `Idem` | `tire:swap` — demontaža + montaža u jednoj transakciji |
| GET | `/tire-sets/:id/usage` | `tire:view` — ciklusi po vozilima |

### 2.9 Forme (`/form-schemas`, `/form-migrations`)

Detalji engine-a: `04-FORM_ENGINE.md` §8–§12. Sve rute traže `form:*` permisiju.

| Metoda | Put | P | Napomena |
|---|---|---|---|
| GET | `/form-schemas?subject=&status=&q=` | `form:view` | lista; `status` filtrira po stanju **verzije** |
| GET | `/form-schemas/active?subject=&taskTypeId=` | `form:view` | aktivna objavljena verzija; `ETag` = `"<contentHash>"` |
| POST | `/form-schemas` | `form:create` | kreira formu + **prvu `DRAFT`** verziju; audit `CREATE` |
| GET | `/form-schemas/:id` | `form:view` | detalji + sve verzije (`recordCount` po verziji) |
| PATCH | `/form-schemas/:id` | `form:update` | naziv, opis, `taskTypeId`, `ownerModule`; audit `UPDATE` |
| POST | `/form-schemas/:id/versions` | `form:update` | novi `DRAFT` (`copyFromVersionId` ili `definition`) |
| GET | `/form-schemas/:id/versions/:vid` | `form:view` | definicija; `ETag` = `"<contentHash>"`, `If-None-Match` → `304` |
| PUT | `/form-schemas/:id/versions/:vid` | `form:manage_schema` | samo `DRAFT` (inače `409 FORM_VERSION_IMMUTABLE`) |
| DELETE | `/form-schemas/:id/versions/:vid` | `form:manage_schema` | samo `DRAFT`; `204` |
| POST | `/form-schemas/:id/versions/:vid/validate` | `form:view` | P11 validacija `{ values, isNew }` → greške po polju |
| POST | `/form-schemas/:id/versions/:vid/publish` | `form:publish_version` | `{ changeNote, allowWebOnly?, confirmNormalizedRemoval? }`; audit `FORM_PUBLISH` |
| POST | `/form-schemas/:id/versions/:vid/retire` | `form:retire_version` | `{ changeNote }`; aktivna verzija samo ako postoji druga objavljena; audit `FORM_RETIRE` |
| GET | `/form-schemas/:id/diff?from=&to=` | `form:view` | strukturni diff dvije verzije (dodano/uklonjeno/izmijenjeno) |
| GET | `/form-migrations?formSchemaId=` | `form:view` | lista migracija (najnovije prve) |
| POST | `/form-migrations` | `form:migrate_records` | P12: `{ formSchemaId, fromVersionId, toVersionId, targetEntityType, entityIds?, filter?, notes? }` → `PENDING` |
| GET | `/form-migrations/:id` | `form:view` | stanje + summary + uzorak stavki |
| POST | `/form-migrations/:id/preview` | `form:migrate_records` | računa `before/after` po zapisu; **ništa ne mijenja** |
| POST | `/form-migrations/:id/apply` | `form:migrate_records` | `{ changeNote }`; batch 500 u transakciji; audit `FORM_MIGRATE` |
| POST | `/form-migrations/:id/rollback` | `form:migrate_records` | `{ changeNote, entityIds? }`; vraća `before`, audit `FORM_MIGRATE` |

**Objava (P9):** `422 FORM_VALIDATION_FAILED` s `details[].path` i `extra.issues[]` dok ne prođe svih
9 provjera iz `04` §8 (uključujući `CHANGE_NOTE_REQUIRED` za bilješku kraću od 5 znakova i
`NORMALIZED_FIELD_REMOVED` kad se uklanja mapirano polje bez potvrde). Uspješna objava u jednoj
transakciji: prethodna `PUBLISHED` → `RETIRED`, nova → `PUBLISHED` (+ `contentHash`), forma pokazuje
na novu verziju, registar ključeva (`FieldKeyRegistry`, U-16) se dopunjava.

**Keširanje:** `contentHash` objavljene verzije se nikad ne mijenja, pa `ETag` smije biti trajan;
`304` nema tijelo i ne prolazi kroz envelope.

### 2.10 Vrste zadataka (`/task-types`)

`GET/POST /task-types`, `GET/PATCH /task-types/:id`, `POST /task-types/:id/archive`,
`GET/PUT /task-types/:id/completion-requirements`.

### 2.11 Zadaci (`/tasks`) — najkritičniji modul

| Metoda | Put | P | Napomena |
|---|---|---|---|
| GET | `/tasks` | `task:view` / `task:view_all` | filteri: `status`, `vehicleId`, `taskTypeId`, `assigneeUserId`, `createdById`, `dueAt`, `priority`, `mine=true` |
| POST | `/tasks` `Idem` | `task:create` | snapshot aktivne verzije forme + outbox `TASK_CREATED` |
| GET | `/tasks/:id` | `task:view` (+ scope) | uključuje `assignments`, `events`, `attachments`, `comments`, `formSchemaVersion` |
| PATCH | `/tasks/:id` | `task:update` | samo dok je `OPEN` (ili admin) |
| **POST** | **`/tasks/:id/claim`** `Idem` | `task:claim` | **atomski**; `409 TASK_ALREADY_CLAIMED` s `{assignee: {name, claimedAt}}` ako korisnik ima pravo vidjeti |
| POST | `/tasks/:id/complete` `Idem` | `task:complete` (izvršilac) ili `task:complete_override` | `{formValues, attachmentIds, comment, odometerKm?}` |
| POST | `/tasks/:id/cancel` | `task:cancel` | `{reason}` obavezno |
| POST | `/tasks/:id/reopen` | `task:reopen` | auditovan |
| POST | `/tasks/:id/release` | `task:release` | vraća među slobodne + obavijest pozvanima |
| POST | `/tasks/:id/assign` | `task:assign` | `{userIds[], mode}` |
| GET/POST | `/tasks/:id/comments` | `task:view` / `task:comment` | |
| POST | `/tasks/:id/attachments` | `attachment:upload` | |
| GET | `/tasks/:id/events` | `task:view` | historija (immutabilna) |
| GET | `/tasks/available` | `task:claim` | samo zadaci koje korisnik **smije** preuzeti |

**Odgovor na `409` pri claim-u:**
```jsonc
{ "error": { "code": "TASK_ALREADY_CLAIMED",
  "message": "Zadatak je preuzeo Emina H. prije 12 minuta.",
  "details": { "assigneeName": "Emina H.", "claimedAt": "2026-10-19T09:29:10Z", "taskId": "…" },
  "requestId": "…" } }
```

### 2.12 Prilozi (`/attachments`)

| Metoda | Put | P | Napomena |
|---|---|---|---|
| POST | `/attachments` (multipart) `Idem` | `attachment:upload` | vraća `{id, sha256, sizeBytes, mimeType}`; magic-byte provjera |
| POST | `/attachments/complete` | `attachment:upload` | vezuje upload na vlasnika (`ownerType/ownerId/stage/fieldKey`) |
| GET | `/attachments/:id` | `attachment:view` | metapodaci |
| GET | `/attachments/:id/content` | `attachment:view` | stream uz provjeru; `Content-Disposition: attachment` |
| GET | `/attachments?ownerType=&ownerId=&page=` | `attachment:view` | lista priloga jednog zapisa; bez `ALL` opsega samo vlastiti upload-i |
| GET | `/attachments/:id/url` | `attachment:view` | potpisani URL (TTL `FILE_SIGNED_URL_TTL_SECONDS`) |
| GET | `/attachments/:id/content` | `attachment:view` | stream; `Content-Disposition: attachment`; audit `FILE_ACCESS` |
| GET | `/attachments/:id/content/:token` | **potpis (HMAC)** | jedina javna ruta modula — `<img>` bez `Authorization`; token = `exp.sig` nad `id|exp` |
| POST | `/attachments/:id/replace` | `attachment:upload` | nova verzija (stara ostaje u historiji, soft-delete) |
| DELETE | `/attachments/:id` | `attachment:delete` | soft delete (fajl ostaje na disku) |

Napomene (Faza 3):

- **Tip se određuje iz sadržaja**, ne iz `Content-Type` headera: JPEG/PNG/WEBP/PDF/HEIC
  (`ATTACHMENT_ALLOWED_MIME`). Nepoznat sadržaj → `415 UNSUPPORTED_MEDIA_TYPE`,
  prevelik fajl → `413 PAYLOAD_TOO_LARGE` (limit `ATTACHMENT_MAX_SIZE_MB`).
- **Metapodaci se uklanjaju prije spremanja** — JPEG `APPn`/`COM` i PNG `eXIf`/`tEXt`
  (GPS lokacija, ime uređaja); `exifStripped` govori da li je obrada stvarno urađena.
- **Idempotentnost:** `@@unique([ownerType, ownerId, sha256])` — ponovni upload istog
  sadržaja vraća postojeći zapis, ne duplikat.
- **`POST /attachments/complete`** prima `{ id, ownerType, ownerId, stage?, taskId?, formFieldKey? }`;
  do tada je prilog vezan na uploadera (`ownerType: OTHER`).
- **Pohrana:** host bind-mount (`VFM_STORAGE_CONTAINER_PATH`), ključ
  `YYYY/MM/<sha[0..2]>/<uuid>.<ext>`; fajl se **nikad** ne servira direktno s diska (B-15).

### 2.13 Obavijesti (`/notifications`)

| Metoda | Put | P |
|---|---|---|
| GET | `/notifications?unreadOnly=&page=` | `notification:view` |
| GET | `/notifications/unread-count` | `notification:view` |
| POST | `/notifications/read` `{ids[]}` | `notification:mark_read` |
| POST | `/notifications/read-all` | `notification:mark_read` |
| DELETE | `/notifications/:id` | `notification:view` |
| GET | `/notifications/stream` (SSE) | `notification:view` — real-time za web |
| GET/PUT | `/notifications/preferences` | `notification:manage_preferences` |
| POST | `/notifications/broadcast` | `notification:broadcast` |
| POST | `/devices/tokens` `{token, platform, appVersion, deviceModel}` | 🔒 — registracija FCM tokena (hash + unique) |
| DELETE | `/devices/tokens/:id` | 🔒 — deregistracija pri logoutu |
| GET | `/devices/tokens` | `user:view` (admin pregled) |

### 2.14 Podsjetnici (`/reminders`)

| Metoda | Put | P |
|---|---|---|
| GET | `/reminders` | `reminder:view` — `?page&pageSize&kind&status&entityType&entityId&dueWithinDays` |
| POST | `/reminders/:id/acknowledge` | `reminder:acknowledge` — idempotentno (`ACKNOWLEDGED`) |
| POST | `/reminders/:id/snooze` `{days 1–90}` | `reminder:snooze` — pomjera `fireAt`, status `SNOOZED` |
| GET | `/reminders/policies` | `reminder:manage_policies` |
| PUT | `/reminders/policies/:kind` | `reminder:manage_policies` — `SETTINGS_CHANGE` u auditu |
| POST | `/reminders/scan` | `system:run_maintenance` — ručno pokretanje skenera |

**P-07 idempotentnost:** `ScheduledReminder.dedupeKey` =
`{kind}:{entityType}:{entityId}:{dueDate|dueKm}:{threshold}` je unique, a skener piše kroz
`createMany({ skipDuplicates: true })`. Drugo pokretanje (ručno + cron) vraća `created: 0`.

**Raspored:** worker dodaje repeatable job `reminder-scan` (`schedulerId:
reminder-scan-daily`) s cronom `0 6 * * *` i `tz: Europe/Sarajevo`; `fireAt` je 06:00 lokalno na
dan `dueDate − threshold` (CET/CEST se računa iz zone, ne fiksno +1). Polise bez reda u
`ReminderPolicy` se preskaču — default prag (5 dana) se primjenjuje kad politika postoji, a
`thresholdsDays` je prazan.

### 2.15 Izvještaji (`/reports`)

| Metoda | Put | P |
|---|---|---|
| GET | `/reports` | `report:view` — lista definicija |
| GET | `/reports/:code` | `report:view` — podaci (JSON, paginirano) |
| POST | `/reports/:code/export` `{format, filters}` | `report:export` — ≤ `REPORT_EXPORT_SYNC_MAX_ROWS` → direktno; inače `ExportJob` + `202 Accepted` |
| GET | `/reports/exports` · `/reports/exports/:id` | `report:export` — Download centar |
| GET | `/reports/dashboard` | `auth:login` — KPI za nadzornu ploču |
| GET/POST/PATCH/DELETE | `/reports/definitions[/:id]` | `report:manage_definitions` |

### 2.16 Audit, postavke, sistem

```
GET  /audit-logs                     audit:view      (filteri: actorId, action, entityType, entityId, severity, from, to) ✅
GET  /audit-logs/:id                 audit:view      (before/after diff) ✅
POST /audit-logs/export              audit:export    ⏳ Faza 7 (xlsx/pdf pipeline)
GET  /settings                       settings:view   (javne + one s pravom)
PUT  /settings/:key                  settings:update (+ audit SETTINGS_CHANGE)
GET  /lists · /lists/:code/items     settings:view   (šifarnici)
POST /lists · /lists/:code/items     settings:manage_lists
GET  /health/live · /health/ready · /health/startup   javno (bez tajni)
GET  /system/queue                   system:view_queue   (queue depth, failed, DLQ)
GET  /system/metrics                 system:view_metrics (Prometheus tekst)
POST /system/maintenance/:job        system:run_maintenance
```

**Audit log — semantika (Faza 1):** `AuditLog.id` je `BIGINT` pa se u JSON-u
vraća kao **string** (bez gubitka preciznosti); `before`/`after`/`metadata` samo
na detalju. `SECURITY` redovi (prijave, odbijanja, promjene prava) traže
`audit:view_security` — bez njega se ne vraćaju (`securityHidden: true`), a
eksplicitan `?severity=SECURITY` daje praznu stranicu umjesto „sve ostalo".
Tabela je immutabilna (DB trigger), pa API nema `PATCH`/`DELETE` nad zapisima.

---

## 3. Primjeri ključnih poziva

### 3.1 Login (mobilna)
```http
POST /api/v1/auth/login
{ "email": "damir@example.ba", "password": "…", "clientType": "MOBILE_ANDROID",
  "deviceInfo": { "model": "Pixel 7", "osVersion": "15", "appVersion": "1.0.0" } }
```
`200` →
```json
{ "data": {
    "accessToken": "eyJhbGciOi…", "tokenType": "Bearer",
    "expiresIn": 600, "refreshExpiresIn": 2592000, "sessionId": "…",
    "refreshToken": "RT-…",
    "user": {
      "id": "…", "email": "damir@example.ba", "firstName": "Damir", "lastName": "…",
      "displayName": null, "status": "ACTIVE",
      "roles": [{ "id": "…", "code": "ADMINISTRATOR", "name": "Administrator" }],
      "permissions": ["task:view", "task:create", "vehicle:view"],
      "permissionsVersion": 1, "tokenVersion": 4,
      "mustChangePassword": false, "isSuperAdmin": false,
      "allowedClientTypes": ["WEB", "MOBILE_ANDROID"],
      "timezone": "Europe/Sarajevo", "locale": "bs", "lastLoginAt": "2026-10-20T06:12:33.412Z"
    } } }
```
`refreshToken` je u tijelu **samo** za `MOBILE_ANDROID`/`MOBILE_IOS`; web ga dobija kroz
`Set-Cookie: vfm_refresh=…; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth` i polja nema u
odgovoru (XSS ne smije doći do refresh tokena — docs/05 §5.2).
Super Admin → `403 MOBILE_ACCESS_FORBIDDEN` (+ `AuditLog` severity `SECURITY`).
Nedozvoljeni tip klijenta za rolu → `403 MOBILE_SCOPE_NOT_ALLOWED`.
Treća pogrešna lozinka (default `AUTH_MAX_FAILED_ATTEMPTS=5`) → `423 ACCOUNT_LOCKED` + `Retry-After`.

### 3.2 Kreiranje zadatka
```http
POST /api/v1/tasks
Idempotency-Key: 7b1f…-uuid
{
  "vehicleId": "…", "taskTypeId": "…", "title": "Pranje vozila",
  "description": "Vanjsko i unutrašnje pranje", "priority": "NORMAL",
  "assignMode": "OPEN_CLAIM", "invitedUserIds": ["…","…"],
  "dueAt": "2026-10-19T16:00:00Z",
  "formValues": { "washType": "FULL", "photosAfter": ["<attachmentId>"] }
}
```
`201` → `{ "data": { "id": "…", "code": "Z-2026-0118", "status": "OPEN",
"formSchemaVersionId": "…", "formSchemaVersion": 3, "assignments": […], "createdAt": "…" } }`

### 3.3 Preuzimanje (atomski)
```http
POST /api/v1/tasks/2f1c…/claim
Idempotency-Key: 9c2a…-uuid
```
`200` → `{ "data": { "id": "…", "status": "IN_PROGRESS", "assigneeUserId": "…", "claimedAt": "…", "version": 4 } }`
`409` → `TASK_ALREADY_CLAIMED` (§2.11)

### 3.4 Završetak
```http
POST /api/v1/tasks/2f1c…/complete
Idempotency-Key: 5d77…-uuid
{ "formValues": { "washType": "FULL", "washDurationMin": 45 },
  "attachmentIds": ["…"], "comment": "Felge očišćene", "odometerKm": 148230 }
```
`200` → `{ "data": { "status": "COMPLETED", "completedAt": "2026-10-19T14:32:11Z",
"durationMinutes": 130 } }`
`403 NOT_ASSIGNEE` ako nije izvršilac (i nema `complete_override`).

---

## 4. SSE tok obavijesti (web)

```http
GET /api/v1/notifications/stream
Authorization: Bearer <access>
Accept: text/event-stream
```
```
event: notification
data: {"id":"…","type":"TASK_CLAIMED","title":"Emina je preuzela zadatak","linkToType":"TASK","linkToId":"…"}

event: unread-count
data: {"count":3}

: keepalive (svakih 25 s)
```
Fan-out: `worker`/`api` publikuje na Redis kanal `vfm:sse:{userId}`; API instanca pretplaćena na
kanale svojih povezanih klijenata. Reconnect: `Last-Event-ID` = `notification.id`.

---

## 5. Rate limit profili

| Profil | Limit | Primjena |
|---|---|---|
| `global` | `THROTTLE_GLOBAL_LIMIT` / `THROTTLE_GLOBAL_TTL_SECONDS` po korisniku | svi endpointi |
| `login` | 5 / 15 min po **IP-u** (`vfm:rl:login:ip-…`) | `/auth/login` (i `/auth/forgot-password` kad bude implementiran) |
| `upload` | 30 / min po korisniku | `/attachments` |
| `export` | 5 / 15 min po korisniku | `/reports/*/export`, `/audit-logs/export` |
| `claim` | 60 / min po korisniku | `/tasks/*/claim` (zaštita od skripti) |

Odgovor: `429` + `Retry-After: <sekunde>` + `{ "error": { "code": "RATE_LIMITED", … } }`.

---

## 6. OpenAPI i klijenti

- Swagger JSON: `/api/v1/docs-json` (kad je `SWAGGER_ENABLED=true`).
- `packages/api-client` generiše tipove iz `@vfm/shared` Zod šema (jedan izvor), ne iz OpenAPI-ja →
  nema drifta; OpenAPI se generiše iz istih šema radi dokumentacije.
- Mobilna i web koriste isti klijent (fetch adapter za web, `expo` fetch za mobilnu).

---

## 7. Checklist za svaki novi endpoint

- [ ] Permisija postoji u katalogu (`packages/shared`) i seedovana je u DB.
- [ ] `@RequirePermissions()` + scope provjera.
- [ ] Zod DTO iz `@vfm/shared` (nema inline šema).
- [ ] Audit (ako je mutacija ili pristup PII/prilogu).
- [ ] Outbox događaj (ako nastaje obavijest).
- [ ] Transakcija (ako piše u više tabela).
- [ ] Paginacija/filteri/sortiranje + whitelist kolona.
- [ ] Swagger dekoratori (`@ApiOperation`, `@ApiResponse`, primjeri).
- [ ] Testovi: happy path + 401 + 403 + 422 + (409 ako ima stanja).
- [ ] Ako uvodi novu env varijablu → `.env.example`; ako dira Redis → `REDIS_ACL.md`.

### 7.1 Provjera pregleda servisa — prva cjelina Faze 4

`GET /services` i `GET /services/:id`: postojeća `service:view`, zajednički
Zod DTO i UUID validacija, whitelist sortiranja, stabilna paginacija i
`deletedAt: null`. Globalni auth/RBAC guardovi ostaju obavezni. Nema mutacija,
PII, novih ENV/Redis ključeva, outbox događaja niti novih migracija.
Jedinični testovi i Nest DI provjera prolaze; produkcijski HTTP smoke-test
sa stvarnom bazom i korisničkim permisijama nije izvršen u sandboxu.

### 7.2 Unos servisa — druga cjelina Faze 4

Implementiran `POST /services` uz `service:create` i audit `CREATE` (`ServiceRecord`).
Tijelo: `vehicleId`, `serviceDate` (ne u budućnosti), `serviceType`, `totalCost`
(feninzi); opciono `workshopName`, `description`, `odometerKm`,
`nextServiceDueDate`, `nextServiceDueKm`, `formData`, `formSchemaVersionId`.
Nova evidencija zahtijeva objavljenu SERVICE formu; seed idempotentno dodaje
`servis_vozila`, bez izmjene postojećih objavljenih verzija.

Vozilo se zaključava `SELECT … FOR UPDATE` u transakciji: provjera trenutne km,
servis, `OdometerReading.source=SERVICE` s referencom, ažuriranje km/roka/verzije
vozila. Manja km → `422 ODOMETER_REGRESSION`; korekcija ide kroz zaseban auditovani
endpoint vozila, ne kroz servis. Arhivirana vozila odbijaju unos. Rok se uzima iz
najnovijeg aktivnog servisa po datumu, vremenu unosa i ID-u, pa historijski servis
ne prepisuje rok novijeg. Bez km nema očitanja niti promjene kilometraže.
Nema novih ENV, Redis ključeva ni migracija. Jedinični testovi nisu dokaz
konkurencije/rollbacka na pravom PostgreSQL-u; taj smoke-test još nije izvršen.

### 7.3 Stavke računa servisa — Faza 4

| Metoda | Put | Permisija | Ugovor |
|---|---|---|---|
| GET | `/services/:id/items` | `service:view` | `{version, totalCost, items[]}`; soft-delete → 404 |
| PUT | `/services/:id/items` | `service:update` | atomska zamjena svih stavki, audit UPDATE prije/poslije |

PUT prima `{version, items[]}`. Stavka: `kind` (`PART/LABOR/FLUID/OTHER`),
`name`, `quantityHundredths` (1–1000000), `unitPrice` (feninzi), opciono
`partNumber`, `notes`. Najviše 100 stavki. Odgovor: `{id, version, totalCost}`.
GET dodaje ID i izračunati `totalPrice` za svaku stavku. Količina je u stotinkama
(npr. 150 = 1,50); svaka stavka se zaokružuje na najbliži fening, pola naviše.
Zbir ne smije prekoračiti 2147483647 feninga.

CAS (`id`, `version`, `deletedAt`, aktivni status i nearhivirano vozilo) u istoj
transakciji povećava verziju, mijenja stavke, zbir i `formData` tačne zapisne
verzije (dozvoljena RETIRED forma, P10). Konflikt → `409 VERSION_CONFLICT`,
nepostojeći servis → 404, neaktivna evidencija/arhivirano vozilo → validacijska
greška. PART i FLUID ulaze u `partsCost`, LABOR u `laborCost`, OTHER samo u zbir.
Prazna lista namjerno postavlja zbir na nulu. Ne mijenja km niti rok vozila.
Zasebni POST/PATCH/DELETE endpointi po stavci iz §2.7 nisu implementirani;
uređivanje ide kroz ovu verzionisanu zamjenu cijelog računa.

Nema novih ENV/Redis ključeva ni migracija. Jedinični i DI testovi su dodani;
HTTP smoke-test sa stvarnom bazom i konkurentnim upisima nije izvršen u sandboxu.

### 7.4 Potpuna izmjena servisa — Faza 4

`PATCH /services/:id` uz `service:update`, audit `UPDATE` prije/poslije.
Tijelo: `version` i barem jedno od `serviceDate`, `serviceType`,
`workshopName`, `description`, `odometerKm`, `nextServiceDueDate` ili
`nextServiceDueKm`. Radionica/opis i km/rokovi mogu se obrisati s `null`.
Odgovor je osnovna servisna evidencija kao na GET-u. Strict DTO i dalje
odbija `totalCost`, vozilo, status i verziju forme; trošak mijenjaju samo
stavke računa iz §7.3.

Čitanje, validacija zapisne forme (uključujući RETIRED), sinhronizacija
mapiranih osnovnih polja u `formData` i CAS upis su u istoj transakciji.
Kad se mijenja datum/km/rok, vozilo se zaključava `FOR UPDATE`; efektivni
datum ne smije biti u budućnosti, sljedeći datum ne smije prethoditi servisu,
a sljedeća km ne smije biti manja od km ovog servisa. CAS provjerava verziju,
soft-delete, aktivni servis i nearhivirano/neobrisano vozilo. Zastarjela
verzija → 409, nepostojeći/obrisan zapis → 404, neaktivna evidencija ili
arhivirano vozilo → validacijska greška.

PATCH ne zaobilazi zasebnu korekciju kilometraže vozila: promijenjena km
servisa manja od zaključane trenutne km vozila → `422 ODOMETER_REGRESSION`.
Snapshot se smije spustiti na već zasebno korigovanu trenutnu vrijednost bez
novog očitanja. Ako veća km servisa podiže trenutnu km vozila, u istoj
transakciji nastaje novo `OdometerReading` (`SERVICE`, referenca na servis),
bez prepisivanja historije očitanja. Brisanje km sa servisa ne mijenja i ne
briše trenutnu/historijsku kilometražu vozila. Nakon upisa se
`Vehicle.nextServiceDue*` ponovo računa iz najnovijeg aktivnog servisa po
datumu, vremenu unosa i ID-u; verzija vozila raste samo ako se njegova
denormalizovana km ili rok stvarno promijeni. Audit nosi servis prije/poslije
i, za izmjene rasporeda, snapshot vozila prije/poslije u metapodacima.
Nema novih migracija/ENV/Redis ključeva. Provjera sa stvarnom bazom nije
izvršena iz sandboxa.

### 7.4a Brisanje servisa — Faza 4

`DELETE /services/:id` uz osjetljivu `service:delete` permisiju vraća `204`
bez tijela i piše audit `DELETE`/`CRITICAL` prije/poslije, uz snapshot vozila
u metapodacima. Zahtjev nema tijelo ni klijentsku verziju. Brisanje je
soft-delete (`deletedAt`, verzija zapisa +1), pa zapis i njegove stavke ostaju
u bazi, ali ih pregled, detalj i endpointi stavki više ne vraćaju.

Transakcija prvo zaključava vozilo, zatim CAS-om na učitanoj verziji briše
zapis. Konkurentna izmjena → `409 VERSION_CONFLICT` i zahtjev se ponavlja
nakon ponovnog učitavanja; nepostojeći ili konkurentno obrisani zapis →
`404 NOT_FOUND`; obrisano/arhivirano vozilo → validacijska greška. Status
same servisne evidencije ne blokira brisanje.

Ako je obrisani zapis bio `ACTIVE`, `Vehicle.nextServiceDue*` se u istoj
transakciji ponovo računa iz najnovijeg preostalog aktivnog servisa po datumu,
vremenu unosa i ID-u; bez preostalog aktivnog servisa oba roka postaju
`null`. Verzija vozila raste samo ako se rok stvarno promijeni. Neaktivni
zapis ne pokreće ponovni obračun. Historija očitanja i trenutna kilometraža
vozila se ne mijenjaju — niža trenutna km ostaje zasebna auditovana korekcija.
Nema novih migracija/ENV/Redis ključeva. Provjera sa stvarnom bazom nije
izvršena iz sandboxa.

### 7.5 Gume — kompleti, pojedinačne gume i ciklusi montaže

Implementirani su:

| Metoda i ruta | Permisija | Ugovor |
|---|---|---|
| `GET /tire-sets` | `tire:view` | lista neobrisanih kompleta `{items,page,pageSize,total,totalPages}` |
| `POST /tire-sets` | `tire:create` | unos kompleta kroz objavljenu `TIRE_SET` formu; audit `CREATE` na `TireSet` |
| `GET /tire-sets/:id` | `tire:view` | detalj kompleta i `formData`; lista `formData` ne vraća |
| `GET /tire-sets/:id/tires` | `tire:view` | pojedinačne gume kompleta `{items}`, bez paginacije |
| `GET /tire-sets/:id/usage` | `tire:view` | sažetak, agregati po vozilima i svi ciklusi kompleta |
| `POST /tire-sets/:id/tires` | `tire:create` | transakcijski unos pojedinačne gume; audit `CREATE` na `Tire` |
| `PATCH /tire-sets/:id` | `tire:update` | zaključana CAS izmjena strukturiranih podataka, ručnog statusa i opcionalnog `formData`; audit `UPDATE` |
| `DELETE /tire-sets/:id` | `tire:delete` | soft-delete kompleta i povezanih guma, `204`; audit `DELETE`/`CRITICAL` |
| `GET /tire-installations` | `tire:view` | historija montaža, kako je opisano niže |
| `POST /tire-installations` | `tire:mount` | transakcijska montaža kroz objavljenu `TIRE_INSTALLATION` formu; audit `CREATE` |
| `POST /tire-installations/:id/dismount` | `tire:dismount` | transakcijska demontaža uz `version`; audit `UPDATE` |
| `POST /tire-installations/swap` | `tire:swap` | demontaža starog i montaža novog kompleta u jednoj transakciji; audit `UPDATE` |

`GET /tire-sets` prihvata standardnu paginaciju te `q`, `season`, `status` i
`availableOnly=true|false`. Pretraga obuhvata kod, proizvođača, model,
dimenziju i lokaciju bez razlikovanja velikih/malih slova. Samo
`availableOnly=true` dodatno zahtijeva `IN_STOCK` i nijednu aktivnu montažu.
Sort whitelist je `code`, `brand`, `purchaseDate`, `purchasePrice`, `createdAt`;
default je kod uzlazno, a ID je stabilni drugi ključ. Zapis nosi strukturirane
podatke kompleta, `version`, ID-jeve forme/verzije i — ako postoji aktivna
montaža — ID, interni broj i registarsku oznaku vozila.

`POST /tire-sets` ima strict DTO: obavezan `code` (1–60 znakova) i `season`,
opcionalni proizvođač/model/dimenzija, `tireCount` 1–8 (default 4), datum i
cijena nabavke u feningama, lokacija, napomena, `formSchemaVersionId` i
`formData`. Status se **ne** može zadati zahtjevom: novi zapis uvijek dobija
`IN_STOCK` i valutu `BAM`. Datum nabavke ne smije biti u budućnosti.
Jedinstvenost aktivnog koda provjerava se prije upisa, a konkurentno kršenje
jedinstvenog indeksa takođe se vraća kao `409 DUPLICATE_ENTRY`. Nov zapis mora
koristiti objavljenu `TIRE_SET` verziju; bez eksplicitnog ID-ja bira se
trenutno objavljena. Za ovaj subject nema normalizacijskog mapiranja u kolone,
pa forma nosi dodatne podatke, dok zapis pamti tačne `formSchemaId`,
`formSchemaVersionId` i validirani `formData`. Idempotentni seed osigurava
početnu formu `komplet_guma`; bez nje/objavljene zamjene unos nije moguć.

`GET /tire-sets/:id` vraća isti strukturirani pogled kao lista, vozilo
aktivne montaže ako postoji te `formData`. Soft-obrisan ili nepostojeći
komplet vraća `404 NOT_FOUND`.

`PATCH /tire-sets/:id` ima strict DTO s obaveznim `version` i najmanje jednom
izmjenom među `code`, `brand`, `model`, `size`, `season`, `tireCount`,
`purchaseDate`, `purchasePrice`, `currentLocation`, `notes`, `status` i
`formData`. Cijena je i dalje cijeli broj feninga, a opcionalna tekstualna,
datumska i novčana polja prihvataju `null` za brisanje vrijednosti. Datum
nabavke ne smije biti u budućnosti ni nakon prve montaže kompleta.
Transakcija prvo zaključava red kompleta (`FOR UPDATE`), provjerava verziju i
duplikat aktivnog koda, pa radi CAS upis. Zastarjela verzija vraća
`409 VERSION_CONFLICT` s `currentVersion`, duplikat
`409 DUPLICATE_ENTRY`. Montiran komplet smije dobiti opisnu ispravku, ali
ručna promjena statusa vraća `409 TIRE_ALREADY_MOUNTED`, a `tireCount` ne
smije pasti ispod broja aktivnih pozicija ni broja već evidentiranih
pojedinačnih guma.

Ručni `status` prihvata samo `IN_STOCK`, `IN_REPAIR`, `RETIRED` i
`SCRAPPED`; `MOUNTED` postavlja isključivo montaža. Dozvoljene su promjene
`IN_STOCK ↔ IN_REPAIR`, iz oba u `RETIRED`/`SCRAPPED` te iz `RETIRED` u
`IN_STOCK`/`IN_REPAIR`/`SCRAPPED`. `SCRAPPED` je terminalan. Ako zapis
nekonzistentno nosi `MOUNTED` bez aktivne montaže, smije se ispraviti u bilo
koji ručni status. Promjena statusa u istoj transakciji sinhronizuje sve
neobrisane pojedinačne gume kompleta.

Forma se pri izmjeni uvijek validira zapisnom `formSchemaVersionId`,
uključujući `RETIRED` verziju; PATCH nikad ne prevodi zapis na novu formu.
Poslani `formData` je dopuna postojećem, a efektivne strukturirane
vrijednosti se uklapaju prije validacije. Ako zapis nema zapisnu verziju,
strukturirana izmjena je dozvoljena, ali slanje `formData` vraća validacijsku
grešku.

`DELETE /tire-sets/:id` nema tijelo zahtjeva. Pod zaključanim redom kompleta
aktivna montaža vraća `409 TIRE_ALREADY_MOUNTED`, a status `MOUNTED` bez
aktivne montaže takođe blokira brisanje radi očuvanja konzistentnosti.
Inače se u jednoj transakciji postavljaju `deletedAt` i nova verzija na
kompletu te `deletedAt` na svim njegovim neobrisanim gumama. Historija
montaža se ne briše. Odgovor je `204 No Content`.

`GET /tire-sets/:id/tires` vraća `{items}` s neobrisanim gumama samo tog
kompleta; komplet je mali ograničen skup, pa nema paginacije. Nepostojeći ili
soft-obrisan komplet vraća `404 NOT_FOUND`. Redoslijed je kanonski
`FL`, `FR`, `RL`, `RR`, `SPARE`, zatim gume bez pozicije prema vremenu unosa.
Pogled nosi serijski broj, DOT, sedmicu/godinu proizvodnje, poziciju, status,
datum i cijenu nabavke u feningama te napomenu. Dubina profila je
`treadDepthTenthsMm`, cijeli broj desetinki milimetra (`75` = 7,5 mm), da
ugovor ne zavisi od decimalnog zapisa baze.

`POST /tire-sets/:id/tires` ima strict DTO s najmanje jednim stvarnim
podatkom među `serialNumber`, `dot`, `productionWeek` (1–53),
`productionYear` (1900–2100), `position`, `treadDepthTenthsMm` (0–9999),
`purchaseDate`, `purchasePrice` i `notes`. `setId`, `status` i `formData` se
ne primaju: pripadnost određuje ruta, pojedinačna guma nema dinamičku formu,
a status izvodi server. Datum nabavke ne smije biti u budućnosti ni prije
godine proizvodnje kad su oba podatka poslana. Transakcija zaključava red
kompleta, pa istovremeno provjerava da broj zapisa ne prelazi deklarisani
`tireCount` i da aktivna pozicija nije već zauzeta. Zauzeta pozicija,
uključujući konkurentno kršenje djelimično jedinstvenog indeksa, vraća
`409 DUPLICATE_ENTRY`. Ako komplet ima aktivnu montažu, guma na aktivnoj
poziciji dobija `MOUNTED`, a ostale `IN_STOCK`; bez aktivne montaže status
prati komplet, pri čemu se nekonzistentan `MOUNTED` kompleta za novu gumu
tretira kao `IN_STOCK`. Odgovor je kreirani `TireView`. Izmjena i brisanje
pojedinačne gume nisu dio ove cjeline.

`GET /tire-sets/:id/usage` vraća `{set,summary,vehicles,cycles}` za
neobrisan komplet; nepostojeći ili soft-obrisan komplet je
`404 NOT_FOUND`, a obrisani ciklusi se isključuju. `cycles` su svi ciklusi
tog kompleta od najnovije montaže i nose vozilo (interni broj i registarsku
oznaku), datume i kilometraže montaže/demontaže, pozicije, razlog, skladište
te `isActive`. `summary` daje ukupne, završene i aktivne cikluse, broj
različitih vozila, ukupne km/dane i prvu/posljednju montažu. `vehicles` iste
brojače grupiše po vozilu i sortira po ukupnim km, zatim danima i zadnjoj
montaži. Ukupni km i dani sabiraju samo snapshot vrijednosti završenih
ciklusa koje nisu `null`; aktivan ciklus zadržava `null` brojače i ne procjenjuje se
iz trenutne kilometraže vozila. Agregat vozila za aktivni ciklus dodatno nosi
`activeSince` i kanonski sortirane aktivne pozicije.

Montaža ima strict DTO `{setId,vehicleId,mountedAt,mountedOdometerKm,
positions,formSchemaVersionId?,formData}`. Pozicije su 1–5 jedinstvenih
vrijednosti `FL|FR|RL|RR|SPARE` i ne smije ih biti više nego što komplet ima
guma. Datum ne smije biti u budućnosti ni prije nabavke kompleta. U transakciji
se redom zaključavaju vozilo i komplet (`FOR UPDATE`); vozilo mora postojati i
ne biti arhivirano, a komplet mora biti `IN_STOCK` i bez aktivne montaže.
Aktivna montaža istog kompleta ili zauzeta pozicija na vozilu vraća
`409 TIRE_ALREADY_MOUNTED` s vozilom/kompletom u `extra`, historijsko
preklapanje ciklusa `409 PERIOD_OVERLAP`, a niža kilometraža od trenutne
`422 ODOMETER_REGRESSION`. Isti upis postavlja komplet na `MOUNTED`, povezane
pojedinačne gume na odabranim pozicijama na `MOUNTED`, `OdometerReading`
izvora `TIRE`, denormalizovanu kilometražu vozila i outbox događaj
`TIRE_SET_MOUNTED`. Nov zapis mora koristiti objavljenu `TIRE_INSTALLATION`
verziju; seed osigurava formu `montaza_guma`, čiji se datum/km mapiraju u
normalizovane kolone.

Demontaža ima strict DTO `{version,dismountedAt,dismountedOdometerKm,reason?,
storageLocationOnDismount?}`; razlog je enum `SEASONAL_SWAP|DAMAGE|WEAR|SALE|
REPAIR`. Transakcija zaključava vozilo pa komplet, ponovo čita montažu i radi
CAS na `version` + `dismountedAt IS NULL`. Datum mora biti od montaže do danas,
a kilometraža ne smije biti manja ni od montaže ni od trenutnog stanja vozila.
`kmDriven` je razlika kilometara, a `daysInUse` broj proteklih kalendarskih
dana između datuma (isti dan = 0); oba ostaju snapshot završenog ciklusa.
Postojeća `formData` se validira zapisnom verzijom forme (i `RETIRED`), bez
prelaska na novu verziju. Komplet i povezane gume prelaze u `IN_REPAIR` za
razlog `REPAIR`, `RETIRED` za `SALE`, inače `IN_STOCK`; upisuju se očitanje
`TIRE`, kilometraža vozila i outbox `TIRE_SET_DISMOUNTED`. Demontaža je
dozvoljena i za arhivirano vozilo da se komplet može osloboditi.

Zamjena ima strict DTO `{vehicleId,currentInstallationId,currentVersion,
newSetId,swappedAt,odometerKm,positions,reason?,storageLocationOnDismount?,
formSchemaVersionId?,formData}` i odgovor `{dismounted,mounted}`. Nakon
zaključavanja vozila kompleti se zaključavaju sortirano po ID-ju. Prvo se
validiraju i stari i novi komplet (uključujući aktivnu montažu i pozicije,
uz izuzetak stare montaže koja se zatvara), pa se tek onda u istoj transakciji
stari ciklus zatvara, novi otvara, statusi kompleta/guma mijenjaju, upisuje
**jedno** `TIRE` očitanje i outbox `TIRE_SET_SWAPPED`. Greška u bilo kojem
koraku vraća cijelu zamjenu. Uz `Idempotency-Key` iz §1.4 globalni interceptor
vraća prvi `{dismounted,mounted}` odgovor bez drugog ciklusa. Bez zaglavlja
zaštita od duplog efekta ostaje stanje transakcije (aktivan komplet/pozicija,
CAS verzija i partial unique indeks), pa ponovljeni zahtjev ne pravi drugi
ciklus, ali dobija konflikt umjesto keširanog prvog odgovora.

Implementiran `GET /tire-installations` uz `tire:view`. Query: standardna
paginacija, `vehicleId`, `setId`, `q` (kod kompleta), `activeOnly=true|false`.
Samo `true` ograničava na `dismountedAt IS NULL`. Uvijek `deletedAt IS NULL`;
historija ostaje čitljiva i ako je komplet naknadno arhiviran/obrisan.
Sort whitelist: `mountedAt`, `dismountedAt`, `createdAt`; default montaža
opadajuće, ID kao stabilni drugi ključ. Odgovor `{items,page,pageSize,total,totalPages}`.
Zapis nosi komplet (kod, marka/model/dimenzija/sezona), datume i km montaže/
demontaže, pozicije, sačuvane `kmDriven`/`daysInUse`, skladište/razlog,
verziju i opcionu zapisnu verziju forme. Null brojači ostaju null; nema
računanja pretpostavljene kilometraže aktivne montaže.

Pregledi nisu mutacije i nemaju audit; unos, izmjena i brisanje kompleta te
ciklusi montaže imaju audit, a montaža/demontaža/zamjena pišu `OutboxEvent`
u istoj transakciji. Nema novih ENV/Redis ključeva niti migracija; postojeći
partial unique indeks aktivne montaže je DB zaštita. Evidencija
pojedinačnih guma i usage pregled iz §2.8 su implementirani; `PATCH`/`DELETE`
pojedinačne gume nisu dio ugovora. Globalni
auth/RBAC ostaje obavezan; produkcijski HTTP test i stvarna konkurencija nad
PostgreSQL-om nisu izvršeni u sandboxu.
