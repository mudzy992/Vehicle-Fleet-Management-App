# 10 — Operacije, monitoring i runbook

**Verzija:** 1.0.0 · **Cilj:** sistem se može održavati bez čitanja izvornog koda.

---

## 1. Ciljevi dostupnosti i oporavka

| Parametar | Vrijednost | Obrazloženje |
|---|---|---|
| Dostupnost (mjesečno) | ≥ 99 % | jedan server, interni sistem; ~7 h zastoja mjesečno je prihvatljivo (uklj. održavanje) |
| **RPO** (max gubitak podataka) | ≤ 24 h | dnevni backup baze + prilogа; za strožije → kontinuirani WAL arhiv (v2) |
| **RTO** (max vrijeme oporavka) | ≤ 4 h | restore iz backup-a + redeploy |
| Planirano održavanje | van radnog vremena, najava 24 h | deploy/rollback |

---

## 2. Nadzorna ploča operatera

| Mjesto | Šta gledati |
|---|---|
| Coolify → Resource → Runtime Logs | `api`, `worker`, `migrate` — greške, `NOPERM`, `ECONNREFUSED` |
| Coolify → Deployments | uspješnost i trajanje builda, rollback |
| `GET /api/v1/health/ready` | DB, Redis, disk, Firebase |
| `GET /api/v1/system/queue` | dubina queue-ova, failed/DLQ brojači, trajanje jobova |
| `GET /api/v1/system/metrics` | Prometheus metrike (ako `METRICS_ENABLED=true`) |
| Web → Sistem (`system:view_health`) | isto kroz UI, uz zadnje sigurnosne događaje |
| `docker stats` | CPU/mem po kontejneru |
| `df -h /data` | prostor za priloge i backup |

---

## 3. Metrike i pragovi alarma

| Metrika | Izvor | Upozorenje | Kritično |
|---|---|---|---|
| `vfm_http_requests_total{status=~"5.."}` | API | > 1 % u 5 min | > 5 % u 5 min |
| `vfm_http_request_duration_seconds` p95 | API | > 0,4 s | > 1,5 s |
| `vfm_outbox_pending` | worker/DB | > 100 | > 500 ili raste 30 min |
| `vfm_outbox_dead_total` | worker/DB | ≥ 1 (`OUTBOX_DEAD_ALERT_THRESHOLD`) | ≥ 5 |
| `vfm_queue_depth{queue}` | Redis | > `ALERT_QUEUE_DEPTH` (100) | > 1000 |
| `vfm_fcm_send_failures_total` | worker | > 10/h | > 50/h |
| `vfm_disk_usage_percent{mount="/data"}` | node/`df` | > 85 % | > 95 % |
| `vfm_db_pool_in_use` | Prisma | > 80 % pool-a | = 100 % (čekanje) |
| `vfm_redis_connection_errors` | ioredis | > 0 u 1 min | > 10 u 5 min |
| `vfm_auth_failed_logins_total` | API | > 20/15 min | > 100/15 min (napad) |
| Kontejner restart count | Docker | ≥ 1 | ≥ 3 u 10 min (crash loop) |
| `migrate` exit code | Compose | ≠ 0 | ≠ 0 (blokira deploy) |

**Kako se alarmi isporučuju (Faza 8):** (1) Coolify notifications (e-mail/Telegram), (2) uptime
provjera `/health/ready` izvana (`UPTIME_HEARTBEAT_URL`), (3) log warning → `AuditLog(severity=WARN)`
za vidljivost u web UI-u.

---

## 4. Logovi

- Format: **JSON** (`pino`), polja: `time`, `level`, `service` (`api`/`worker`/`migrate`),
  `requestId`, `userId`, `roles`, `method`, `path`, `status`, `durationMs`, `clientType`,
  `queue`, `jobId`, `eventType`, `message`.
- Nivoi: `error` (akcija potrebna), `warn` (nepravilnost), `info` (tok), `debug` (samo dev/staging).
- **Nikad** se ne logiraju: lozinke, tokeni, cookie, PII (osim redigovano), sadržaj fajlova,
  Firebase service account (`AUDIT_REDACT_FIELDS`).
- Rotacija: Docker `json-file` max-size 10 MB, max-file 5 (worker/api), 3 (web/migrate).
- Pretraga: `docker logs vfm-api --since 30m | grep '"level":"error"'` ili kroz Coolify UI.
- Korelacija: `requestId` iz `X-Request-ID` se vraća klijentu u svakom odgovoru i u greškama →
  korisnik prijavi „ID zahtjeva 8f3c…", operater nađe cijeli lanac.

---

## 5. Runbook — česti incidenti

### 5.1 API ne odgovara (502/504 na domeni)
```
1. Coolify → Runtime Logs → api: ima li grešaka pri startu?
2. docker ps | grep vfm          → kontejner alive? restart count?
3. curl -s localhost:3000/health/live   (na hostu, kroz docker exec)
4. Ako live OK a ready NE → zavisnost: DB ili Redis
   - docker exec vfm-api node -e "…" / provjera DATABASE_URL i REDIS_HOST (puni nazivi!)
5. Ako je 504 povremeno → Coolify Traefik + dvije mreže → primijeni Plan B (08-… §7)
6. Restart: Coolify → Restart api (podaci su sigurni, DB je eksterna)
```

### 5.2 Worker ne obrađuje obavijesti (outbox raste)
```
1. GET /api/v1/system/queue → depth, failed, lastError
2. docker logs vfm-worker --since 30m | grep -iE 'NOPERM|WRONGPASS|ECONN|firebase'
   - NOPERM/WRONGPASS → REDIS_ACL.md §6 (ACL user/lozinka)
   - Firebase greške → provjeri mount i FIREBASE_ENABLED/FIREBASE_PROJECT_ID
3. Provjeri scale: mora biti 1 (više replika = dupli leader-i)
4. Restart workera; jobovi se nastavljaju (BullMQ čuva stanje u Redisu + outbox u DB)
5. Ako je outbox DEAD → GET /system/queue, pregledaj payload, POST /system/maintenance/replay-outbox
```

### 5.3 Redis nedostupan
```
1. docker ps | grep redis ; Coolify → Redis resurs → Logs
2. Iz aplikacije: redis-cli --user vfm-readonly --pass '<PASS>' -h redis-<uuid> PING
3. Ako Redis padne: API radi degraded (keš → DB fallback, throttle → fail-open/closed po config),
   worker staje. Nakon oporavka BullMQ nastavlja.
4. Prevencija: maxmemory-policy noeviction, AOF, ACL bez opasnih komandi
```

### 5.4 PostgreSQL nedostupan / veza odbijena
```
1. Coolify → PostgreSQL → Logs; provjeri max_connections i pool (DATABASE_CONNECTION_LIMIT)
2. Disk pun na DB volumenima? df -h
3. Ako je baza korumpirana → restore iz backup-a (§6)
4. Nakon oporavka: /health/ready, migrate status, smoke testovi
```

### 5.5 Disk pun (`/data`)
```
1. du -sh /data/vfm/attachments/* | sort -h | tail
2. POST /api/v1/system/maintenance/cleanup-exports   (briše exporte starije od retencije)
3. Provjeri Attachment soft-delete → fizičko brisanje nakon 90 dana (maintenance job)
4. Privremeno: premjesti backup-e na drugi host
5. Trajno: povećaj disk ili uključi S3 (ADR-14 alternativa — storageKey je već portabilan)
```

### 5.6 Migracija nije prošla
```
1. Coolify → Deployment Logs → migrate: poruka greške
2. Ako je djelomično primijenjena → prisma migrate status; NE pokretati ručno bez provjere
3. Rollback: restore baze iz backup-a (ako je kontraktna migracija) ili popravi migraciju i redeploy
4. Prevencija: expand/contract, testirane migracije na stagingu
```

### 5.7 Push obavijesti ne stižu na Android
```
1. Provjeri DeviceToken: GET /api/v1/devices/tokens (status ACTIVE? failureCount?)
2. FCM konzola → Cloud Messaging → diagnostika po message id (providerMessageId)
3. google-services.json / package name podudaranje (FCM_ANDROID_PACKAGE)
4. Baterijske optimizacije na uređaju (Android agresivno gasi background) → uputa korisniku
5. In-app obavijest MORA stići i bez push-a (P8): provjeri SSE/listu obavijesti
```

### 5.8 Sumnja na kompromitaciju naloga
```
1. Audit log: LOGIN_FAILED/LOGIN po IP-u i UA; SECURITY događaji
2. POST /api/v1/users/:id/force-logout  (tokenVersion++, sve sesije ukinute)
3. POST /api/v1/users/:id/reset-password
4. Privremeno: user:archive ili ukidanje rola
5. Zabilježi incident (§7) i rotiraj tajne ako je potrebno
```

### 5.9 Dva izvršioca na istom zadatku (P6 narušen)
```
1. Odmah: GET /tasks/:id/events → koliko CLAIMED događaja
2. Provjeri SQL: unique index ux_task_assignment_assignee postoji?
3. Provjeri da li je neko ručno mijenjao DB (audit)
4. Ispravi stanje: jedan ASSIGNEE, drugi se prebacuje u INVITED + obavijest + audit
5. Reproduciraj stress test u stagingu; ako pada → hotfix prije sljedećeg deploya
```

---

## 6. Backup/restore procedura (detalji u `08-…` §9)

```bash
# Dnevno (cron 03:00 DB, 04:00 prilozi)
/data/vfm/scripts/backup-db.sh >> /var/log/vfm-backup.log 2>&1

# Kvartalno: testirani restore (obavezno, P16)
scripts/restore-db.sh --to-test-env --dump /data/vfm/backups/vfm-<STAMP>.dump
# zapisati u §8: datum, trajanje, broj zapisa, checksum, odgovorna osoba
```

**Pravilo:** backup koji nije testiran restore-om **ne postoji**.

---

## 7. Klasifikacija incidenata i komunikacija

| Sev | Definicija | Primjer | Vrijeme reakcije | Komunikacija |
|---|---|---|---|---|
| SEV-1 | Sistem nedostupan ili podaci ugroženi | DB down, gubitak podataka, kompromitacija | odmah (< 30 min) | vlasnik + svi korisnici |
| SEV-2 | Glavni tok ne radi | ne može se preuzeti/završiti zadatak, push ne radi > 1 h | < 2 h | administrator + korisnici |
| SEV-3 | Djelomičan problem | spor izvještaj, jedan ekran ne radi | < 1 radni dan | administrator |
| SEV-4 | Kozmetika/pitanje | pogrešan tekst, upit | backlog | — |

Za svaki SEV-1/2 zapisati: vrijeme, uticaj, uzrok, akcija, prevencija → `docs/INCIDENT_LOG.md`
(kreira se pri prvom incidentu).

---

## 8. Evidencija operacija (popunjavati!)

| Datum | Operacija | Rezultat | Osoba |
|---|---|---|---|
| | inicijalni deploy | | |
| | prvi backup | | |
| | prvi testirani restore | | |
| | Redis ACL primijenjen (`REDIS_ACL.md` v1.0.0) | | |

---

## 9. Patching i održavanje zavisnosti

| Aktivnost | Učestalost |
|---|---|
| `pnpm audit` / Dependabot PR-ovi | sedmično (CI) |
| Sigurnosne zakrpe (Node, nginx, alpine, Prisma) | mjesečno ili odmah pri critical CVE |
| Coolify + Traefik ažuriranje | mjesečno (uz najavu i backup prije) |
| PostgreSQL minor verzije | kvartalno |
| Redis minor verzije | kvartalno (uz provjeru ACL kompatibilnosti) |
| Rotacija tajni (`JWT_*`, `FILE_SIGNING_SECRET`, DB, Redis) | 6 mjesečno + pri odlasku osobe |
| Pregled prava (ko ima šta) | kvartalno (Super Admin) |
| Pregled audit loga (SECURITY događaji) | mjesečno |
| Test restore-a | kvartalno |

---

## 10. Kapacitet i skaliranje

| Resurs | Trenutna pretpostavka | Granica | Šta dalje |
|---|---|---|---|
| CPU/RAM | 2 vCPU / 4 GB (api 1 GB, worker 768 MB, web 128 MB, DB/Redis eksterni) | 70 % trajno | vertikalno proširenje |
| PostgreSQL | 10 vozila, ~50 000 zadataka/god, ~5 GB/god s prilozima u FS | disk | particioniranje `TaskEvent`/`AuditLog` po godini (v2) |
| Redis | < 200 MB (queue + keš) | `maxmemory` | odvojeni Redis za queue |
| Prilozi | ~10 GB/god (10 vozila, fotografije kompresovane) | 85 % diska | S3 (ADR-14 alternativa) |
| API instanca | 1 (scale 1) | p95 > 1,5 s | `API_REPLICAS=2` + load balancing (BullMQ i dalje 1 leader po queue-u) |

**Napomena:** BullMQ podržava više worker procesa, ali **compose `replicas` za worker mora ostati 1**
dok se ne uvede eksplicitna koordinacija (Faza 8+ / v2).

---

## 11. Zadaci operatera po fazama

| Faza | Operativni koraci vlasnika |
|---|---|
| 0 | Kreirati `db_net`/`redis_net`, direktorije na hostu, popuniti `.env` iz `.env.example` |
| 1 | Generisati tajne (`gen-secrets.mjs`), bootstrap Super Admin lozinku preuzeti i promijeniti |
| 2 | — |
| 3 | Odlučiti o pragovima podsjetnika (Postavke), potvrditi R-07/R-08 |
| 5 | Kreirati Firebase projekat, dodati Android app, `firebase-service-account.json` na host (400), `FIREBASE_ENABLED=true` |
| 6 | EAS nalog, `google-services.json`, keystore za potpisivanje, Play Console (AAB) |
| 7 | Potvrditi setove izvještaja i retenciju exportova |
| 8 | Domena/DNS/TLS, backup raspored, monitoring/uptime, testirani restore, firewall provjera |
| 9 | UAT, korisnička obuka, hiper-care |
