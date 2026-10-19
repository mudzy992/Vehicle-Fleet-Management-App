# 08 — Docker, Docker Compose i Coolify deployment

**Verzija:** 1.0.0 · **Stack:** Coolify (Docker Compose build pack) + Traefik + PostgreSQL 17 + Redis 7.4
**Mreže:** `db_net` (PostgreSQL), `redis_net` (Redis) · **Prefix:** `vfm`

> ⚠️ Ovaj dokument i [`.env.example`](../.env.example) i [`REDIS_ACL.md`](../REDIS_ACL.md) čine
> **jednu cjelinu**. Promjena bilo kojeg od njih zahtijeva provjeru ostala dva.

---

## 1. Arhitektura deploymenta

```
Internet ──▶ :443 Traefik (Coolify proxy)
               ├── https://voznipark.<domena>      → vfm-web :80   (nginx, SPA + /api proxy)
               └── https://api.voznipark.<domena>  → vfm-api :3000 (REST, mobilna aplikacija)

Coolify default mreža:  vfm-web · vfm-api · vfm-worker · vfm-migrate · traefik
db_net    (external):   vfm-api · vfm-worker · vfm-migrate · postgres-<uuid>
redis_net (external):   vfm-api · vfm-worker · vfm-migrate · redis-<uuid>
Host bind-mount:        /data/vfm/attachments  →  /data/vfm/attachments (api, worker)
Host secret mount:      /etc/vfm/secrets/firebase-service-account.json → /run/secrets/vfm/… :ro (api, worker)
```

**Zašto je `web` samo na Coolify mreži:** Coolify dokumentacija upozorava da kontejner na dvije
mreže može postati nedostupan (Traefik nedeterministički bira IP → 504/hang). `web` ne treba bazu ni
Redis, pa ga ne kačimo na `db_net`/`redis_net`.

---

## 2. Fajlovi u repozitoriju

| Fajl | Namjena |
|---|---|
| `docker-compose.yml` | Produkcijski/Coolify stack: `migrate`, `api`, `worker`, `web` |
| `docker-compose.coolify.yml` | Opcioni hardening override (security_opt, cap_drop, read-only, limiti) |
| `docker-compose.dev.yml` | Lokalni dev: `vfm-postgres`, `vfm-redis` + override-i (portovi na 127.0.0.1) |
| `apps/api/Dockerfile` | Multi-stage: builder (pnpm+turbo) → runtime (alpine, non-root, tini) |
| `apps/web/Dockerfile` | Multi-stage: Vite build → nginx:1.27-alpine |
| `apps/web/nginx/nginx.conf.template` | SPA fallback, `/api` proxy, gzip, security headers, healthz |
| `.dockerignore` | Bez `.env`, bez tajni, bez `apps/mobile` build artefakata |
| `infra/redis/redis.conf` | Dev Redis konfiguracija (`aclfile`, `noeviction`, AOF) |
| `infra/redis/users.acl.example` | Dev ACL (plaintext `vfm_dev_only`) — produkcija koristi `REDIS_ACL.md` §1 |
| `infra/postgres/init/01-extensions.sql` | `pgcrypto`, `btree_gist`, `citext` |
| `scripts/env-sync-check.mjs` | CI provjera sinhronizacije compose ↔ `.env.example` |
| `scripts/gen-secrets.mjs` | Generisanje tajni + Redis ACL hash-ova |
| `scripts/backup-db.sh` / `restore-db.sh` | Backup/restore (Faza 8) |

---

## 3. Preduslovi na serveru (jednokratno)

```bash
# 1) Docker mreže (ako ih Coolify već nije kreirao kao Destinacije)
docker network create db_net      2>/dev/null || true
docker network create redis_net   2>/dev/null || true
docker network ls | grep -E 'db_net|redis_net'

# 2) Direktoriji na hostu
sudo mkdir -p /data/vfm/attachments /data/vfm/backups /data/coolify/redis-acl /etc/vfm/secrets
sudo chown -R 1001:1001 /data/vfm          # uid:gid iz Dockerfile-a (vfm korisnik)
sudo chmod 750 /data/vfm/attachments

# 3) Firewall: samo 80/443 (+ SSH na custom portu)
sudo ufw allow 80,443/tcp && sudo ufw enable
# NIKAKO ne otvarati 5432 / 6379

# 4) Prostor i backup
df -h /data      # preporuka ≥ 20 GB slobodno
```

> U Coolify-u se mreže mogu kreirati i kao **Destinations** (Servers → Destinations → New), što je
> čistije jer ih Coolify tada sam upravlja i spaja s proxy-jem.

---

## 4. Coolify resursi — korak po korak

### 4.1 PostgreSQL

1. **Project:** `Vozni park` → **Environment:** `production` → **+ New Resource → Database → PostgreSQL 17**.
2. General:
   - **Name:** `vfm-postgres` (Coolify će generisati `postgres-<uuid>` — to je hostname!)
   - **Destination:** `db_net`
   - DB name `vfm`, user `vfm`, password → generisan ili iz `DATABASE_PASSWORD`.
3. **Ports:** Public access = **Off** (baza nije javna).
4. **Advanced:** uključi **Consistent Container Names** (lakše pamćenje hostname-a).
5. **Scheduled Backups:** dnevno u 03:00, retencija 14 dana + kopija na off-site (R-10).
6. Zapiši **Postgres URL (internal)** → koristi se za `DATABASE_URL`:
   `postgresql://vfm:<PASSWORD>@postgres-<uuid>:5432/vfm?schema=public&connection_limit=10`
7. Ekstenzije (jednom, kroz Coolify Terminal na DB kontejneru):
   ```sql
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   CREATE EXTENSION IF NOT EXISTS citext;
   ```

### 4.2 Redis

1. **+ New Resource → Database → Redis 7.4**, **Destination:** `redis_net`, naziv `vfm-redis`.
2. **General → Custom Redis configuration** (vidi `REDIS_ACL.md` §2):
   ```
   aclfile /etc/redis/users.acl
   appendonly yes
   appendfsync everysec
   maxmemory-policy noeviction
   save ""
   ```
   ⚠️ Ne dodavati `requirepass` — uz `aclfile` se ignoriše, a `user default off` u ACL fajlu
   blokira anonimni pristup.
3. **ACL fajl na hostu** (`REDIS_ACL.md` §2):
   `/data/coolify/redis-acl/vfm-users.acl` s hash-ovima iz `scripts/gen-secrets.mjs --redis`.
4. **Custom Docker Options / Compose** Redis resursa → mount:
   ```yaml
   services:
     redis:
       volumes:
         - /data/coolify/redis-acl/vfm-users.acl:/etc/redis/users.acl:ro
   ```
5. **Public access:** Off. Restart resursa.
6. Provjera (`REDIS_ACL.md` §5): `ACL LIST`, `PING` s `vfm-api`, test ključa s i bez `vfm:` prefixa.
7. Zapiši **Redis URL (internal)** → `REDIS_HOST=redis-<uuid>`.

> ⚠️ **Ako se bilo šta u ovom koraku mijenja (novi user, novi prefix, nova komanda), `REDIS_ACL.md`
> se mora ažurirati u istom trenutku.**

### 4.3 Aplikacija (Docker Compose)

1. **+ New Resource → Application → Git repository** (`mudzy992/Vehicle-Fleet-Management-App`).
2. **General → Build pipeline:**
   - Build strategy: **Compose**
   - Base Directory: `/`
   - Docker Compose Location: `docker-compose.yml`
   - Branch: `main` (deploy preko webhooka na push)
   - **Preserve repository during deployment:** ✅ (zbog bind-mount izvora iz repo-a)
3. **Advanced → Docker compose → Predefined network:** ✅ **Connect to predefined network** →
   odabrati `db_net` i `redis_net` (ako Coolify podržava jednu destinaciju, odaberi `db_net`, a
   `redis_net` ostaje `external: true` u compose-u — mreža već postoji na hostu, pa radi).
4. **Domains → Add domain:**
   | Service | Domain | Port |
   |---|---|---|
   | `web` | `https://voznipark.<domena>` | 80 |
   | `api` | `https://api.voznipark.<domena>` | 3000 |
   | `migrate` | — (bez domene!) | — |
   | `worker` | — (bez domene!) | — |
5. **Environment Variables** → kopirati iz `.env.example`, popuniti stvarne vrijednosti:
   - obavezne (`:?`): `DATABASE_URL`, `REDIS_HOST`, `REDIS_USER_API`, `REDIS_PASSWORD_API`,
     `REDIS_USER_WORKER`, `REDIS_PASSWORD_WORKER`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
     `FILE_SIGNING_SECRET`, `CORS_ORIGINS`, `VFM_STORAGE_PATH`
   - generisati sa `node scripts/gen-secrets.mjs`
   - `CORS_ORIGINS=https://voznipark.<domena>`
   - `SWAGGER_ENABLED=false`, `APP_ENV=production`
6. **Persistent Storage:** host bind-mount `/data/vfm/attachments → /data/vfm/attachments`
   (već definisan u compose-u kroz `${VFM_STORAGE_PATH}`; u Coolify-u se prikazuje kao parsed
   storage i read-only — mijenja se isključivo u compose fajlu).
7. **Deploy** → pratiti Deployment Logs → provjeriti Runtime Logs za `api`, `worker`, `web`.

### 4.4 Firebase service account (tajna)

```bash
# Na hostu (NIKAD u Git):
sudo cp firebase-service-account.json /etc/vfm/secrets/firebase-service-account.json
sudo chown 1001:1001 /etc/vfm/secrets/firebase-service-account.json
sudo chmod 400      /etc/vfm/secrets/firebase-service-account.json
```
U `.env` / Coolify ENV: `FIREBASE_ENABLED=true`, `FIREBASE_PROJECT_ID=…`,
`FIREBASE_SERVICE_ACCOUNT_HOST_PATH=/etc/vfm/secrets/firebase-service-account.json`.
Compose ga montira kao `:ro` **samo** u `api` i `worker`. Web i mobilna ga nikad ne dobijaju.

---

## 5. Lokalni razvoj

```bash
cp .env.example .env
node scripts/gen-secrets.mjs --write .env --redis     # popuni tajne + ispiše ACL hash-ove

# Infrastruktura + aplikacija
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# ili samo baza i redis (brže, uz pnpm dev na hostu)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d vfm-postgres vfm-redis
pnpm install && pnpm dev                               # turbo watch: api :3000, web :5173

# provjere
curl -s localhost:3000/health/live
curl -s localhost:8080/healthz
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f api worker
node scripts/env-sync-check.mjs
```

Dev portovi: API `127.0.0.1:3000`, web `127.0.0.1:8080`, PostgreSQL `127.0.0.1:5433`,
Redis `127.0.0.1:6380`. Mobilna (Expo) u dev-u: `EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000/api/v1`.

---

## 6. Migracije, seed i bootstrap

- `migrate` servis se pokreće **prije** `api`/`worker` (`depends_on: service_completed_successfully`).
- Radi: `prisma migrate deploy` → (opciono, `RUN_DB_SEED=true`) `prisma db seed` →
  (opciono, `BOOTSTRAP_SUPER_ADMIN_ENABLED=true`) bootstrap prvog Super Admina → `exit 0`.
- Retry petlja na DB (`PGCONNECT_TIMEOUT`, max 30 pokušaja) jer je PostgreSQL eksterni resurs i
  `depends_on` ne može čekati njegov healthcheck.
- Lock: `SET vfm:lock:migrate NX EX 300` u Redisu → sprječava paralelne migracije pri redeployu.
- **Nikad** `prisma db push` ili `migrate reset` nad produkcijskom bazom.
- Bootstrap lozinka se ispisuje **jednom** u Deployment Logs → odmah je preuzeti i promijeniti pri
  prvoj prijavi (`mustChangePassword=true`).

---

## 7. Plan B: `web` kao zaseban Coolify resurs

Ako se na `api` domeni pojave povremeni **504/hang** (Coolify + Traefik + dvije mreže), primijeniti:

1. Novi Coolify **Application** (build pack: **Dockerfile**) → `apps/web/Dockerfile`,
   Base directory `apps/web`, domena `voznipark.<domena>`, **bez** `db_net`/`redis_net`.
2. Iz postojećeg compose stacka izbaciti servis `web` (ili ga ostaviti bez domene kao interni).
3. `WEB_API_INTERNAL_URL` više ne radi (različiti compose projekti) → web koristi
   `VITE_PUBLIC_API_URL=https://api.voznipark.<domena>/api/v1` (direktni pozivi iz browsera),
   a `CORS_ORIGINS` ostaje `https://voznipark.<domena>`.
4. Testirati login (cookie `SameSite=Lax` + `Secure` radi jer su oba origin-a HTTPS; za cross-site
   cookie koristiti `SameSite=None` **samo** uz `Secure` i uz provjeru CSRF zaštite).

Preporuka: početi s jednim stackom (jednostavnije), a Plan B držati spreman.

---

## 8. Deploy, nadogradnja i rollback

### 8.1 Deploy tok
```
git push (main) → GitHub webhook → Coolify build (Dockerfile/compose)
  → migrate (prisma migrate deploy) → api → worker → web
  → Traefik preusmjeri saobraćaj nakon healthcheck-a
  → smoke test: /health/ready, login, lista vozila, jedan zadatak (claim/complete)
```

### 8.2 Nadogradnja (expand/contract)
1. Migracija **prvo** dodaje (nove kolone nullable, nove tabele) — stara verzija koda radi.
2. Deploy novog koda; podaci se pišu u oba mjesta ako je potrebno.
3. Nakon stabilizacije (≥ 1 dan) — contract migracija uklanja staro.

### 8.3 Rollback
```bash
# 1) Kod: Coolify → Deployments → prethodni deployment → Rollback (ili git revert + push)
# 2) Baza: ako je contract migracija već prošla → restore iz backup-a (vidi §9)
# 3) Provjera: /health/ready + smoke testovi
```
**Pravilo:** rollback koda nikad ne podrazumijeva automatski rollback baze. Zato su migracije
unaprijed kompatibilne (8.2).

---

## 9. Backup i restore (P15, P16)

### 9.1 Šta se backup-uje
| Podatak | Način | Učestalost | Retencija |
|---|---|---|---|
| PostgreSQL | `pg_dump -Fc` + Coolify Scheduled Backup | dnevno 03:00 | 14 dana lokalno, 90 off-site |
| Prilozi (`/data/vfm/attachments`) | `restic`/`tar` + šifrovanje → drugi host/objekat | dnevno 04:00 | isto |
| Redis | **ne** (sadrži keš/queue; AOF je dovoljan za restart) | — | — |
| Konfiguracija | `.env` (Coolify ENV export), `REDIS_ACL.md`, compose fajlovi (Git) | pri promjeni | Git historija |

### 9.2 `scripts/backup-db.sh` (skica — implementacija u Fazi 8)
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?}" ; : "${BACKUP_DIR:=/data/vfm/backups}" ; : "${RETENTION_DAYS:=14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --compress=9 --no-owner --dbname="$DATABASE_URL" \
        --file="$BACKUP_DIR/vfm-$STAMP.dump"
tar -C /data/vfm -czf "$BACKUP_DIR/vfm-attachments-$STAMP.tar.gz" attachments
find "$BACKUP_DIR" -name 'vfm-*' -mtime +"$RETENTION_DAYS" -delete
sha256sum "$BACKUP_DIR/vfm-$STAMP.dump" > "$BACKUP_DIR/vfm-$STAMP.dump.sha256"
echo "OK $STAMP"
```

### 9.3 Testirani restore
```bash
# u testnom okruženju (druga baza!)
pg_restore --clean --if-exists --no-owner --dbname="$TEST_DATABASE_URL" vfm-<STAMP>.dump
tar -C /data/vfm-test -xzf vfm-attachments-<STAMP>.tar.gz
pnpm --filter @vfm/api exec prisma migrate status
curl -s localhost:3000/health/ready
```
Rezultat (trajanje, broj zapisa, checksum) se **zapisuje** u `docs/10-OPERACIJE.md` → kriterij P16.

---

## 10. Održavanje i operacije

| Operacija | Komanda / mjesto |
|---|---|
| Logovi | Coolify → Resource → Runtime Logs, ili `docker logs vfm-api --since 1h` |
| Restart | Coolify → Restart / `docker compose -f docker-compose.yml restart api worker` |
| Redeploy | Coolify → Deploy (povlači novi commit) |
| Migracija ručno | `docker exec vfm-api node dist/tools/migrate.js` |
| Redis inspekcija | `docker exec -it redis-<uuid> redis-cli --user vfm-readonly --pass '<PASS>'` |
| Queue stanje | `GET /api/v1/system/queue` (`system:view_queue`) ili `vfm:queue:*` kroz `vfm-readonly` |
| Backup ručno | `scripts/backup-db.sh` (cron/systemd timer ili Coolify scheduled task) |
| Ažuriranje ACL-a | `REDIS_ACL.md` §5 |
| Čišćenje disk prostora | `POST /api/v1/system/maintenance/cleanup-exports` |

---

## 11. Troubleshooting (Coolify-specifično)

| Simptom | Uzrok | Rješenje |
|---|---|---|
| `api` ne može do baze (`ECONNREFUSED`/`ENOTFOUND postgres`) | Kratak hostname ili `db_net` nije eksterna/postojeća | Koristi `postgres-<uuid>`; `docker network ls`; Coolify → Connect to predefined network |
| Aplikacija se spoji na **pogrešnu** bazu | DNS kolizija: `postgres` na dijeljenoj mreži = Coolify internal DB | Puni naziv `postgres-<uuid>`; Consistent Container Names; zasebna destinacija |
| 504 / hang na web ili api domeni | Kontejner na dvije mreže, Traefik bira pogrešan IP | `web` samo na Coolify mreži; ili Plan B (§7) |
| `network db_net declared as external, but could not be found` | Mreža nije kreirana | `docker network create db_net` ili kreirati Destination |
| Redis `NOPERM` | ACL user/pattern ne odgovara ključevima | `REDIS_ACL.md` §1 i §6 |
| Redis `WRONGPASS` | `requirepass` + `aclfile` konflikt | Ukloni `requirepass`; koristi `user default off` |
| BullMQ jobovi nestaju | `maxmemory-policy` evikcija | `noeviction` (§4.2) |
| `migrate` pada odmah | DB još nije spreman / pogrešna lozinka | Retry petlja + provjera `DATABASE_URL` |
| `migrate` kontejner „unhealthy" u Coolify UI-ju | One-shot servis nema healthcheck | Očekivano — ignorisati; nema domenu ni healthcheck |
| Upload pada s 413 | nginx `client_max_body_size` / `BODY_LIMIT_MULTIPART` | Uskladiti (25m) |
| Prilozi 403 nakon migracije servera | Promijenjen `storageKey` korijen ili permisije direktorija | `chown 1001:1001 /data/vfm`; `VFM_STORAGE_PATH` isti |
| Firebase greška `permission denied` | ACL fajl nije montiran / `chmod` | `REDIS_ACL.md` §5 (analogno za file mount) |
| Cookie se ne šalje (web login radi, refresh ne) | `COOKIE_DOMAIN`/`SameSite`/`Secure` | Postaviti `COOKIE_DOMAIN=<domena>`, `SameSite=Lax`, `Secure=true`, `Path=/api/v1/auth` |

---

## 12. Checklist za go-live (Faza 8–9)

- [ ] `db_net` i `redis_net` postoje; PostgreSQL i Redis su na njima, bez javnih portova.
- [ ] `DATABASE_URL` i `REDIS_HOST` koriste **pune** Coolify nazive kontejnera.
- [ ] Redis ACL aktiviran (`ACL LIST` pokazuje `default off` + 3 `vfm-*` usera) i `REDIS_ACL.md` ažuran.
- [ ] Svi ENV iz `.env.example` popunjeni u Coolify-u; nijedna tajna nije u Git-u (gitleaks clean).
- [ ] `/data/vfm/attachments` postoji, `chown 1001:1001`, backup skripta radi.
- [ ] Firebase service account montiran `:ro` samo u `api`/`worker`; `FIREBASE_ENABLED=true`.
- [ ] Domene + TLS (Let's Encrypt) rade; `CORS_ORIGINS` tačan; cookie `Secure`.
- [ ] `SWAGGER_ENABLED=false`, `APP_ENV=production`, `LOG_FORMAT=json`.
- [ ] Healthchecks zeleni (`/health/live`, `/health/ready`, `web /healthz`).
- [ ] Migracije prošle; seed/bootstrap izvršen; Super Admin lozinka promijenjena.
- [ ] Smoke testovi: login (web), mobilni login Super Admina **odbijen**, kreiranje zadatka,
      paralelni claim (1 izvršilac), push primljen, prilog upload/download.
- [ ] Backup izvršen i **restore testiran** u testnom okruženju (P16).
- [ ] Monitoring/uptime uključen; alerti za disk, queue depth, outbox DEAD.
- [ ] `node scripts/env-sync-check.mjs` → ✅ OK.
