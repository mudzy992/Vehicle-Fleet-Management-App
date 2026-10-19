# 11 — Produkcijski deploy na Coolify (Faza 0)

> **Namjena:** korak-po-korak uputstvo da se **ova** verzija koda podigne na Coolify
> kao pravi produkcijski stack, uz **globalni PostgreSQL** (`db_net`) i **globalni
> Redis** (`redis_net`) koji već rade na istom Docker hostu.
> Automatski rebuild na svaki `git push` na `main`.
>
> Vezano: [`08-DOCKER_COOLIFY_DEPLOYMENT.md`](08-DOCKER_COOLIFY_DEPLOYMENT.md) (arhitektura
> i pozadina), [`REDIS_ACL.md`](../REDIS_ACL.md) (ACL izvor istine), [`.env.example`](../.env.example)
> (sve varijable).

---

## 0. Šta se tačno deploya (pročitati prije klika na Deploy)

| Dio | Status na ovoj verziji (Faza 0) |
|---|---|
| `web` (React SPA + nginx) | ✅ radi — svi ekrani su **placeholder** (16 ekrana), `/dizajn-sistem`, `/zdravlje` |
| `api` (NestJS) | ✅ diže se, ali ima **samo `/health/*`** i error envelope — **nema poslovnih ruta** |
| `worker` (BullMQ) | ✅ proces radi, queue-ovi se registruju; nema job handlera |
| `migrate` | ⚠️ **preskače se** — Prisma CLI još nije dependencija (`MIGRATIONS_STRICT=false`) |
| Baza (`vfm`) | ⚠️ **prazna** — šema (45 modela) postoji u `apps/api/prisma/schema.prisma`, ali migracije još nisu generisane |
| Redis | ✅ ACL korisnici rade; aplikacija koristi samo lock/heartbeat ključeve |
| Auth / login | ❌ Faza 1 |

**Zaključak:** ovo je **produkcijska infrastruktura + build pipeline**, ne funkcionalna
aplikacija. Cilj je da `push na main` → rebuild → zdravi kontejneri → HTTPS domene rade.
Poslovne funkcionalnosti dolaze u Fazama 1–9.

---

## 1. Priprema servera (SSH, jednokratno)

```bash
# 1.1 Mreže već postoje (globalni Postgres i Redis). Očitati TAČNE nazive kontejnera:
docker network inspect db_net    --format '{{range .Containers}}{{.Name}}  {{.IPv4Address}}{{"\n"}}{{end}}'
docker network inspect redis_net --format '{{range .Containers}}{{.Name}}  {{.IPv4Address}}{{"\n"}}{{end}}'
```

Iz outputa prepiši **imena kontejnera** — to su `DATABASE_HOST` i `REDIS_HOST`.
Ako je Coolify kreirao te resurse, imena izgledaju kao `postgres-<uuid>` / `redis-<uuid>`;
ako su ručno podignuti, imena su npr. `postgres` / `redis`.

> ⚠️ **Nikad `localhost`.** Unutar kontejnera `localhost` je sam kontejner.
> ⚠️ Kratka imena (`postgres`, `redis`) na **dijeljenoj** mreži mogu rezolvirati na tuđi
> kontejner → uvijek provjeri gornjim komandama.

```bash
# 1.2 Podaci aplikacije — JEDAN folder na hostu (konvencija: shared-app-files)
#     Montira se na /data/vfm; unutra attachments/, attachments/exports/ i tmp/.
#     Kontejner radi kao uid/gid 1001 (korisnik `vfm`) — vlasništvo je obavezno.
sudo mkdir -p /mnt/shared-app-files/vozni-park/attachments/exports \
              /mnt/shared-app-files/vozni-park/tmp
sudo chown -R 1001:1001 /mnt/shared-app-files/vozni-park
sudo chmod 750 /mnt/shared-app-files/vozni-park

# 1.3 Direktorij za tajne (Firebase service account — tek u Fazi 5)
sudo mkdir -p /etc/vfm/secrets
sudo chmod 750 /etc/vfm/secrets
```

> Bez koraka 1.2 Docker napravi direktorij kao `root:root`, a kontejner (uid 1001) u njega
> **ne može pisati** → upload priloga i export izvještaja padaju s `EACCES`.

---

## 2. PostgreSQL — gdje ide konekcija

### 2.1 Provjera da baza i korisnik postoje

```bash
# Zamijeni <pg-kontejner> stvarnim imenom iz koraka 1.1
docker exec -it <pg-kontejner> psql -U vfm -d vfm -c \
  'select current_database(), current_user, version();'
```

Ako ovo prođe, konekcija je ispravna i **ništa se u Coolify-u ne kreira** za bazu
(ne pravi se novi PostgreSQL resurs).

### 2.2 Ekstenzije (jednom, kao DB administrator)

```bash
docker exec -it <pg-kontejner> psql -U <db_admin> -d vfm -c \
  'CREATE EXTENSION IF NOT EXISTS pgcrypto;' \
  -c 'CREATE EXTENSION IF NOT EXISTS btree_gist;' \
  -c 'CREATE EXTENSION IF NOT EXISTS citext;'
```

Ako `vfm` nema pravo `CREATE EXTENSION`, ovo mora uraditi DBA. Provjera:

```bash
docker exec -it <pg-kontejner> psql -U vfm -d vfm -c '\dx'
```

### 2.3 Sastavljanje `DATABASE_URL`

Format:

```
postgresql://vfm:<LOZINKA>@<DATABASE_HOST>:5432/vfm?schema=public&connection_limit=10&pool_timeout=20
```

- `<DATABASE_HOST>` = ime kontejnera iz koraka 1.1 (npr. `postgres-3f9c…`)
- lozinka **mora biti URL-encoded** ako sadrži `@ : / # ? % +` i sl.:

```bash
node -e "console.log(encodeURIComponent(process.argv[1]))" 'Moja#Lozinka@2026'
# → Moja%23Lozinka%402026
```

- `connection_limit=10` — baza je **dijeljena** s drugim aplikacijama, ne dizati bez provjere
  `SHOW max_connections;`
- `DATABASE_SSL=false` — saobraćaj ide unutar Docker mreže

### 2.4 Gdje se upisuje

**Coolify → aplikacija → Environment Variables → `DATABASE_URL`.**

Compose koristi `${DATABASE_URL:?…}`, pa Coolify tu varijablu **sam kreira** pri učitavanju
compose fajla i **blokira Deploy** dok je prazna. `DATABASE_HOST`, `DATABASE_PORT`,
`DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` su samo dokumentacija (aplikacija ih
ne čita) — možeš ih ostaviti prazne ili ih popuniti radi evidencije.

> Veza s mrežom: `api`, `worker` i `migrate` su u compose-u priključeni na `db_net`
> (`external: true`), pa ime kontejnera iz koraka 1.1 **direktno** radi kao hostname.
> U Coolify-u **nije potrebno** uključivati „Connect to predefined network“ — mreža je
> već deklarisana u compose fajlu.

---

## 3. Redis — `redis-cli` komande

Redis je **dijeljen** s drugim aplikacijama → primjenjuje se **varijanta B** iz
[`REDIS_ACL.md`](../REDIS_ACL.md) §1: **`default` usera se NE dira.**

### 3.1 Generisanje lozinki i njihovih SHA-256 hash-eva

```bash
# Na svom računaru (ne na serveru), u rootu repozitorija:
node scripts/gen-secrets.mjs --redis
```

Ispis sadrži **plaintext** lozinke (idu u Coolify ENV) i **hash-eve** (idu u Redis ACL).
Alternativa ručno, po korisniku:

```bash
P="$(openssl rand -base64 36 | tr -d '\n')"
printf '%s' "$P" | sha256sum | cut -d' ' -f1   # hash → ACL
echo "$P"                                      # lozinka → Coolify
```

### 3.2 Ulazak u Redis kao administrator

```bash
docker exec -it <redis-kontejner> redis-cli -a '<ADMIN_LOZINKA>'
# ako se koristi ACL admin user:
#   docker exec -it <redis-kontejner> redis-cli --user <admin> --pass '<ADMIN_LOZINKA>'
```

### 3.3 Backup trenutnog ACL-a (OBAVEZNO prije izmjena)

U `redis-cli`:

```
ACL LIST
```

Kopiraj cijeli ispis u fajl na hostu, npr. `/data/coolify/redis-acl/backup-2026-10-19.acl`.

### 3.4 Kreiranje tri VFM korisnika

U `redis-cli` (zamijeni `<HASH_…>` hash-evima iz 3.1):

```
ACL SETUSER vfm-api on #<HASH_API> ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover

ACL SETUSER vfm-worker on #<HASH_WORKER> ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover

ACL SETUSER vfm-readonly on #<HASH_RO> ~vfm:* &* +@read +ping +info +client|getname +client|setname +client|id +client|list +scan +type +ttl +pttl +exists +dbsize +memory|usage +memory|stats +slowlog|get +latency|latest -keys -debug -config -acl
```

Značenje:
- `~vfm:*` — pristup **samo** ključevima s prefiksom `vfm:` (tuđi ključevi su nedostupni)
- `&*` — pub/sub kanali (BullMQ ih koristi)
- `+@all` uz oduzete destruktivne komande (`flushall`, `config`, `keys`, `shutdown`…)
- `vfm-readonly` je samo za dijagnostiku (`redis-cli` inspekcija), aplikacija ga ne koristi

### 3.5 Perzistencija ACL-a

```
ACL SAVE
```

- ✅ Ako je na Redisu konfigurisan `aclfile` → korisnici su trajni.
- ❌ Ako **nije** (`ACL SAVE` vrati `ERR ... not configured to use an ACL file`), korisnici
  žive **samo do restarta** Redis-a. Tada administrator Redisa mora dodati
  `aclfile /etc/redis/users.acl` u `redis.conf` (i montirati fajl) — vidi `REDIS_ACL.md` §2.
  **Ne dodavati `requirepass`** uz `aclfile` (ignoriše se).

### 3.6 Provjera da ACL radi

U `redis-cli`:

```
AUTH vfm-api <LOZINKA_API>
SET vfm:test 1          → OK
GET vfm:test            → "1"
SET tudji:test 1        → NOPERM ... (očekivano!)
DEL vfm:test            → 1
```

I provjera zajedničkih postavki (traži admina, naši useri nemaju `CONFIG`):

```
CONFIG GET maxmemory-policy     → noeviction   (inače BullMQ gubi jobove)
CONFIG GET appendonly          → yes
```

> ⚠️ `maxmemory-policy` je **zajednička** postavka cijele instance. Ako je `allkeys-lru`
> ili slično, queue-ovi mogu izgubiti jobove → dogovoriti `noeviction` s administratorom.

### 3.7 Gdje se upisuje u Coolify

| Varijabla | Vrijednost |
|---|---|
| `REDIS_HOST` | ime kontejnera iz koraka 1.1 (npr. `redis-3f9c…`) |
| `REDIS_PORT` | `6379` (port **unutar** Docker mreže, ne host-mapping) |
| `REDIS_TLS` | `false` |
| `REDIS_DB` | `0` |
| `REDIS_USER_API` / `REDIS_PASSWORD_API` | `vfm-api` / plaintext lozinka |
| `REDIS_USER_WORKER` / `REDIS_PASSWORD_WORKER` | `vfm-worker` / plaintext lozinka |
| `REDIS_USER_READONLY` / `REDIS_PASSWORD_READONLY` | `vfm-readonly` / plaintext lozinka |
| `VFM_REDIS_KEY_PREFIX` | `vfm:` (mora odgovarati ACL obrascu `~vfm:*`); iz njega se izvodi BullMQ `prefix` → `vfm:queue`, tj. ključevi `vfm:queue:<red>:*` |

> 🔴 **Ako se promijeni bilo koji Redis ključ, prefix, queue ili korisnik u kodu —
> `REDIS_ACL.md` i ACL na serveru se moraju ažurirati u istom trenutku**, inače servis
> pada s `NOPERM`.

---

## 4. Coolify — kreiranje resursa

1. **+ New → Application → Git repository** → `mudzy992/Vehicle-Fleet-Management-App`.
2. **General → Build pipeline:**
   - **Build strategy:** `Docker Compose`
   - **Base Directory:** `/`
   - **Docker Compose Location:** `docker-compose.yml`  ← **ovaj fajl se koristi**
   - **Branch:** `main` (auto-deploy)
   - **Auto deploy:** ✅ uključeno
3. **Advanced → Docker Compose:**
   - **Compose deployment:** ostaviti **default** (NE „Raw (deploy file as-is)“ — tada
     Coolify ne dodaje proxy labele i domene ne rade)
   - **Connect to predefined network:** ❌ **ne treba** — `db_net` i `redis_net` su
     `external: true` u compose-u, pa se kontejneri kače direktno na postojeće mreže.
4. **Domains → Add domain:**

   | Service | Domain | Interni port |
   |---|---|---|
   | `web` | `https://vehicle.ba101.top` | `80` |
   | `api` | `https://api.vehicle.ba101.top` | `3000` |
   | `migrate` | — (bez domene) | — |
   | `worker` | — (bez domene) | — |

   DNS: `A` zapisi `vehicle.ba101.top` i `api.vehicle.ba101.top` → IP servera.
   Coolify izdaje Let's Encrypt certifikat pri prvom deployu (port 80/443 moraju biti otvoreni).
5. **Environment Variables** → vidi §5.
6. **Deploy** → prati **Deployment Logs**, pa **Runtime Logs** po servisu.

> `web` je namjerno **samo** na Coolify mreži (bez `db_net`/`redis_net`) — kontejner koji je
> istovremeno na dvije mreže može dobiti 404/504 jer Traefik nedeterministički bira IP.
> `web` do API-ja dolazi kroz `WEB_API_INTERNAL_URL=http://api:3000` (isto compose → DNS radi).

---

## 5. Environment varijable za Coolify

Coolify **sam izvuče** sve `${VAR}` iz compose fajla i prikaže ih u Environment Variables.
Popuniti sljedeće (ostale ostaviti na defaultima iz compose-a):

### 5.1 Obavezne — bez njih Deploy ne kreće (`:?`)

| Varijabla | Primjer / uputa |
|---|---|
| `DATABASE_URL` | `postgresql://vfm:…@postgres-<uuid>:5432/vfm?schema=public&connection_limit=10&pool_timeout=20` |
| `VFM_STORAGE_PATH` | `/mnt/shared-app-files/vozni-park` (host putanja iz koraka 1.2) |
| `REDIS_HOST` | `redis-<uuid>` |
| `REDIS_PASSWORD_API` | plaintext lozinka `vfm-api` |
| `REDIS_PASSWORD_WORKER` | plaintext lozinka `vfm-worker` |
| `JWT_ACCESS_SECRET` | ≥ 32 znaka (`gen-secrets.mjs`) |
| `JWT_REFRESH_SECRET` | ≥ 32 znaka, **različit** od access tajne |
| `FILE_SIGNING_SECRET` | ≥ 32 znaka (potpisani URL-ovi priloga) |
| `CORS_ORIGINS` | `https://vehicle.ba101.top` |

### 5.2 Preporučene (promijeniti iz defaulta)

| Varijabla | Vrijednost | Zašto |
|---|---|---|
| `APP_ENV` | `production` | uključuje produkcione provjere (cookie, swagger, tajne) |
| `NODE_ENV` | `production` | isto |
| `APP_TIMEZONE` | `Europe/Sarajevo` | prikaz datuma; pohrana je UTC |
| `APP_LOCALE` | `bs` | formatiranje |
| `PUBLIC_API_URL` | `https://api.vehicle.ba101.top` | linkovi u notifikacijama/izvještajima |
| `TRUST_PROXY` | `all` | iza Traefika **i** nginx-a; bez toga `req.ip` je IP proxy-ja (rate-limit/audit) |
| `COOKIE_SECURE` | `true` | HTTPS only |
| `COOKIE_DOMAIN` | *(prazno)* | same-origin → host-only cookie (najsigurnije) |
| `COOKIE_PATH` | `/api/v1/auth` | default je ispravan |
| `SWAGGER_ENABLED` | `false` | produkcija ne izlaže API šemu |
| `FIREBASE_ENABLED` | `false` | push dolazi u Fazi 5 |
| `FIREBASE_SERVICE_ACCOUNT_HOST_DIR` | `/etc/vfm/secrets` | direktorij iz 1.3 (montira se cijeli direktorij) |
| `MIGRATIONS_STRICT` | `false` *(Faza 0)* → `true` *(Faza 1)* | vidi §7 |
| `VITE_PUBLIC_API_URL` | *(prazno)* | browser koristi relativni `/api/v1` kroz nginx (bez CORS-a) |
| `VITE_APP_TITLE` | `Vozni park` | naslov u browseru |
| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `json` | Coolify čita JSON logove |
| `REDIS_USER_API` / `REDIS_USER_WORKER` / `REDIS_USER_READONLY` | `vfm-api` / `vfm-worker` / `vfm-readonly` | ACL |
| `DB_NETWORK` / `REDIS_NETWORK` | `db_net` / `redis_net` | imena eksternih mreža |
| `DATABASE_CONNECTION_LIMIT` | `10` | dijeljena baza |
| `THROTTLE_*` | default | rate-limiting (aktivira se u Fazi 1) |
| `BOOTSTRAP_SUPER_ADMIN_ENABLED` | `false` | prvi admin se pravi u Fazi 1 |

Puni spisak sa komentarima: [`.env.example`](../.env.example).
Provjera konzistentnosti (lokalno, prije pusha):

```bash
node scripts/env-sync-check.mjs
```

### 5.3 Tajne — kako ih dobiti

```bash
node scripts/gen-secrets.mjs            # JWT + FILE_SIGNING + DATABASE_PASSWORD
node scripts/gen-secrets.mjs --redis    # + Redis lozinke i SHA-256 hash-evi za ACL
```

> Tajne se **ne commit-uju**. Nakon kopiranja u Coolify obriši terminal history,
> a po potrebi rotiraj (`JWT_*` rotacija = svi korisnici se odjavljuju).

---

## 6. Automatski rebuild na push na `main`

Coolify to radi na dva načina — dovoljan je **jedan**:

**A) GitHub App (preporučeno)**
Coolify → **Sources** → GitHub App → instaliraj na repozitorij. Nakon toga se svaki push
na granu iz **General → Branch** automatski deploya (webhook se postavlja sam).

**B) Ručni webhook**
Coolify → aplikacija → **Webhooks** → kopiraj URL i secret →
GitHub → repo → **Settings → Webhooks → Add webhook**:
- Payload URL: URL iz Coolify
- Content type: `application/json`
- Secret: secret iz Coolify
- Events: **Just the push event**

Provjera: `git push origin main` → Coolify → **Deployments** → novi deployment u toku.

> Build traje ~3–6 min (pnpm install + tsc + vite build u tri servisa).
> `api`, `worker` i `migrate` dijele **isti image** (`apps/api/Dockerfile`) — BuildKit
> kešira slojeve, pa je drugi i treći build znatno brži.

---

## 7. Redoslijed izvršavanja pri deployu

```
migrate  (exit 0)  →  api  (health: /health/live)  →  web  (depends_on: api healthy)
                    →  worker
```

- `migrate` je **one-shot** (`restart: "no"`); normalno je da u Coolify-u stoji kao
  „Exited (0)“. Ako Coolify prikaže aplikaciju kao nezdravu zbog toga, u `migrate` servis
  dodaj `exclude_from_hc: true` — **ali samo na Coolify-u** (ta opcija ruši standardnu
  Compose šemu, pa nije u glavnom fajlu).
- Faza 0: `migrate` ispiše `WARN … Prisma CLI nije instaliran … preskačem` i izlazi s **0**.
- Faza 1: `MIGRATIONS_STRICT=true` → nedostatak Prisma CLI-ja **prekida** deploy.

---

## 8. Verifikacija nakon deploya

```bash
# API direktno na svojoj domeni
curl -s https://api.vehicle.ba101.top/health/live
# {"status":"ok","uptimeSeconds":…,"at":"…"}

curl -s https://api.vehicle.ba101.top/health/startup
# {"status":"ok",…,"env":{"node":"v22…","app":"Vozni park","profile":"api"}}

curl -s -o /dev/null -w '%{http_code}\n' https://api.vehicle.ba101.top/health/ready
# 200 = baza + Redis + storage OK
# 503 = nešto nije dostupno → tijelo odgovora kaže TAČNO šta

# Web i proxy kroz nginx (isti origin)
curl -s -o /dev/null -w '%{http_code}\n' https://vehicle.ba101.top/       # 200
curl -s https://vehicle.ba101.top/healthz                                # ok
curl -s https://vehicle.ba101.top/api/v1/nema
# {"error":{"code":"NOT_FOUND","message":"Cannot GET /api/v1/nema","requestId":"…"}}
```

U browseru: `https://vehicle.ba101.top` → shell sa sidebarom;
`/zdravlje` → live widget koji pokazuje stanje baze i Redis-a.

**Tumačenje `/health/ready`:**

| Polje | Značenje |
|---|---|
| `database: degraded` + `ECONNREFUSED` | pogrešan `DATABASE_HOST` ili kontejner nije na `db_net` |
| `database: degraded` + `ENOTFOUND` | ime kontejnera ne postoji na mreži |
| `redis: down` + `WRONGPASS`/`NOPERM` | pogrešna lozinka ili ACL nije primijenjen |
| `storage: unknown` | `VFM_STORAGE_PATH` nije montiran ili folder ne postoji |

---

## 9. Troubleshooting

| Simptom | Uzrok / rješenje |
|---|---|
| Domena: **404 „No Available Server“** | nedostaje interni port u domeni (`:3000` za `api`) ili servis nije zdrav |
| **502** na `web` | `api` nije podignut → Runtime Logs servisa `api` |
| Build padne na `pnpm install --frozen-lockfile` | `pnpm-lock.yaml` nije commitovan / izmijenjen `package.json` bez `pnpm install` |
| Build padne na `prisma generate` | Faza 0: korak je preskočen; ako se ipak izvršava, `prisma` je dodat ali šema nije validna |
| `migrate` izlazi s 2 ili 1 | Faza 0: vrati `MIGRATIONS_STRICT=false`; inače provjeri `DATABASE_URL` |
| `not a directory` pri startu `api`/`worker` | Firebase mount: montira se **direktorij** `/etc/vfm/secrets`, ne fajl |
| `EACCES` pri uploadu/exportu | `sudo chown -R 1001:1001 /data/vfm` |
| Redis `NOPERM … key` | ključ nema prefix `vfm:` ili ACL nije primijenjen (`ACL LIST`). Ako je ACL **ispravan** a worker i dalje javlja `NOPERM`, uzrok je BullMQ `prefix` (default `'bull'` → ključevi `bull:vfm-queue-*` izvan `~vfm:*`); mora biti `vfm:queue` — vidi `REDIS_ACL.md` §4 i changelog 1.0.3 |
| Redis `WRONGPASS` | plaintext lozinka u ENV ≠ hash u ACL-u (regeneriši par) |
| `web` prikazuje 404 na refreshu rute | nginx SPA fallback — provjeri da je `nginx.conf.template` u image-u |
| Promjena `VITE_*` nema efekta | Vite ih ugrađuje **pri buildu** → potreban rebuild, ne restart |

---

## 10. Rollback

1. **Coolify → Deployments → prethodni deployment → Rollback** (vraća prethodni image).
2. Ili `git revert <commit> && git push` → auto-deploy.
3. Baza: u Fazi 0 nema migracija pa nema ni rizika; od Faze 1 obavezno
   **expand/contract** strategija (`docs/08` §8.2).

---

## 11. Šta uraditi pri prelasku na Fazu 1

1. `pnpm --filter @vfm/api add prisma@7.10.1 @prisma/client@7.10.1` (na mašini s pristupom
   `binaries.prisma.sh`), pa `pnpm prisma:generate`.
2. `pnpm --filter @vfm/api exec prisma migrate dev --name init` → commit `prisma/migrations/`.
3. U Coolify: `MIGRATIONS_STRICT=true`.
4. Provjeri da su ekstenzije (§2.2) kreirane **prije** prve migracije.
5. Deploy → `migrate` sada stvarno primjenjuje šemu; `SELECT count(*) FROM "Vehicle";` = 10
   (seed) ako je `RUN_DB_SEED=true`.
