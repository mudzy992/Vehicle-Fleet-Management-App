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
- `POST` mutacije koje mogu biti retry-ovane prihvataju `Idempotency-Key: <uuid>`:
  prvi poziv se izvrši i rezultat se kešira 24 h; ponovljeni poziv s istim ključem vraća **isti**
  odgovor (bez novog upisa); isti ključ s različitim `requestHash` → `422 IDEMPOTENCY_KEY_REUSED`.

### 1.5 Katalog kodova grešaka

| HTTP | `code` | Kada |
|---|---|---|
| 400 | `VALIDATION_FAILED`, `INVALID_FILTER`, `INVALID_SORT`, `MALFORMED_JSON` | loš zahtjev |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `PERMISSIONS_STALE`, `REFRESH_REUSED` | auth |
| 403 | `PERMISSION_DENIED`, `SCOPE_DENIED`, `MOBILE_ACCESS_FORBIDDEN`, `MOBILE_SCOPE_NOT_ALLOWED`, `LAST_SUPER_ADMIN_PROTECTED`, `PII_ACCESS_DENIED` | autorizacija |
| 404 | `NOT_FOUND`, `ATTACHMENT_NOT_FOUND` | resurs ne postoji (ili nije u scope-u) |
| 409 | `TASK_ALREADY_CLAIMED`, `TASK_NOT_OPEN`, `NOT_ASSIGNEE`, `VERSION_CONFLICT`, `DUPLICATE_ENTRY`, `PERIOD_OVERLAP`, `TIRE_ALREADY_MOUNTED`, `ODOMETER_REGRESSION`, `IDEMPOTENCY_KEY_REUSED` | sukob stanja |
| 413 | `PAYLOAD_TOO_LARGE` | upload |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | upload |
| 422 | `FORM_VALIDATION_FAILED`, `UNKNOWN_FIELD`, `FIELD_NOT_VISIBLE`, `RESERVED_FIELD_KEY`, `FORM_VERSION_NOT_PUBLISHED`, `NORMALIZATION_MISMATCH`, `SCHEMA_INVALID`, `COMPUTED_TIMEOUT` | forme/validacija domene |
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
| POST | `/auth/change-password` | 🔒 `auth:change_password` | provjera stare lozinke + politika; `mustChangePassword=false`; revoke svih sesija + `tokenVersion++` |
| POST | `/auth/forgot-password` | javno | uvijek 200 (bez enumeracije) — ⏳ s Users modulom (treba Outbox/e-mail) |
| POST | `/auth/reset-password` | javno (token) | ⏳ s Users modulom |
| GET | `/auth/sessions` | 🔒 `auth:manage_sessions` | lista aktivnih sesija/uređaja (ISO datumi, IP, UA, `deviceInfo`) |
| DELETE | `/auth/sessions/:id` | 🔒 `auth:manage_sessions` | revokacija jedne sesije + `tokenVersion++`; tuđa sesija → `404 NOT_FOUND` |

**Stanje (Faza 1, chunk G):** implementirano `login`, `refresh`, `logout`, `logout-all`, `me`,
`change-password`, `GET/DELETE /sessions`. Sve rute osim `login`/`refresh` prolaze lanac
guard-ova `RateLimit → Jwt → ClientType → Permissions` (docs/05 §5–§6), a svaki pokušaj prijave
piše se u `AuthAttempt` (retencija 180 dana) i — kod odbijanja — u `AuditLog` (severity `SECURITY`).
| ~~`/auth/2fa/*`~~ | — | **uklonjeno** | 2FA se NE implementira (R-05) |

### 2.2 Korisnici (`/users`)

| Metoda | Put | P |
|---|---|---|
| GET | `/users` | `user:view` |
| POST | `/users` `Idem` | `user:create` |
| GET | `/users/:id` | `user:view` (+ `user:view_pii` za PII) |
| PATCH | `/users/:id` | `user:update` |
| POST | `/users/:id/archive` | `user:archive` |
| DELETE | `/users/:id` | `user:delete` |
| POST | `/users/:id/roles` · DELETE `/users/:id/roles/:roleId` | `user:assign_role` |
| POST | `/users/:id/reset-password` | `user:reset_password` |
| POST | `/users/:id/force-logout` | `user:force_logout` |

### 2.3 Role i permisije (`/roles`, `/permissions`)

| Metoda | Put | P |
|---|---|---|
| GET | `/roles` · `/roles/:id` | `role:view` |
| POST | `/roles` · PATCH `/roles/:id` · POST `/roles/:id/archive` | `role:create/update/archive` |
| GET | `/roles/matrix` | `role:view` — matrica modul×akcija×rola |
| PUT | `/roles/matrix` | `role:manage_permissions` — bulk update u transakciji + `permissionsVersion++` + audit diff |
| GET | `/permissions` | `permission:view` — katalog (modul, akcija, opis, `isSensitive`) |
| POST | `/permissions/sync` | `permission:catalog_sync` — sinhronizacija kataloga iz koda u DB (deploy korak) |

### 2.4 Vozači (`/drivers`)

`GET/POST /drivers`, `GET/PATCH /drivers/:id`, `POST /drivers/:id/archive`, `DELETE /drivers/:id`,
`GET/POST/PATCH/DELETE /drivers/:id/license-categories[/:catId]`, `GET /drivers/:id/tasks`.
Permisije: `driver:*`; PII polja zahtijevaju `driver:view_pii`.

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

`GET/POST /registrations`, `GET/PATCH/DELETE /registrations/:id`, `POST /registrations/:id/attachments`;
isto za `/insurances`. Validacija preklapanja perioda → `409 PERIOD_OVERLAP`. Permisije `registration:*`,
`insurance:*`.

### 2.7 Servisi (`/services`)

`GET/POST /services`, `GET/PATCH/DELETE /services/:id`, `GET/POST/PATCH/DELETE /services/:id/items`,
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

Vidi `04-FORM_ENGINE.md` §12. Permisije `form:*`.

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
| GET | `/attachments/:id/url` | `attachment:view` | potpisani URL (TTL `FILE_SIGNED_URL_TTL_SECONDS`) |
| POST | `/attachments/:id/replace` | `attachment:upload` | nova verzija (stara ostaje u historiji) |
| DELETE | `/attachments/:id` | `attachment:delete` | soft delete |

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

`GET /reminders?status=&kind=&dueBefore=`, `POST /reminders/:id/acknowledge`,
`POST /reminders/:id/snooze` `{days}`, `GET/PUT /reminders/policies` (`reminder:manage_policies`),
`POST /reminders/scan` (`system:run_maintenance` — ručno pokretanje skenera).

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
GET  /audit-logs                     audit:view      (filteri: actorId, action, entityType, entityId, severity, from, to)
GET  /audit-logs/:id                 audit:view      (before/after diff)
POST /audit-logs/export              audit:export
GET  /settings                       settings:view   (javne + one s pravom)
PUT  /settings/:key                  settings:update (+ audit SETTINGS_CHANGE)
GET  /lists · /lists/:code/items     settings:view   (šifarnici)
POST /lists · /lists/:code/items     settings:manage_lists
GET  /health/live · /health/ready · /health/startup   javno (bez tajni)
GET  /system/queue                   system:view_queue   (queue depth, failed, DLQ)
GET  /system/metrics                 system:view_metrics (Prometheus tekst)
POST /system/maintenance/:job        system:run_maintenance
```

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
