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
| 403 | `PERMISSION_DENIED`, `SCOPE_DENIED`, `NOT_ASSIGNEE`, `MOBILE_ACCESS_FORBIDDEN`, `MOBILE_SCOPE_NOT_ALLOWED`, `LAST_SUPER_ADMIN_PROTECTED`, `PII_ACCESS_DENIED`, `PASSWORD_CHANGE_REQUIRED` | autorizacija |
| 404 | `NOT_FOUND`, `ATTACHMENT_NOT_FOUND` | resurs ne postoji (ili nije u scope-u) |
| 409 | `TASK_ALREADY_CLAIMED`, `TASK_NOT_OPEN`, `VERSION_CONFLICT`, `DUPLICATE_ENTRY`, `PERIOD_OVERLAP`, `TIRE_ALREADY_MOUNTED`, `ODOMETER_REGRESSION` | sukob stanja |
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
| DELETE | `/auth/sessions/:id` | 🔒 `auth:manage_sessions` | revokacija jedne sesije + `tokenVersion++`; odgovor `{currentSessionRevoked}`; kad je to trenutna sesija briše se refresh cookie; tuđa sesija → `404 NOT_FOUND` |

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

**PII (B-20, R-07):** `phone`, `email`, `dateOfBirth`, `address`, `licenseNumber`, slobodni
`notes`/`restrictions`, `formData` i `photoAttachmentId` vraćaju se samo uz `driver:view_pii`
(Super Admin uvijek). Bez prava: e-mail `A***@example.ba`, telefon i broj dozvole `•••••123`,
datum rođenja, adresa, slobodni tekst, forma i foto-privitak se maskiraju ili izostavljaju (`null`/`{}`),
a odgovor nosi `piiRedacted: true`. Isto važi za `notes`/`restrictions` kategorija dozvole. Datum
isteka dozvole **nije** PII — nosi ga rok i podsjetnik.

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
| GET | `/form-schemas/options?listCode=` | `form:view` | aktivne stavke šifarnika u sortiranom redoslijedu za `LIST` polja |
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
| GET | `/form-migrations?formSchemaId=` | `form:migrate_records` | administrativna lista migracija (najnovije prve) |
| POST | `/form-migrations` | `form:migrate_records` | P12: `{ formSchemaId, fromVersionId, toVersionId, targetEntityType, entityIds?, filter?, notes? }` → `PENDING` |
| GET | `/form-migrations/:id` | `form:migrate_records` | administrativno stanje + summary + uzorak stavki (mogu sadržavati before/after podatke) |
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

| Metoda | Put | P | Napomena |
|---|---|---|---|
| GET | `/task-types` | `task_type:view` | paginirana konfiguracija; arhivirane vrste se ne vraćaju |
| POST | `/task-types` | `task_type:create` | nova vrsta; kod je trajno jedinstven |
| GET | `/task-types/:id` | `task_type:view` | detalj sa zahtjevima završetka |
| PATCH | `/task-types/:id` | `task_type:update` | djelimična izmjena bez `code` i statusa arhive |
| POST | `/task-types/:id/archive` | `task_type:archive` | soft-delete; `204` |
| GET | `/task-types/:id/completion-requirements` | `task_type:view` | trenutni zahtjevi |
| PUT | `/task-types/:id/completion-requirements` | `task_type:update` | atomska zamjena cijelog skupa |

Detaljan implementirani ugovor je u §7.6.

### 2.11 Zadaci (`/tasks`) — najkritičniji modul

| Metoda | Put | P | Napomena |
|---|---|---|---|
| GET | `/tasks` | `task:view` / `task:view_all` | implementirano; filteri: `status`, `vehicleId`, `taskTypeId`, `assigneeUserId`, `createdById`, `dueFrom`, `dueTo`, `priority`, `mine`, `overdueOnly`, `q` |
| POST | `/tasks` `Idem` | `task:create` | implementirano; snapshot efektivne objavljene TASK verzije + DB outbox `TASK_CREATED`; PHOTO/FILE UUID-evi iz `formData` se validiraju i vežu u istoj transakciji uz fazu `ON_CREATE` |
| GET | `/tasks/:id` | `task:view` / `task:view_all` (+ scope) | implementirano; uključuje `assignments`, `events`, `attachmentIds`, `commentCount`, `formSchemaVersion` |
| PATCH | `/tasks/:id` | `task:update` | implementirano; CAS `version`, vlastiti zadatak dok je `OPEN` ili puni opseg |
| **POST** | **`/tasks/:id/claim`** `Idem` | `task:claim` | implementirano; **atomski** prelaz `OPEN → IN_PROGRESS`; `409 TASK_ALREADY_CLAIMED` s imenom i vremenom izvršioca kad akter smije vidjeti zadatak ili je bio kandidat |
| POST | `/tasks/:id/complete` `Idem` | `task:complete` (izvršilac) ili `task:complete_override` | implementirano; strict `{version,formData?,attachmentIds?,comment?,odometerKm?,reason?}`, puna forma i normalizacija, DB outbox `TASK_COMPLETED` |
| POST | `/tasks/:id/cancel` | `task:cancel` | implementirano; `{version,reason}` (`reason` obavezno) |
| POST | `/tasks/:id/reopen` | `task:reopen` | implementirano; `{version,reason?,dueAt?}`, audit + DB outbox |
| POST | `/tasks/:id/release` | `task:release` s opsegom `ALL` | implementirano; strict `{version,reason?}`, samo `IN_PROGRESS → OPEN`, CAS, `RELEASE`/`WARN`, DB outbox `TASK_RELEASED` |
| POST | `/tasks/:id/assign` | `task:assign` s opsegom `ALL` | implementirano; strict `{version,mode,userIds[]}`, CAS, aktivne dodjele + audit/outbox |
| GET | `/tasks/:id/comments` | `task:view` ili `task:view_all` | paginirana lista vidljivog zadatka, najstariji prvo |
| POST | `/tasks/:id/comments` | `task:comment` | `{body}` strict, `201`; TaskEvent + DB outbox + audit |
| POST | `/tasks/:id/attachments` | `attachment:upload` | |
| GET | `/tasks/:id/events` | `task:view` ili `task:view_all` | historija (immutabilna), samo za vidljiv zadatak |
| GET | `/tasks/available` | `task:claim` | implementirano; samo `OPEN` zadaci koje korisnik **smije** preuzeti po načinu dodjele i opsegu permisije |

**Odgovor na `409` pri claim-u** (mašinski čitljiva polja su u vrhu
`error` objekta, kao i ostali `extra` podaci iz §1.5):
```jsonc
{ "error": { "code": "TASK_ALREADY_CLAIMED",
  "message": "Zadatak je preuzeo Emina H.",
  "taskId": "…", "assigneeUserId": "…", "claimedByUserId": "…",
  "assigneeName": "Emina H.", "claimedByName": "Emina H.",
  "claimedAt": "2026-10-19T09:29:10Z", "requestId": "…" } }
```

Detaljan implementirani ugovor jezgre zadataka je u §7.7, atomskog
preuzimanja i slobodnih zadataka u §7.8, a završetka i override prelaza u
§7.9, release-a u §7.10, a naknadne dodjele u §7.11, dok su komentari u §7.12. Historija zadataka ostaje zasebna cjelina; outbox/FCM worker opisan je u §2.13,
a task end-to-end HTTP tokovi P4–P8 još traže integracijski dokaz.

### 2.12 Prilozi (`/attachments`)

| Metoda | Put | P | Napomena |
|---|---|---|---|
| POST | `/attachments` (multipart) `Idem` | `attachment:upload` | vraća `{id, sha256, sizeBytes, mimeType}`; magic-byte provjera |
| POST | `/attachments/complete` | `attachment:upload` | veže vlastiti upload uz zapis u okviru actorovog odgovarajućeg write/complete scope-a za taj tip vlasnika (tuđi upload samo Super Admin) |
| GET | `/attachments/:id` | `attachment:view` | metapodaci |
| GET | `/attachments/:id/content` | `attachment:view` | stream uz provjeru opsega; `Content-Disposition: attachment`; audit `FILE_ACCESS` |
| GET | `/attachments?ownerType=&ownerId=&page=` | `attachment:view` | lista priloga jednog zapisa; bez `ALL` opsega samo vlastiti upload-i |
| GET | `/attachments/:id/url` | `attachment:view` | HMAC potpisani URL (TTL `FILE_SIGNED_URL_TTL_SECONDS`), vezan za korisnika |
| GET | `/attachments/:id/content/:token` | `attachment:view` | stream uz sesiju, provjeru opsega i korisnički vezan potpis; audit `FILE_ACCESS` |
| POST | `/attachments/:id/replace` | `attachment:upload` | nova verzija zahtijeva vlastiti upload i write scope ciljnog zapisa; tuđi upload samo Super Admin (stara ostaje u historiji, soft-delete) |
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
  do tada je prilog vezan na uploadera (`ownerType: OTHER`). `taskId` je dozvoljen samo uz
  `ownerType: TASK`, mora biti jednak `ownerId`, a za TASK se veza automatski postavlja.
- **Pohrana:** host bind-mount (`VFM_STORAGE_CONTAINER_PATH`), ključ
  `YYYY/MM/<sha[0..2]>/<uuid>.<ext>`; fajl se **nikad** ne servira direktno s diska (B-15).

### 2.13 Obavijesti (`/notifications`)

| Metoda | Put | P |
|---|---|---|
| GET | `/notifications?unreadOnly=&page=&pageSize=` | `notification:view` — samo vlastite obavijesti |
| POST | `/notifications/:id/read` | `notification:mark_read` — označava vlastitu obavijest kao pročitanu |
| GET | `/notifications/unread-count` | `notification:view` — broj vlastitih nepročitanih |
| POST | `/notifications/read-all` | `notification:mark_read` — označi sve vlastite nepročitane |
| GET | `/notifications/stream` (SSE; `Accept: text/event-stream`, opciono `Last-Event-ID`) | `notification:view` — vlastite obavijesti + unread-count; DB polling svakih 5 s |
| GET/PUT | `/notifications/preferences` | `notification:manage_preferences` — prijavljeni korisnik upravlja vlastitim kanalima |
| ⏳ POST | `/notifications/broadcast` | `notification:broadcast` |
| GET | `/devices/tokens` | `notification:manage_preferences` — samo metapodaci vlastitih uređaja, bez tokena/hash-a |
| POST | `/devices/tokens` `{token, platform, appVersion?, deviceModel?, osVersion?, locale?}` | `notification:manage_preferences` — owner je isključivo prijavljeni korisnik; odgovor nikad ne sadrži token/hash |
| DELETE | `/devices/tokens/:id` | `notification:manage_preferences` — trajno uklanja samo vlastiti uređaj; tuđi/nepostojeći ID vraća 404 |

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
  "formData": { "washType": "FULL" }
}
```
`201` → `{ "data": { "id": "…", "code": "Z-2026-000118", "status": "OPEN",
"formSchemaVersionId": "…", "formSchemaVersion": 3, "assignments": […], "createdAt": "…" } }`

PHOTO/FILE polja u `formData` primaju UUID nizove fajlova prethodno uploadovanih
multipart pozivom `POST /attachments` (permisija `attachment:upload`). Upload ostaje
nevezan uz aktera do kreiranja: unutar iste transakcije sa zadatkom server provjerava
vlasništvo, MIME/veličinu i zahtjeve `ON_CREATE`, a zatim veže prihvaćene fajlove uz
zadatak i njihovo polje forme sa fazom `ON_CREATE`. Neuspješno kreiranje ne ostavlja
napola kreiran zadatak niti djelimično vezane priloge.

### 3.3 Preuzimanje (atomski)
```http
POST /api/v1/tasks/2f1c…/claim
Idempotency-Key: 9c2a…-uuid
{ "formData": { "washDurationMin": 45 } }
```
Tijelo je opcionalno; poslani `formData` se spaja s nacrtom zadatka.
`200 TaskDetail` → `{ "data": { "id": "…", "status": "IN_PROGRESS",
"assigneeUserId": "…", "claimedAt": "…", "version": 4 } }`
`409` → `TASK_ALREADY_CLAIMED` (§2.11, detalji u §7.8)

### 3.4 Završetak
```http
POST /api/v1/tasks/2f1c…/complete
Idempotency-Key: 5d77…-uuid
{ "version": 4,
  "formData": { "washType": "FULL", "washDurationMin": 45,
    "washCost": { "amount": 9000, "currency": "BAM" },
    "photosAfter": ["…"] },
  "attachmentIds": ["…"], "comment": "Felge očišćene", "odometerKm": 148230 }
```
Poslani `formData` se spaja preko nacrta i prolazi punu validaciju.
`200 TaskDetail` → `{ "data": { "id": "…", "status": "COMPLETED",
"completedAt": "…", "completedById": "…", "durationMinutes": 130,
"totalCost": 9000, "odometerKm": 148230, "version": 5 } }`
Vidljivom neizvršiocu bez `task:complete_override` vraća se
`403 NOT_ASSIGNEE`; detaljan ugovor je u §7.9.

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

: keepalive (svakih 5 s)
```
Transport je server-side `@Sse` uz vlasničko ograničenje po `userId`. API provjerava nove vidljive
obavijesti iz PostgreSQL-a u intervalu od 5 sekundi (najviše 100 po poll-u), šalje početni
`unread-count` i `keepalive`, te koristi `Last-Event-ID` (`notification.id`) za nastavak i
nadoknadu događaja nakon reconnecta. Bez `Last-Event-ID` šalju se samo nove obavijesti od otvaranja
streama. Header mora biti UUID; tuđi/nepostojeći ID ne otkriva podatke. SSE zahtjev mora imati
`Accept: text/event-stream`; klijenti koji šalju Bearer token koriste fetch-stream (native
`EventSource` ne podržava prilagođeni `Authorization` header). Opoziv `notification:view` prava
prekida postojeći stream pri sljedećoj provjeri. Ovo je DB-polling MVP umjesto Redis pub/sub
fan-outa; pod većim brojem konekcija treba uvesti pub/sub.

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

### 7.6 Vrste zadataka i zahtjevi završetka — prva cjelina Faze 5

Implementirani su:

| Metoda i ruta | Permisija | Odgovor i audit |
|---|---|---|
| `GET /task-types` | `task_type:view` | `{items,total,page,pageSize,totalPages}`; bez audita |
| `POST /task-types` | `task_type:create` | `201 TaskTypeDetail`; audit `CREATE`/`INFO` na `TaskType` |
| `GET /task-types/:id` | `task_type:view` | detalj s `completionRequirements`; bez audita |
| `PATCH /task-types/:id` | `task_type:update` | ažurirani detalj; audit `UPDATE`/`INFO` prije/poslije |
| `POST /task-types/:id/archive` | `task_type:archive` | `204`; audit `ARCHIVE`/`WARN`, opcionalni `reason` samo u auditu |
| `GET /task-types/:id/completion-requirements` | `task_type:view` | `{taskTypeId,requirements}`; bez audita |
| `PUT /task-types/:id/completion-requirements` | `task_type:update` | novi skup; audit `UPDATE`/`INFO` prije/poslije |

Lista uvijek isključuje `deletedAt`, prihvata standardnu paginaciju te `q`
(kod/naziv/opis), `activeOnly` i `requiresVehicle`. Sort whitelist je
`sortOrder`, `name`, `code`, `createdAt`, `updatedAt`; nepoznat ključ pada na
redoslijed prikaza, a redoslijed prikaza/naziv/ID su stabilni sekundarni
ključevi. Pogled izlaže samo javna polja vrste, ključ/naziv i trenutno
objavljenu verziju povezane forme te broj zahtjeva.

Kreiranje ima strict DTO: `code` je 2–50 znakova po obrascu
`^[A-Z][A-Z0-9_]*$`, `name` 2–100; opcionalni su opis, ikona i boja
`#RRGGBB` (normalizuje se na velika slova). Zastavice `requiresVehicle`,
`requiresOdometer`, `requiresPhotos` i `allowMultipleClaimants`, zadani
prioritet/način dodjele, `dueOffsetHours` 1–8760 ili `null`, `formSchemaId`
i `sortOrder` imaju DTO defaultove (`NORMAL`, `OPEN_CLAIM`, vozilo obavezno,
sort 100). `requiresOdometer=true` bez vozila je `400 VALIDATION_ERROR`.
Kod je globalno jedinstven i nakon arhiviranja; predprovjera i konkurentni
Prisma `P2002` vraćaju `409 DUPLICATE_ENTRY`.

Eksplicitna `formSchemaId` mora biti neobrisana `TASK` forma s trenutno
objavljenom verzijom. Njeno `taskTypeId` smije biti `null` (generička) ili ID
iste vrste; forma druge vrste, pogrešan subject ili nepostojeći ID su
validacijska greška, a neobjavljena forma `409 FORM_VERSION_NOT_PUBLISHED`.
Odgovor kreiranja je detalj s praznom listom zahtjeva; vrsta uvijek nastaje
aktivna i klijent ne može zadati `active`, serverske datume ni arhivu.

`PATCH` nema `code`, `active` ni `version`: `TaskType` u šemi nema
optimističku verziju. Transakcija zaključava red `FOR UPDATE`, ponovo čita
trenutno stanje i primjenjuje samo poslana polja; prazan DTO se odbija, a
opis/ikona/boja/rok/forma se brišu eksplicitnim `null`. Efektivni odnos
vozilo/kilometraža se provjerava i kad PATCH mijenja samo jednu zastavicu.
Promjena forme prvo provjerava postojeće zahtjeve prema novoj efektivnoj
objavljenoj definiciji; nekompatibilan skup blokira promjenu, pa se zahtjevi
prvo uklanjaju/zamjenjuju zasebnim PUT-om.

Arhiviranje u zaključanoj transakciji postavlja `active=false` i
`deletedAt`; nepostojeća ili već arhivirana vrsta je `404 NOT_FOUND`.
Arhiva ne dira postojeće zadatke, zahtjeve ni historiju i ne oslobađa kod za
ponovnu upotrebu.

Zahtjev završetka je `{fieldKey,required,stage,minPhotos}`. `fieldKey` prati
form-engine obrazac, `required` ima default `true`, `stage` default
`ON_COMPLETE`, a `minPhotos` je 0–20; iznos veći od 0 traži obavezan
zahtjev. PUT prima najviše 50 zapisa, odbija duplikat `fieldKey` i u istoj
zaključanoj transakciji briše pa upisuje cijeli skup; prazna lista briše sve
zahtjeve. Efektivna forma je prvo `TaskType.formSchemaId`, a bez nje
objavljena TASK forma vezana za tu vrstu. Kad efektivna forma postoji, ključ
mora postojati u trenutno objavljenoj definiciji i `minPhotos > 0` mora
pokazivati na `PHOTO` polje. Bez efektivne forme ključevi se zasad smiju
konfigurisati unaprijed; jezgra zadataka iz §7.7 pri kreiranju provjerava
`ON_CREATE` zahtjeve prema snapshotovanoj verziji, claim iz §7.8 dodaje
`ON_CLAIM`, a završetak iz §7.9 provjerava cijelu formu i sve dosadašnje
faze.

Idempotentni seed dodaje `WASH`, `INTERIOR_CLEANING`, `FUEL_REFILL`,
`SERVICE_VISIT`, `TIRE_CHANGE`, `TECHNICAL_INSPECTION`, `REGISTRATION` i
`CUSTOM`. Postojeći kod se ne prepisuje niti vraća iz arhive; zasad se samo
`WASH` veže za seedovanu objavljenu formu `pranje_vozila`, ostale vrste imaju
`formSchemaId=null`. Nema novih ENV varijabli, Redis ključeva/redova,
migracija ni outbox događaja u ovoj cjelini. Jedinice s lažnim klijentom ne
dokazuju stvarni PostgreSQL `FOR UPDATE`, rollback ni produkcijski HTTP tok.

### 7.7 Jezgra zadataka — druga cjelina Faze 5

Implementirani su:

| Metoda i ruta | Permisija | Odgovor i audit |
|---|---|---|
| `GET /tasks` | `task:view` ili `task:view_all` | `{items,total,page,pageSize,totalPages}`; bez audita |
| `POST /tasks` | `task:create` | `201 TaskDetail`; audit `CREATE`/`INFO` na `Task`; prethodno uploadovani PHOTO/FILE prilozi se validiraju i transakcijski vežu u fazi `ON_CREATE` |
| `GET /tasks/:id` | `task:view` ili `task:view_all` | `TaskDetail`; bez audita |
| `PATCH /tasks/:id` | `task:update` | `TaskDetail`; audit `UPDATE`/`INFO` prije/poslije |
| `POST /tasks/:id/cancel` | `task:cancel` | `TaskDetail`; audit `CANCEL`/`WARN`, DB outbox `TASK_CANCELLED` |
| `POST /tasks/:id/reopen` | `task:reopen` | `TaskDetail`; audit `REOPEN`/`WARN`, DB outbox `TASK_REOPENED` |

Lista isključuje soft-deleted zadatke, koristi standardnu paginaciju i
server-side `q` nad kodom/naslovom/opisom te filtere `status`, `vehicleId`,
`taskTypeId`, `assigneeUserId`, `createdById`, `priority`, `dueFrom`,
`dueTo`, `mine` i `overdueOnly`. Sort whitelist je `dueAt`, `createdAt`,
`updatedAt`, `priority`, `title`, `code`; default je rok rastuće, kreiranje
opadajuće i stabilan kod/ID. Korisnik s `task:view_all` ili `task:view` u
opsegu `ALL` vidi sve. Ostali vide zadatke koje su kreirali, koje izvršavaju
ili su završili, aktivne dodjele/pozive/posmatranja i otvorene `BROADCAST`
zadatke. `mine=true` dodatno uklanja broadcast zadatke bez lične veze.
Detalj izvan opsega je `404 NOT_FOUND`, bez otkrivanja da zapis postoji.

Kreiranje je strict DTO `{taskTypeId,vehicleId?,title?,description?,priority?,
assignMode?,dueAt?,invitedUserIds,assigneeUserId?,observerUserIds,formData}`.
Vrsta mora biti aktivna. Ako vrsta zahtijeva vozilo, `vehicleId` je obavezan;
vozilo ne smije biti obrisano ni arhivirano. Bez naslova server koristi naziv
vrste i interni broj vozila. Prioritet, način dodjele i rok nasljeđuju
konfiguraciju vrste; eksplicitni `dueAt:null` ukida zadani rok, a izvedeni
`dueDate` je lokalni datum roka u `Europe/Sarajevo`. Kod je
`Z-YYYY-000001` po lokalnoj godini i dodjeljuje se pod transakcijskim
PostgreSQL advisory lockom, uz jedinstveni indeks kao drugu zaštitu.

Načini dodjele imaju tačnu semantiku:

- `OPEN_CLAIM`: `invitedUserIds` su kandidati, a kreator s `task:claim`
  također može preuzeti zadatak; prazna lista zato ostavlja kreatora kao
  jedinog kandidata do eksplicitne naknadne promjene dodjele. Samo pravo pregleda
  (`task:view_all`) ili uloga posmatrača ne daje kandidaturu.
- `ASSIGN_DIRECT`: tačno jedan `assigneeUserId`, bez pozvanih. Zadatak ostaje
  `OPEN`, `claimedAt` je `null`, a `Task.assigneeUserId` i jedinstveni aktivni
  `TaskAssignment(role=ASSIGNEE)` označavaju odabranog izvršioca do claim-a.
  Sam `assigneeUserId` bez `assignMode` također znači direktnu dodjelu.
- `BROADCAST`: nema listu pozvanih; budući notification worker primaoce
  dinamički bira među aktivnim korisnicima s `task:claim`.

Svi primaoci moraju postojati i biti `ACTIVE`. Pozvani i direktni izvršilac
moraju imati `task:claim`, a posmatrač `task:view` ili `task:view_all`;
duplikati i preklapanje uloga istog korisnika su `400 VALIDATION_ERROR`.

Efektivna forma pri kreiranju je kanonički: `TaskType.formSchemaId`, zatim
objavljena TASK forma čiji je `taskTypeId` odabrana vrsta. Isti prioritet
koristi i `GET /form-schemas/active?subject=TASK&taskTypeId=…`. Generička TASK
forma nije fallback. Od seedovanih vrsta zato je trenutno odmah upotrebljiv
samo `WASH`; ostale vraćaju `409 FORM_VERSION_NOT_PUBLISHED` dok im se ne
poveže i ne objavi odgovarajuća TASK forma. Transakcija zaključava vrstu i
formu te u `Task.formSchemaId/formSchemaVersionId` sprema tačan snapshot.
Početni `formData` je nacrt: nepoznata polja i pogrešni tipovi/vrijednosti
poslanih polja su `422 FORM_VALIDATION_FAILED`, dok se obavezna polja forme
još ne traže u cijelosti. Obavezni `ON_CREATE` zahtjevi vrste primjenjuju se
odmah, uključujući `minPhotos`. Puna validacija i normalizacija pripadaju
završetku iz §7.9.

U istoj DB transakciji nastaju zadatak, `TaskAssignment` redovi,
immutabilni `TaskEvent` (`CREATED` te po potrebi `INVITED` ili `ASSIGNED`) i
`OutboxEvent(TASK_CREATED)` s ključem `task:{taskId}:TASK_CREATED:v0`.
Payload nosi kod/status/aktera i primaoce; za broadcast je `broadcast:true` i
prazna lista primaoca. Postojeći in-memory `OutboxService.publish()` se ne
koristi kao trajna garancija. Globalni `Idempotency-Key` mehanizam iz §1.4
štiti ponovljeni POST od drugog izvršenja handlera.

`PATCH` prima obaveznu CAS `version` i samo `title`, `description`,
`priority`, `dueAt`, `formData`. Vrsta, vozilo, način dodjele, izvršilac i
snapshot forme se ne mijenjaju. Korisnik s `task:update` u `OWN` opsegu smije
mijenjati samo zadatak koji je kreirao ili mu je direktno dodijeljen i samo
dok je `OPEN`; puni `ALL` opseg može mijenjati i `IN_PROGRESS`. `COMPLETED`
i `CANCELLED` daju `422 INVALID_TASK_TRANSITION`, zastarjela verzija
`409 VERSION_CONFLICT` s `currentVersion`, a nedovoljan opseg
`403 SCOPE_DENIED`. Novi `formData` zamjenjuje nacrt prema snapshotovanoj
verziji (i kad je naknadno `RETIRED`) istim djelimičnim pravilima i trenutnim
`ON_CREATE` zahtjevima. Uspjeh povećava verziju i upisuje `TaskEvent(UPDATED)`.

Otkazivanje prima `{version,reason}`; dozvoljeno je iz `OPEN` i
`IN_PROGRESS` kreatoru s OWN opsegom ili korisniku s punim opsegom. Polja
izvršioca i claim vremena ostaju kao historijski trag. Reopen prima
`{version,reason?,dueAt?}` i radi `CANCELLED → OPEN` ili
`COMPLETED → IN_PROGRESS`. Kod otkazanog `OPEN_CLAIM`/`BROADCAST` zadatka
izvršilac se uklanja i aktivni `ASSIGNEE` red opoziva; kod direktne dodjele
izvršilac ostaje, ali `claimedAt` postaje `null`. Kod završenog zadatka
izvršilac i `claimedAt` ostaju, a `completedAt`, `completedById` i trajanje
se brišu. Obje akcije zaključavaju red, rade CAS na verziji/statusu, pišu
događaj i DB outbox s novom verzijom u idempotency ključu.

Nema novih ENV varijabli, Redis ključeva/redova ni migracija. Atomski
claim i `/tasks/available` dodani su u §7.8, završetak/override u §7.9,
a release u §7.10, naknadna dodjela u §7.11 i komentari u §7.12. Zasebna
historija, outbox worker i FCM/SSE isporuka nisu dio jezgre. Jedinični lažni klijent ne
dokazuje stvarni PostgreSQL advisory lock, `FOR UPDATE`, rollback ni puni
HTTP lanac na Coolifyu.

### 7.8 Slobodni zadaci i atomski claim — treća cjelina Faze 5

Implementirani su:

| Metoda i ruta | Permisija | Odgovor i audit |
|---|---|---|
| `GET /tasks/available` | `task:claim` | `TaskListResponse`; bez audita |
| `POST /tasks/:id/claim` | `task:claim` | `200 TaskDetail`; audit `CLAIM`/`INFO` prije/poslije, DB outbox `TASK_CLAIMED` |

`/tasks/available` koristi standardnu paginaciju, `q` nad kodom/naslovom/
opisom te filtere `vehicleId`, `taskTypeId`, `priority`, `dueFrom`,
`dueTo` i `overdueOnly`; sort whitelist i zadani redoslijed isti su kao
kod `GET /tasks`. Status je serverski fiksiran na `OPEN`, pa DTO ne prima
`status`, `assigneeUserId`, `createdById` ni `mine`.

Ista kandidatura upravlja listom i claim-om:

- `ASSIGN_DIRECT`: samo korisnik koji je istovremeno
  `Task.assigneeUserId` i ima aktivan `TaskAssignment(role=ASSIGNEE)`.
- `OPEN_CLAIM`: kreator ili korisnik s aktivnim `INVITED` redom; postojeći
  aktivni izvršilac također ostaje kandidat za tačnu `409` klasifikaciju
  nakon što zadatak pređe u `IN_PROGRESS`.
- `BROADCAST`: svaki aktivni nosilac primjenjivog `task:claim` opsega;
  kod opsega `OWN` samo kreator (ili već postavljeni izvršilac).
- `VEHICLE_IDS` opseg dodatno zahtijeva da je vozilo zadatka u grantu;
  `DRIVER_IDS` nema primjenjivu vezu prema zadatku i ne daje kandidaturu.
- Posmatrač i korisnik koji zadatak vidi samo preko `task:view_all` nisu
  kandidati za direktan ni pozvani zadatak. `allowMultipleClaimants` zasad
  nema efekta jer model i djelimični jedinstveni indeks dozvoljavaju
  tačno jednog aktivnog izvršioca.

Claim DTO je strict `{formData}` i tijelo smije izostati. Poslani nacrt se
spaja preko postojećeg `Task.formData`, validira prema snapshotovanoj
verziji forme kao djelimičan zapis i mora ispuniti trenutne obavezne
`ON_CREATE` i `ON_CLAIM` zahtjeve vrste, uključujući `minPhotos`; greške
su `422 FORM_VALIDATION_FAILED` s detaljima po `formData.<fieldKey>`.
Claim ne radi punu validaciju ni normalizaciju završetka.

Uspješan prelaz radi jedan uslovni `UPDATE` nad `Task` kojem su u
`WHERE` dijelu ID, `deletedAt IS NULL`, `status='OPEN'`, učitana verzija,
kandidatura aktera i nepostojanje drugog aktivnog `ASSIGNEE` reda. Upis
postavlja `IN_PROGRESS`, `assigneeUserId`, `claimedAt`, validirani
`formData` i `version+1`. Ako paralelan PATCH samo poveća verziju, claim
se u istoj transakciji ograničeno ponavlja nad svježim zapisom; ako drugi
akter pobijedi, `count=0` se mapira na `409 TASK_ALREADY_CLAIMED`. U
istoj transakciji nastaje ili se reaktivira tačno jedan aktivni
`TaskAssignment(role=ASSIGNEE)`, immutabilni `TaskEvent(CLAIMED)` i
`OutboxEvent(TASK_CLAIMED)` s ključem
`task:{taskId}:TASK_CLAIMED:v{newVersion}`. Kod direktne dodjele
postojeći aktivni `ASSIGNEE` red se ne duplira. Globalni
`Idempotency-Key` replay štiti ponovljeni zahtjev od drugog izvršenja
handlera; bez hash istog ključa ponovni claim već preuzetog zadatka je
`409`, uključujući i kad je trenutni izvršilac sam akter.

Greške su: `403 PERMISSION_DENIED` bez `task:claim`, `403
ACCOUNT_INACTIVE` za neaktivnog kandidata, `404 NOT_FOUND` za
nepostojeći ili akteru nevidljiv/nepristupačan zadatak, `403
SCOPE_DENIED` za vidljiv zadatak izvan kandidature/opsega, `409
TASK_ALREADY_CLAIMED` za `IN_PROGRESS` zadatak, `422
INVALID_TASK_TRANSITION` za `COMPLETED`/`CANCELLED` te `409
VERSION_CONFLICT` samo ako zapis nastavi mijenjati verziju tokom
ograničenih ponavljanja. Kod `TASK_ALREADY_CLAIMED` se `taskId`,
`assigneeUserId`/`claimedByUserId`, `assigneeName`/`claimedByName` i
`claimedAt` izlažu samo akteru koji zadatak smije vidjeti ili je bio
kandidat; ostali dobijaju `404`, bez otkrivanja stanja.

Nema novih ENV varijabli, Redis ključeva/redova ni migracija: djelimični
jedinstveni indeks aktivnog izvršioca već postoji u ručnoj migraciji.
Outbox red se zapisuje transakcijski, ali worker, FCM i SSE isporuka,
web/mobilni ekrani zadataka i release ostaju zasebne cjeline. Lažni
jedinični klijent dokazuje uslovnu logiku i klasifikaciju, ne stvarnu
PostgreSQL konkurenciju, djelimični indeks pod opterećenjem, rollback ni
Coolify HTTP tok; P6 stress-test i dalje zahtijeva pravu bazu.

### 7.9 Završetak i override — četvrta cjelina Faze 5

Implementirana je jedna ruta:

| Metoda i ruta | Permisija | Odgovor i audit |
|---|---|---|
| `POST /tasks/:id/complete` | `task:complete` ili `task:complete_override` | `200 TaskDetail`; audit `COMPLETE`/`INFO` prije/poslije, DB outbox `TASK_COMPLETED` |

DTO je strict i kanonički koristi isti naziv kao ostali task ugovori:
`{version, formData?, attachmentIds?, comment?, odometerKm?, reason?}`.
Stari nacrtni naziv `formValues` se ne prima. `version` je obavezni CAS
zaštitnik završne forme; `formData` i `attachmentIds` imaju prazne
podrazumijevane vrijednosti, `attachmentIds` prima najviše 20 jedinstvenih
UUID-ova, `comment` najviše 2000 znakova, `odometerKm` je nenegativni
32-bitni cijeli broj, a opcioni `reason` ima 3–500 znakova. Serverska polja
poput statusa, izvršioca i vremena završetka dio su strict odbijanja.

Prelaz je isključivo `IN_PROGRESS → COMPLETED` nad zaključanim redom i
zahtijeva kanonskog izvršioca s aktivnim
`TaskAssignment(role=ASSIGNEE)` redom. Trenutni izvršilac završava kroz
primjenjivi opseg `task:complete` (ili vlastiti
`task:complete_override`, što se ne bilježi kao tuđi override). Drugi
akter prolazi samo kroz primjenjivi `task:complete_override`: `ALL` bez
dodatnog ograničenja, `OWN` za zadatak koji je kreirao, `VEHICLE_IDS` samo
za grantovano vozilo, dok `DRIVER_IDS` nema primjenu na zadatak. Sam
`task:complete` u `ALL` opsegu ne zaobilazi pravilo izvršioca. Vidljivom
neizvršiocu bez override prava vraća se `403 NOT_ASSIGNEE` s `taskId` i
`assigneeUserId`; nevidljiv zadatak daje `404 NOT_FOUND`, a prisutna
permisija čiji opseg ne obuhvata zadatak `403 SCOPE_DENIED`. Bez ijedne od
dvije permisije odgovor je `403 PERMISSION_DENIED`.

Poslani `formData` spaja se preko postojećeg nacrta i zatim prolazi **punu**
validaciju prema snapshotovanoj `Task.formSchemaVersionId` verziji —
uključujući obavezna i COMPUTED polja — te trenutne obavezne zahtjeve
vrste u fazama `GENERAL`, `ON_CREATE`, `ON_CLAIM` i `ON_COMPLETE`.
Duplikati unutar jednog PHOTO/FILE polja se kanonički uklanjaju prije
brojanja, a isti prilog ne može popuniti dva polja. Za svaki ID iz
PHOTO/FILE polja i opće `attachmentIds` liste provjerava se stvarni,
neobrisani `Attachment` red. Dozvoljen je prilog već vezan uz ovaj zadatak
ili nevezani upload samog aktera (`ownerType=OTHER`, `ownerId=actor`,
`uploadedById=actor`); prilog drugog zapisa ili tuđi nevezani upload
odbija završetak. Uspješan završetak u istoj transakciji kanonski veže
prihvaćene priloge (`ownerType=TASK`, `ownerId=taskId`, `taskId`, polje
forme gdje postoji); novovezani dobijaju fazu `ON_COMPLETE`, a ranije
vezani zadržavaju svoju fazu. Opći `attachmentIds` ne zamjenjuju niti brišu
postojeće priloge i ne broje se u `minPhotos` konkretnog PHOTO polja.

Iz `normalizedName` mapiranja snapshotovane forme popunjavaju se samo
mjerljive kolone rezultata: `odometerKm`, `totalCost`, `fuelLiters` i
`fuelAmount`. Ako mapirana vrijednost u završnoj formi nedostaje, kolona
se postavlja na `null`; naslov, opis, prioritet, rok, status i izvršilac
ne mogu se prepisati formom. Direktni `odometerKm` dozvoljen je samo za
zadatak s vozilom i mora biti jednak normalizovanoj kilometraži kad forma
takvu vrijednost daje. `durationMinutes` server računa kao cijele minute
od `claimedAt` do trenutka završetka, ne iz polja forme.

Uspjeh postavlja `COMPLETED`, `completedAt`, `completedById` na stvarnog
aktera, trajanje, očišćeni `formData`, normalizovane kolone i `version+1`;
izvršilac ostaje nepromijenjen. Neprazan `comment` u istoj transakciji
stvara `TaskComment` bez mentiona. Uvijek nastaju immutabilni
`TaskEvent(COMPLETED)` ili — kad zadatak završi druga osoba —
`TaskEvent(OVERRIDE_COMPLETED)`, te `OutboxEvent(TASK_COMPLETED)` s
ključem `task:{taskId}:TASK_COMPLETED:v{newVersion}`. Događaj, outbox i
audit nose `override`, stvarnog `completedById`, trajanje, opcioni razlog
i ID komentara; primaoci outboxa su uključene osobe osim aktera, pa
izvršilac dobija obavijest o override završetku. AuditLog koristi postojeću
akciju `COMPLETE` uz meta `override=true`, dok je `OVERRIDE_COMPLETED`
akcija domenskog `TaskEvent` zapisa.

Greške su: `400 VALIDATION_ERROR` za neispravan DTO, nedozvoljen opći
prilog, kilometražu bez vozila ili neslaganje direktne i normalizovane
kilometraže; `403 PERMISSION_DENIED`/`SCOPE_DENIED`/`NOT_ASSIGNEE` kako je
opisano; `404 NOT_FOUND`; `409 VERSION_CONFLICT` s `currentVersion` za
zastarjelu verziju; `409 FORM_VERSION_NOT_PUBLISHED` za neupotrebljiv
snapshot; `422 INVALID_TASK_TRANSITION` izvan `IN_PROGRESS` ili bez
aktivnog izvršioca; te `422 FORM_VALIDATION_FAILED`/
`NORMALIZATION_MISMATCH` za završnu formu i njena mapiranja. Globalni
`Idempotency-Key` replay vraća prvi uspješni odgovor bez ponovnog prelaza,
komentara, vezivanja ili outbox reda.

Nema novih ENV varijabli, Redis ključeva/redova ni migracija.
`fuelConsumptionL100` se u ovoj generičkoj cjelini ne izračunava jer
form-engine TASK whitelist i postojeći ugovor nemaju jednoznačnu početnu
kilometražu za potrošnju; kolona ostaje kakva jest do zasebne
`FUEL_REFILL` semantike. Zasebna historija, outbox worker/FCM/SSE i web
zadaci ostaju zasebne cjeline.
Jedinični lažni klijent ne dokazuje stvarni PostgreSQL lock/rollback,
Decimal upis, HTTP replay ni Coolify tok; P7 integracijski dokaz i dalje
zahtijeva pravu bazu.


### 7.10 Vraćanje zadatka među slobodne — peta cjelina Faze 5

`POST /tasks/:id/release` zahtijeva `task:release` opsega `ALL` (Super Admin izuzetak po standardnoj RBAC politici); DTO je strict `{version,reason?}`, gdje je razlog nakon trimovanja 3–500 znakova. Akcija dozvoljena je samo iz `IN_PROGRESS` i radi CAS na proslijeđenoj verziji; zastarjela verzija daje `409 VERSION_CONFLICT`, a drugi status `422 INVALID_TASK_TRANSITION`. Uspjeh postavlja `OPEN`, `releasedAt`, briše `claimedAt` i `durationMinutes` te povećava verziju. Forma i njen snapshot ostaju netaknuti.

Za `OPEN_CLAIM` i `BROADCAST` uklanja se trenutni izvršilac i opoziva aktivni `ASSIGNEE`; pozvani i posmatrači ostaju. Za `ASSIGN_DIRECT` se čuvaju prethodno određeni izvršilac i aktivna dodjela, tako da samo on ostaje kandidat za ponovno preuzimanje. U istoj transakciji nastaju `TaskEvent(RELEASED)` i `OutboxEvent(TASK_RELEASED)`; obavijest ide uključenim korisnicima osim aktera. Audit je `RELEASE`/`WARN`; outbox upis nije dokaz isporuke FCM/SSE.

Jedinični testovi pokrivaju DTO, permission/scope, CAS, nevažeći status, obje dodjele, assignments, event/outbox i controller metadata. Lažni Prisma klijent ne dokazuje PostgreSQL rollback/locking niti Coolify HTTP tok; integracijska provjera s pravom bazom ostaje potrebna.


### 7.11 Naknadna dodjela zadatka — šesta cjelina Faze 5

`POST /tasks/:id/assign` zahtijeva `task:assign` opsega `ALL` (Super Admin izuzetak prema RBAC pravilima). Strict DTO: `{version,mode,userIds}`; verzija je nenegativna CAS vrijednost, `mode` je `OPEN_CLAIM`, `ASSIGN_DIRECT` ili `BROADCAST`, a lista ima najviše 100 različitih UUID-ova. Direktna dodjela zahtijeva tačno jednog korisnika, broadcast ne prima listu, a `OPEN_CLAIM` korisnike tretira kao pozvane kandidate.

Dopušteno je mijenjati zadatak u `OPEN` ili `IN_PROGRESS`; terminalni statusi su odbijeni. Za `IN_PROGRESS` je dozvoljena samo direktna zamjena jednim izvršiocem; status ostaje u toku, `claimedAt` se postavlja na vrijeme zamjene, a prethodni aktivni `ASSIGNEE` se opoziva. Svi kandidati moraju biti aktivni i imati `task:claim`. Posmatrači se ne mijenjaju. U istoj transakciji se CAS-om ažurira zadatak, stare aktivne `INVITED`/`ASSIGNEE` dodjele opozivaju, ciljne dodjele kreiraju ili reaktiviraju, te upisuju `TaskEvent(ASSIGNED)` i `OutboxEvent(TASK_ASSIGNED)`. Audit je `UPDATE`/`WARN`; outbox nije dokaz FCM/SSE isporuke.

Jedinični testovi pokrivaju dodjelu na OPEN, zamjenu izvršioca u toku, CAS, odbijanje načina koji nije direktan za zadatak u toku, očuvanje posmatrača te event/outbox. Lažni klijent ne dokazuje stvarni PostgreSQL lock/rollback niti Coolify HTTP tok.


### 7.12 Komentari zadatka — sedma cjelina Faze 5

`GET /tasks/:id/comments` traži `task:view` ili `task:view_all`; servis primjenjuje istu vidljivost zapisa kao detalj zadatka i vraća stranicu komentara po vremenu rasta (`createdAt`, `id`). `POST /tasks/:id/comments` traži `task:comment` i da akter smije vidjeti zadatak; primjenjuje se i opseg permisije (`ALL`, povezani zadatak za `OWN`, grantovano vozilo za `VEHICLE_IDS`; `DRIVER_IDS` nije primjenjiv). Strict tijelo je `{body}`, nakon trimovanja 1–2000 znakova. Spominjanja nisu prihvaćena dok isporuka obavijesti za njih nije podržana; `mentionsUserIds` ostaje prazna.

Kreiranje komentara ne mijenja verziju zadatka. U jednoj transakciji se upisuju `TaskComment`, `TaskEvent(COMMENTED)` i `OutboxEvent(TASK_COMMENTED)` s ključem jedinstvenim za ID komentara; uključenim korisnicima osim autora namijenjen je outbox payload. Audit je `CREATE`/`INFO` nad `TaskComment`. Upis outboxa ne dokazuje isporuku push/in-app obavijesti.

Jedinični testovi pokrivaju trimovanje, paginaciju, vidljivost, permission, event/outbox i controller metadata. PostgreSQL rollback, HTTP replay i Coolify outbox isporuka nisu dokazani.


### 7.13 Historija događaja zadatka — osma cjelina Faze 5

`GET /tasks/:id/events` traži `task:view` ili `task:view_all` i vraća događaje ugrađene u detalj zadatka, sortirane hronološki. Primjenjuje se ista provjera vidljivosti kao za `GET /tasks/:id`; nevidljiv zadatak vraća `404 NOT_FOUND`. Stavke su neizmjenjivi prikaz `TaskEvent` zapisa (akter, vrijeme, akcija, kontekst i snapshot forme), bez endpointa za izmjenu ili brisanje.

Jedinični test pokriva serijalizaciju događaja i odbijanje skrivenog zadatka; pun HTTP/RBAC tok i Coolify baza nisu integracijski potvrđeni.
