# 02 — Arhitektura sistema

**Verzija:** 1.0.0 · **Datum:** 19.10.2026. · **Vlasnik dokumenta:** arhitektura/agent
**Prethodno čitanje:** [`PLAN_IMPLEMENTACIJE.md`](PLAN_IMPLEMENTACIJE.md) §4 (ADR)

---

## 1. Kontekst sistema (C4 — nivo 1)

```
                       ┌──────────────────────────────────────────────┐
   Super Admin ───────▶│                                              │
   (samo WEB)          │            VOZNI PARK (VFM)                  │
                       │                                              │
   Administrator ─────▶│  web portal (React)  +  API (NestJS)         │──────▶ Firebase
   (WEB + MOBILNA)     │  mobilna (Expo Android) + worker (BullMQ)     │        Cloud Messaging
                       │  PostgreSQL  ·  Redis (ACL, prefix vfm:)      │        (push na Android)
   Obični korisnik ───▶│  prilozi na host volume-u                     │
   (MOBILNA, WEB po    └──────────────────────────────────────────────┘
    pravima)                              ▲
                                          │ HTTPS (Coolify Traefik, TLS 1.2/1.3)
                                          │
                              Privatni server (Coolify, 1 host)
```

**Ljudi:** Super Admin (samo web), Administrator (web + mobilna), Obični korisnik (mobilna, web po
pravima), Operater servera (vlasnik).
**Eksterni sistemi:** Firebase Cloud Messaging (jedini izlazni poziv ka trećoj strani), Coolify
(deploy/orkestracija), opciono Sentry/uptime monitoring.

---

## 2. Kontejneri (C4 — nivo 2)

| Kontejner | Slika | Mreže | Port | Uloga |
|---|---|---|---|---|
| `vfm-web` | `apps/web/Dockerfile` → nginx:1.27-alpine | Coolify default **samo** | 80 | React SPA + proxy `/api` → `api:3000` |
| `vfm-api` | `apps/api/Dockerfile` | default, `db_net`, `redis_net` | 3000 | REST `/api/v1`, SSE, uploadi, health |
| `vfm-worker` | ista slika, drugi `command` | default, `db_net`, `redis_net` | — | BullMQ: outbox → notifikacije → FCM, podsjetnici, exporti, održavanje |
| `vfm-migrate` | ista slika, `restart: "no"` | default, `db_net`, `redis_net` | — | `prisma migrate deploy` + opciono seed/bootstrap, pa `exit 0` |
| PostgreSQL 17 | **Coolify resurs** (van stacka) | `db_net` | 5432 | Jedina primarna baza |
| Redis 7.4 | **Coolify resurs** (van stacka) | `redis_net` | 6379 | Queue, keš, throttle, lock, verzije permisija (ACL: `REDIS_ACL.md`) |
| Traefik | **Coolify proxy** | Coolify default | 80/443 | TLS terminacija, routing po domenama |
| Mobilna (Expo) | — (nije kontejner) | internet | — | Android APK/AAB, priča s `https://api.<domena>/api/v1` |

### 2.1 Zašto `web` nije na `db_net`/`redis_net`

Coolify dokumentacija eksplicitno upozorava da kontejner koji je istovremeno na Coolify mreži i na
custom mreži može postati nedostupan (Traefik nedeterministički bira IP → 504/hang). Zato:

- `web` **nema** pristup bazi/Redisu (nije mu potreban — sve ide kroz API),
- `api`/`worker`/`migrate` jesu na obje mreže; ako se u praksi pojavi 504 na `api` domeni,
  primjenjuje se **Plan B**: `api` dobija vlastitu domenu kroz Coolify, a `web` se izdvaja u
  zaseban Coolify resurs (vidi `08-DOCKER_COOLIFY_DEPLOYMENT.md` §7).

### 2.2 Topologija mreža

```
                ┌───────────────────────────── Coolify default (Traefik) ─────────────────────┐
                │   vfm-web :80   ──/api──▶   vfm-api :3000          vfm-worker     vfm-migrate│
                └──────────────────────────────────┬───────────────────────────────────────────┘
                                                   │
                       ┌───────── db_net ──────────┤ (api, worker, migrate)
                       │   postgres-<uuid> :5432   │
                       └───────────────────────────┘
                       ┌───────── redis_net ───────┤ (api, worker, migrate)
                       │   redis-<uuid> :6379  (ACL: vfm-api / vfm-worker / vfm-readonly)
                       └───────────────────────────┘
```

- `db_net` i `redis_net` su **eksterne** Docker mreže (`external: true`), Coolify destinacije.
- Hostname-ovi moraju biti **puni Coolify nazivi** (`postgres-<uuid>`, `redis-<uuid>`), jer kratka
  imena (`postgres`, `redis`) na dijeljenoj mreži mogu rezolvirati na tuđi kontejner.
- Nijedan port baze/Redisa **nije** objavljen na host/internet.

---

## 3. Monorepo i tok builda

```
pnpm-workspace.yaml  →  apps/{api,web,mobile}  +  packages/{shared,form-engine,form-renderer,api-client,config}
turbo.json           →  build graph:  shared → form-engine → form-renderer → api-client → api/web/mobile
```

| Paket | Sadržaj | Ko ga koristi |
|---|---|---|
| `@vfm/shared` | Zod šeme DTO-ova, enum-i, kodovi permisija, konstante, helper-i (novac, datumi, `bs` formatiranje) | api, web, mobile |
| `@vfm/form-engine` | Validacija definicije forme, validacija vrijednosti prema verziji, evaluator sigurnih izraza, migracija vrijednosti | api (autoritet), web/mobile (preview) |
| `@vfm/form-renderer` | **Headless** render model (vidljivost, opcije, izračunata polja, greške, progres) + `formatFieldValue`; web i mobilna crtaju svoje kontrole nad istim modelom, pa je paritet po konstrukciji | web, mobile |
| `@vfm/api-client` | Tipizirani fetch klijent + TanStack Query hooks | web, mobile |
| `@vfm/config` | tsconfig, eslint flat config, prettier, tailwind preset, tsup/build preseti | svi |

**Pravilo:** poslovna logika koja mora biti identična na klijentu i serveru (validacija forme)
živi u `form-engine`; **server je uvijek autoritet** — klijentska validacija je samo UX.

---

## 4. Komponente API-ja (C4 — nivo 3)

```
apps/api/src
├── main.ts                    # bootstrap: helmet, CORS, prefix, Zod pipe, filteri, Swagger
├── app.module.ts
├── config/env.ts              # Zod-validated env (fail-fast) — JEDINO mjesto s process.env
├── common/
│   ├── guards/                # JwtAuthGuard, PermissionsGuard, ClientTypeGuard, OwnershipGuard
│   ├── decorators/            # @RequirePermissions('vehicle:create'), @CurrentActor(), @Idempotent()
│   ├── interceptors/          # AuditInterceptor, OutboxInterceptor, ResponseEnvelope, Timeout
│   ├── filters/               # AllExceptionsFilter → problem+json, PrismaExceptionFilter, ZodExceptionFilter
│   ├── pipes/                 # ZodValidationPipe
│   └── pagination/            # PageQuery DTO (page, pageSize, sort, filter[q][op])
├── infra/
│   ├── prisma/                # PrismaService, transakcijski helper-i, $executeRaw wrapper-i
│   ├── redis/                 # RedisModule (3 konekcije: api/worker/readonly iz env), lock, cache
│   ├── queue/                 # BullMQ registracija, queue tokeni, retry/backoff config
│   ├── storage/               # HostStorageProvider (bind-mount), magic bytes, SHA-256, signed URL
│   ├── firebase/              # Firebase Admin (lazy init, samo ako FIREBASE_ENABLED)
│   └── mail/                  # opciono (SMTP) za backup obavijesti
└── modules/                   # auth, users, roles, drivers, vehicles, registrations, insurance,
                               # services, tires, form-schemas, task-types, tasks, attachments,
                               # notifications, reminders, reports, settings, audit
```

### 4.1 Request pipeline (redoslijed je obavezan)

```
HTTP → Traefik → nginx(web) /api → api
 1. RequestIdInterceptor        (X-Request-ID ili generisan UUID; propagira se u logove i odgovor)
 2. helmet + CORS allowlist     (CORS_ORIGINS; credentials=true samo za web domenu)
 3. BodyLimit                   (1mb JSON / 25mb multipart)
 4. ThrottlerGuard (Redis)      (vfm:rl:* — global, login, upload profili)
 5. JwtAuthGuard                (Bearer access token; provjera iss/aud/exp + clientType)
 6. TokenVersionGuard           (Redis vfm:tokenver:{userId} == claim.tv  → inače 401 TOKEN_REVOKED)
 7. PermissionsVersionGuard     (Redis vfm:permver:* >= claim.pv        → inače 401 PERMISSIONS_STALE)
 8. ClientTypeGuard             (MOBILE_ANDROID token + SUPER_ADMIN     → 403 MOBILE_ACCESS_FORBIDDEN)
 9. PermissionsGuard            (učita permisije iz keša/DB, provjeri kod + scope)
10. ZodValidationPipe           (DTO iz @vfm/shared; greške → 422 s mapom po poljima)
11. IdempotencyInterceptor      (Idempotency-Key → Redis vfm:idem:{userId}:{key}, 24 h)
12. Handler (servis)            (transakcija: poslovni upis + OutboxEvent + AuditLog)
13. AuditInterceptor            (before/after diff, actor, IP, UA, requestId, clientType)
14. ResponseEnvelopeInterceptor ({ data, meta }) + redigovanje tajni
```

**Pravilo:** koraci 5–9 se **nikad** ne zaobilaze; nijedan endpoint nema `@Public()` osim
`/auth/login`, `/auth/refresh`, `/health/*` i (opciono) `/metrics`.

---

## 5. Ključni tokovi

### 5.1 Prijava (web) i zabrana mobilnog pristupa Super Admina

```
Klijent                         API                                   Redis/DB
  │ POST /auth/login {email,password,clientType}                        
  │────────────────────────────▶│ Throttler (5/15min po IP+email)       
  │                             │ SELECT user + roles + role.allowedClientTypes
  │                             │ argon2id verify                       
  │                             │ ── ako clientType=MOBILE_* i SUPER_ADMIN:
  │                             │    AuditLog(SECURITY, MOBILE_ACCESS_FORBIDDEN)
  │◀──── 403 ───────────────────│    403 MOBILE_ACCESS_FORBIDDEN        
  │                             │ ── inače:                             
  │                             │ INSERT RefreshSession(hash, device, clientType, expiresAt)
  │                             │ JWT access (10m) { sub, roles, tv, pv, ct }
  │◀──── 200 {accessToken} + Set-Cookie: vfm_refresh (httpOnly, Secure, SameSite=Lax, Path=/api/v1/auth)
```

`tv` = `tokenVersion`, `pv` = `permissionsVersion`, `ct` = `clientType`. **Permisije nisu u
tokenu** — uvijek se čitaju iz keša/DB, pa revokacija djeluje odmah (B-06).

### 5.2 Kreiranje zadatka → obavijest → atomsko preuzimanje

```
Administrator(mobilna) ──POST /tasks (Idempotency-Key)──▶ api
   │                                                        │ BEGIN
   │                                                        │  INSERT Task(status=OPEN, formSchemaVersionId=SNAPSHOT)
   │                                                        │  INSERT TaskAssignment[] (pozvani / direktna dodjela)
   │                                                        │  INSERT TaskEvent(CREATED)
   │                                                        │  INSERT OutboxEvent(TASK_CREATED)      ← ista transakcija
   │                                                        │  INSERT AuditLog
   │                                                        │ COMMIT
   │◀────────────── 201 {task} ─────────────────────────────┘
                                       │
              BullMQ: vfm-queue-outbox (worker)
                                       │  claim eventa (FOR UPDATE SKIP LOCKED)
                                       │  resolve primaoca (pozvani ∪ postavke ∪ permisije)
                                       │  INSERT Notification (ON CONFLICT (notification_key) DO NOTHING)  ← idempotentno
                                       │  enqueue vfm-queue-notifications
                                       ▼
              worker: FCM send (po DeviceToken, zaključan vfm:lock:fcm:{userId})
                                       │  success → NotificationDelivery(SENT)
                                       │  UNREGISTERED → DeviceToken.status=INVALID
                                       │  5xx/timeout → retry 5× exponential → FAILED/DEAD
                                       └─ ZADATAK JE VEĆ COMMIT-AN: greška push-a ga NE dira (P8)
Obični korisnici:
  web    → SSE vfm:sse:{userId} (Redis pub/sub) → badge + toast
  mobile → FCM data message → tap → deep link /tasks/:id
```

**Atomsko preuzimanje (P6)** — jedan SQL statement, bez `SELECT` pa `UPDATE`:

```sql
-- 1) zaključaj i preuzmi u jednom koraku
WITH claimed AS (
  UPDATE "Task"
     SET "status"      = 'IN_PROGRESS',
         "claimedAt"   = now(),
         "version"     = "version" + 1
   WHERE "id"          = $1
     AND "status"      = 'OPEN'
     AND "deletedAt"   IS NULL
   RETURNING "id", "version"
)
SELECT * FROM claimed;      -- 0 redova ⇒ već preuzet ⇒ 409
```

Drugi pojas zaštite (defense in depth):

```sql
-- samo jedan ASSIGNEE po zadatku, zauvijek
CREATE UNIQUE INDEX ux_task_assignment_assignee
  ON "TaskAssignment" ("taskId") WHERE "role" = 'ASSIGNEE';
```

Nakon toga, u istoj transakciji: `INSERT TaskAssignment(role=ASSIGNEE)`,
`INSERT TaskEvent(CLAIMED)`, `INSERT OutboxEvent(TASK_CLAIMED)`, `INSERT AuditLog`.
Retry klijenta štiti `Idempotency-Key` (U-06).

### 5.3 Završetak zadatka

```
Izvšilac ──POST /tasks/:id/complete {formValues, attachmentIds[], comment}
   api: provjeri assigneeUserId == actor  ILI  permisija task:complete_override
   BEGIN
     UPDATE Task SET status='COMPLETED', completedAt=now(),
                     durationMinutes = EXTRACT(EPOCH FROM (now()-claimedAt))/60, version=version+1
       WHERE id=$1 AND status='IN_PROGRESS' AND (assigneeUserId=$2 OR $3::boolean)
     -- validacija formValues prema Task.formSchemaVersionId (form-engine)
     UPDATE Task SET formData=$4, <normalizovane kolone> ...
     INSERT TaskEvent(COMPLETED), OutboxEvent(TASK_COMPLETED), AuditLog
   COMMIT
   ← push administratoru (outbox)
```

### 5.4 Objava verzije forme (P9)

```
Super Admin (web Form Builder)
  POST /form-schemas/:id/versions/:vid/publish {changeNote}
    api:
      1) status == DRAFT ?
      2) form-engine: validna definicija, jedinstveni fieldKey, nema reservedKeys,
         svi tipovi podržani na mobile, izrazi prolaze AST provjeru (dubina/dužina/funkcije)
      3) kompatibilnost: normalizovane kolone postoje, tipovi se ne sukobljavaju s FieldKeyRegistry
      4) BEGIN
           UPDATE ... SET status='RETIRED' WHERE schemaId=$1 AND status='PUBLISHED'
           UPDATE ... SET status='PUBLISHED', publishedAt=now(), contentHash=sha256(definition),
                          changeNote=$2, version=(max+1)
           INSERT FieldKeyRegistry (nove ključeve)
           INSERT AuditLog (diff definicije)
           bump Redis vfm:cache:activeform:* invalidacija
         COMMIT
      5) DB trigger: UPDATE/DELETE nad PUBLISHED redom → EXCEPTION (immutabilnost)
```

### 5.5 Podsjetnici (idempotentni, P13)

```
worker: repeatable job "reminders:scan"  (cron 0 6 * * * Europe/Sarajevo)
  lock: SET vfm:lock:reminder-scan NX EX 600
  za svaku ReminderPolicy (registration/insurance/service/driver_license/technical_inspection):
     SELECT kandidati iz NORMALIZOVANIH kolona (validUntil, nextServiceDueDate/Km, licenseExpiresAt)
     za svaki prag (npr. 14/7/3/1/0 dana):
        INSERT INTO "ScheduledReminder"(dedupeKey, ...)
        VALUES ($1,...) ON CONFLICT (dedupeKey) DO NOTHING      ← idempotentnost
        ako je insert prošao → INSERT OutboxEvent(REMINDER_DUE)
  outbox → Notification → FCM/SSE
  (ponovni run istog dana: 0 novih redova — dokaz u testu)
```

---

## 6. Komponente workera (BullMQ)

| Queue | Job | Trigger | Retry | Napomena |
|---|---|---|---|---|
| `vfm-queue-outbox` | `outbox.process` | `repeatable` (svakih `OUTBOX_POLL_INTERVAL_MS`) + BullMQ event | 8× | `FOR UPDATE SKIP LOCKED` nad `OutboxEvent`; batch 50 |
| `vfm-queue-notifications` | `notification.push` | iz outbox joba | 5× exp. backoff | FCM po tokenu; označava `INVALID` tokene |
| `vfm-queue-reminders` | `reminders.scan` | cron `REMINDERS_SCHEDULE_CRON` | 3× | Idempotentan (dedupeKey) |
| `vfm-queue-reports` | `reports.export` | iz API-ja (veliki izvozi) | 3× | Piše u `REPORT_EXPORT_PATH`, signed URL |
| `vfm-queue-maintenance` | `maintenance.*` | dnevno | 3× | Čišćenje: istekli idempotency ključevi, `INVALID` tokeni, stari exporti, audit retencija, `VACUUM ANALYZE` preporuka, provjera disk prostora |

**Pravila:**
- `worker` scale **mora** biti 1 (BullMQ koristi Redis lockove; više replika je moguće samo uz
  eksplicitan `Worker` concurrency, ne uz compose `replicas`).
- Graceful shutdown: `SIGTERM` → `worker.close()` (čekanje aktivnih jobova do
  `SHUTDOWN_TIMEOUT_MS`) → `process.exit(0)`; tini prosljeđuje signale.
- Neuspjeli jobovi nakon iscrpljenih pokušaja idu u `failed`/DLQ → alert
  (`OUTBOX_DEAD_ALERT_THRESHOLD`) → vidljivo u `/metrics` i u Super Admin „Sistem" ekranu.

---

## 7. Keširanje i invalidacija

| Podatak | Ključ | TTL | Invalidacija |
|---|---|---|---|
| Permisije korisnika | `vfm:perm:{userId}` | 60 s | bump `vfm:permver:role:{roleId}` + `vfm:permver:global`; `DEL` pri promjeni |
| Verzije permisija | `vfm:permver:*` | trajno | — |
| `tokenVersion` | `vfm:tokenver:{userId}` | trajno | bump pri logout-all/promjeni lozinke/deaktivaciji |
| Aktivna verzija forme | `vfm:cache:activeform:{subject}` | 300 s | pri publish/retire |
| Nepročitane obavijesti | `vfm:cache:unread:{userId}` | 300 s | pri novoj obavijesti / read |
| Dashboard KPI | `vfm:cache:stats:dashboard` | 60 s | TTL |
| Postavke | `vfm:cache:settings` | 300 s | pri izmjeni postavke |

**Princip:** keš je uvijek *may-be-stale* za ≤ TTL; autorizacijski podaci imaju **dodatnu**
provjeru verzije, tako da TTL ne utiče na sigurnost (B-06).

---

## 8. Podaci i transakcije

- **Jedna transakcija = jedan poslovni događaj + outbox + audit.** Nikad se push/HTTP poziv ne radi
  unutar transakcije.
- **Izolacija:** `READ COMMITTED` (default). Za kritične tokove (claim, montaža guma, publish forme)
  koristimo **uslovno ažuriranje** (`UPDATE ... WHERE status=...`) ili `SELECT ... FOR UPDATE`,
  ne viši nivo izolacije (manje mrtvih zaključavanja).
- **Migracije:** expand/contract (prvo dodaj kolonu, popuni, pa ukloni staro) → rollback je uvijek
  moguć bez gubitka podataka.
- **Normalizovano vs JSONB:** statusi, rokovi, kilometraža, iznosi, relacije = kolone; sve ostalo =
  `formData` JSONB. Mapiranje deklarativno kroz `FormSchemaVersion.normalizedName` (U-03).

---

## 9. Sigurnosna arhitektura

| Sloj | Kontrola |
|---|---|
| Mreža | Baza i Redis bez objavljenih portova; `db_net`/`redis_net` interne; Traefik terminira TLS; firewall: samo 80/443 |
| Redis | ACL (`default off`, `vfm-api`, `vfm-worker`, `vfm-readonly`), `~vfm:*`, bez `+config/+acl/+keys`; `noeviction`; AOF |
| Aplikacija | helmet, CORS allowlist, rate limit, Zod validacija, autorizacija po endpointu **i** zapisu, redigovanje tajni |
| Autentifikacija | argon2id, rotirajući refresh token (hash), reuse detection, lockout, `tokenVersion` |
| Tajne | env/Coolify ENV; Firebase service account kao **file mount** samo za api/worker; nikad u bundle-u |
| Prilozi | whitelist MIME + magic bytes + max veličina + SHA-256 + signed URL + provjera permisija + audit pristupa |
| Podaci | soft delete, audit diff, PII permisija `driver:view_pii`, EXIF čišćenje, šifrovanje u tranzitu |
| Ops | non-root kontejneri, `no-new-privileges`, `cap_drop: ALL`, read-only root fs (web), healthchecks, log rotation |

Detalji i threat model: [`05-RBAC_PERMISIJE_SIGURNOST.md`](05-RBAC_PERMISIJE_SIGURNOST.md).

---

## 10. Deployment pogled (Coolify)

```
Coolify Project: "Vozni park"
├── Environment: production
│   ├── Resource: PostgreSQL 17        → destination: db_net      (Coolify DB resurs)
│   ├── Resource: Redis 7.4            → destination: redis_net   (Custom Redis config + ACL mount)
│   └── Resource: VFM (Compose)        → build strategy: Compose
│         docker-compose.yml: migrate, api, worker, web
│         Domains:  https://voznipark.<domena>     → service web :80
│                   https://api.voznipark.<domena> → service api :3000
│         Advanced: Connect To Predefined Network → db_net i redis_net
│                   Consistent Container Names → UKLJUČENO
│         Environment Variables ← .env.example (1:1)
│         Persistent Storage: host bind-mount za priloge
└── Environment: staging (ista struktura, druge domene/baze)
```

Kompletni koraci, backup/restore i rollback: [`08-DOCKER_COOLIFY_DEPLOYMENT.md`](08-DOCKER_COOLIFY_DEPLOYMENT.md).

---

## 11. Odluke koje proizlaze iz arhitekture (posljedice za kod)

1. `apps/api/src/config/env.ts` je **jedino** mjesto gdje se čita `process.env`; sve ostalo prima
   tipizirani `AppConfig` kroz DI. Startup bez validnog env-a = `process.exit(1)` s jasnom porukom.
2. Tri Redis konekcije (api/worker/readonly) → tri `ioredis` instance s različitim ACL korisnicima;
   nijedan modul ne smije uzeti „default" konekciju.
3. Svaki servis koji piše poslovni podatak **mora** pozvati `OutboxService.enqueue()` unutar iste
   transakcije (helper `prisma.$transaction` + `withOutbox`).
4. Nijedan kontroler ne radi autorizaciju ručno — isključivo `@RequirePermissions()` + scope.
5. `packages/shared` ne smije importovati ništa iz `apps/*` (zavisnost je jednosmjerna).
6. Mobilna aplikacija nikad ne poziva PostgreSQL/Redis direktno i nikad ne sadrži Firebase service
   account — samo `google-services.json` (javni klijentski config).
