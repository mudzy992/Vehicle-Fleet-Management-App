# 12 — Postavljanje na server, korak po korak (za početnike)

> **Tvoj slučaj:** repo je kloniran na host gdje rade Coolify i Docker.
> Redis je `redis-core:6379`. Baza je `hgpchekxb6dutalsyctu42al:5432`, user `vehicle`, baza `vehicle`.
>
> **Cilj ovog dokumenta:** od kloniranog repoa do aplikacije koja radi na
> `https://vehicle.ba101.top` i `https://api.vehicle.ba101.top`, sa automatskim rebuildom na push.

---

## ⚠️ Prvo — šta ćeš dobiti, a šta ne (bitno da se ne razočaraš)

| | |
|---|---|
| ✅ Radi | shell aplikacije, sidebar, 16 ekrana, `/dizajn-sistem`, HTTPS, auto-deploy na push, `/health/*` na API-ju |
| ⚠️ Prazno | **baza** — šema postoji u kodu, ali migracije nisu napravljene (Prisma se ne može generisati u sandboxu gdje je kod pisan) |
| ⚠️ Nema | **login**, korisnici, vozila — to je Faza 1, tek slijedi |

Znači: **infrastruktura i pipeline** su ono što sada postavljaš. To je normalno i očekivano.

---

## 0. Tri stvari koje moraš znati prije početka

1. **Klon na hostu služi samo za čitanje i komande.** Coolify **ne** builda iz tog klonа — builda iz GitHuba. Zato svaka izmjena mora ići na GitHub (`git push`), pa Coolify povuče.
2. **Ne pravi `.env` fajl na hostu.** `.env` je samo za lokalni razvoj. U produkciji varijable upisuješ u **Coolify → Environment Variables**.
3. **Imena `hgpchekxb6dutalsyctu42al` i `redis-core` su imena Docker kontejnera.** Postoje samo unutar Docker mreža. Ne mogu se otvoriti iz tvog laptopa (npr. pgAdminom) — samo iz kontejnera koji su na istoj mreži.

---

## 1. Provjeri okruženje (2 minute)

Uđi na server SSH-om, pa pokreni:

```bash
docker --version
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Networks}}'
```

**Šta tražiš u outputu:** dva imena — `hgpchekxb6dutalsyctu42al` i `redis-core`.
Kolone `STATUS` treba da piše `Up ...`, a `NETWORKS` pamti — trebat će nam u koraku 2.

Ako se kontejner ne vidi, provjeri da nije ugašen:

```bash
docker ps -a | grep -E 'hgpchekxb6dutalsyctu42al|redis-core'
```

---

## 2. Nađi na kojoj su mreži baza i Redis

Ovo je **najvažniji korak** — ako aplikacija ne vidi bazu, 90 % uzroka je pogrešna mreža.

```bash
docker inspect hgpchekxb6dutalsyctu42al --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
docker inspect redis-core --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
```

Primjer ispravnog outputa:

```
db_net
redis_net
```

### Tri moguća slučaja

**Slučaj A — mreže se zovu `db_net` i `redis_net`**
→ ništa ne mijenjaš. Preskoči na korak 3.

**Slučaj B — mreže imaju drugačiji naziv** (npr. `coolify`, `core_net`, `voznipark_net`)
→ **ne preimenuj mreže.** Upamti tačna imena i u Coolify-u ćeš upisati:
```
DB_NETWORK=<ime mreže baze>
REDIS_NETWORK=<ime mreže Redisa>
```

**Slučaj C — output je `bridge` ili prazno**
→ kontejneri nisu ni na jednoj zajedničkoj mreži. Napravi ih i spoji:

```bash
docker network create db_net 2>/dev/null || true
docker network create redis_net 2>/dev/null || true

docker network connect db_net hgpchekxb6dutalsyctu42al
docker network connect redis_net redis-core

# provjera
docker inspect hgpchekxb6dutalsyctu42al --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
```

> ⚠️ Ako Coolify ikada **ponovo kreira** taj DB/Redis kontejner, veza na mrežu se gubi.
> Zato je bolje koristiti mrežu na kojoj kontejner **već** jeste (slučaj A ili B).

---

## 3. Testiraj konekciju PRIJE Coolify-a

Ovo ti štedi pola sata debugovanja poslije deploya. Pokrećemo privremeni kontejner na istoj mreži i iz njega testiramo bazu.

**Zamijeni `<DB_PASS>` i `<MREZA_BAZE>` stvarnim vrijednostima.**

```bash
docker run --rm --network <MREZA_BAZE> postgres:17-alpine \
  psql "postgresql://vehicle:<DB_PASS>@hgpchekxb6dutalsyctu42al:5432/vehicle" \
  -c "select current_database(), current_user, version();"
```

**Očekivano:**
```
 current_database | current_user |          version
------------------+--------------+----------------------------
 vehicle          | vehicle      | PostgreSQL 17...
```

Ako ovo prođe — baza, lozinka, DNS i mreža su ispravni. Ako ne:

| Greška | Uzrok |
|---|---|
| `could not translate host name` | pogrešna mreža ili pogrešno ime kontejnera → vrati se na korak 2 |
| `password authentication failed` | pogrešna lozinka |
| `database "vehicle" does not exist` | pogrešno ime baze |
| `Connection refused` | baza ne sluša na 5432 ili nije na toj mreži |

Isto za Redis (bez ACL-a još, samo provjera da je živ):

```bash
docker run --rm --network <MREZA_REDISA> redis:7-alpine \
  redis-cli -h redis-core -p 6379 PING
```

- `PONG` → Redis radi **bez lozinke** (rijetko, i nesigurno)
- `(error) NOAUTH Authentication required.` → Redis traži lozinku → **dobro**, nastavi na korak 5

---

## 4. Ekstenzije u bazi (jednom, 1 minuta)

VFM-u trebaju tri PostgreSQL ekstenzije. Uradi ovo **sada**, prije prve migracije (Faza 1), da se kasnije ne vraćaš.

```bash
docker exec -it hgpchekxb6dutalsyctu42al psql -U vehicle -d vehicle -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

docker exec -it hgpchekxb6dutalsyctu42al psql -U vehicle -d vehicle -c \
  "CREATE EXTENSION IF NOT EXISTS btree_gist;"

docker exec -it hgpchekxb6dutalsyctu42al psql -U vehicle -d vehicle -c \
  "CREATE EXTENSION IF NOT EXISTS citext;"
```

Provjera:
```bash
docker exec -it hgpchekxb6dutalsyctu42al psql -U vehicle -d vehicle -c '\dx'
```

**Ako piše `permission denied to create extension`** — user `vehicle` nije superuser. Onda isto pokreni kao `postgres`:

```bash
docker exec -it hgpchekxb6dutalsyctu42al psql -U postgres -d vehicle -c \
  "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE EXTENSION IF NOT EXISTS citext;"
```

---

## 5. Redis ACL — najosjetljiviji dio

Redis (`redis-core`) je **dijeljen s drugim aplikacijama**. Zato:
- **ne diramo** `default` korisnika,
- pravimo tri svoja korisnika koja vide **samo** ključeve s prefiksom `vfm:`.

### 5.1 Pronađi admin lozinku Redisa

```bash
docker exec -it redis-core redis-cli ping
```

- `PONG` → nema lozinke. Preskoči na 5.2 (u komandama izostavi `-a ...`).
- `NOAUTH` → treba lozinka. Nađi je:

```bash
docker inspect redis-core --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i -E 'pass|redis'
```

Ako je ne nađeš u outputu, pogledaj u **Coolify → Redis resurs → Environment Variables** (traži `REDIS_PASSWORD` ili slično).

Provjeri i kako je ACL trenutno konfigurisan:

```bash
docker exec -it redis-core redis-cli -a '<REDIS_ADMIN_PASS>' --no-auth-warning CONFIG GET aclfile
docker exec -it redis-core redis-cli -a '<REDIS_ADMIN_PASS>' --no-auth-warning CONFIG GET requirepass
docker exec -it redis-core redis-cli -a '<REDIS_ADMIN_PASS>' --no-auth-warning ACL LIST
```

Zapamti dva podatka:
- **`aclfile`** — ako je prazno, ACL se ne čuva na disk (vidi 5.5)
- **`ACL LIST`** — kopiraj cijeli output u tekstualni fajl, to je backup

> Ako `CONFIG` vrati `unknown command`, admin je zaključao komandu. Tada pročitaj konfiguraciju direktno:
> `docker exec redis-core sh -c 'cat /usr/local/etc/redis/redis.conf 2>/dev/null || cat /etc/redis/redis.conf'`

### 5.2 Generiši lozinke i hash-eve (na hostu)

```bash
for u in api worker readonly; do
  P="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
  H="$(printf '%s' "$P" | sha256sum | cut -d' ' -f1)"
  echo "--- vfm-$u ---"
  echo "LOZINKA=$P"
  echo "HASH=$H"
done
```

Dobiješ npr.:
```
--- vfm-api ---
LOZINKA=Kx7Qm2...
HASH=314877ee25...
```

- **LOZINKA** → ide u Coolify (Environment Variables)
- **HASH** → ide u Redis ACL

> Lozinke su namjerno bez specijalnih znakova (`+ / = @ #`), da ih ne moraš escape-ovati.

### 5.3 Upiši korisnike u Redis

Zamijeni `<HASH_API>`, `<HASH_WORKER>`, `<HASH_RO>` vrijednostima iz 5.2, pa izvrši **cijeli blok odjednom**:

```bash
docker exec -i redis-core redis-cli -a '<REDIS_ADMIN_PASS>' --no-auth-warning <<'EOF'
ACL SETUSER vfm-api on #HASH_API ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover
ACL SETUSER vfm-worker on #HASH_WORKER ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover
ACL SETUSER vfm-readonly on #HASH_RO ~vfm:* &* +@read +ping +info +client|getname +client|setname +client|id +client|list +scan +type +ttl +pttl +exists +dbsize +memory|usage +memory|stats +slowlog|get +latency|latest -keys -debug -config -acl
EOF
```

> 🔴 **`#` mora biti unutar heredoc bloka** (kao gore). Ako bi pisao komandu direktno u shellu,
> bash bi `#` protumačio kao početak komentara i hash bi nestao.

### 5.4 Provjeri da ACL radi

```bash
docker exec -it redis-core redis-cli --user vfm-api --pass '<LOZINKA_API>' --no-auth-warning SET vfm:test 1
```
→ `OK`

```bash
docker exec -it redis-core redis-cli --user vfm-api --pass '<LOZINKA_API>' --no-auth-warning SET tudji:test 1
```
→ **mora** vratiti `NOPERM ...`. Ako vrati `OK` — ACL nije primijenjen, ponovi 5.3.

```bash
docker exec -it redis-core redis-cli --user vfm-api --pass '<LOZINKA_API>' --no-auth-warning DEL vfm:test
```

### 5.5 Sačuvaj ACL (da preživi restart Redisa)

Ako je u 5.1 `aclfile` vratio **putanju** (npr. `/data/redis/users.acl`):

```bash
docker exec -it redis-core redis-cli -a '<REDIS_ADMIN_PASS>' --no-auth-warning ACL SAVE
```

Gotovo — korisnici su trajni.

Ako je `aclfile` bio **prazan**, `ACL SAVE` će vratiti grešku i korisnici **nestaju kad se Redis restartuje**. Tada aplikacija staje. Dvije opcije:

- **Opcija 1 (brzo, privremeno):** nastavi dalje. Radi do prvog restarta Redisa. Zapiši sebi da ovo moraš riješiti.
- **Opcija 2 (ispravno):** uključi `aclfile`:
  1. Sačuvaj trenutno stanje **nakon** 5.3 (sada `ACL LIST` sadrži i naše korisnike):
     ```bash
     sudo mkdir -p /data/redis-acl
     docker exec redis-core redis-cli -a '<REDIS_ADMIN_PASS>' --no-auth-warning ACL LIST \
       | sudo tee /data/redis-acl/users.acl > /dev/null
     sudo chmod 600 /data/redis-acl/users.acl
     ```
  2. **Provjeri da prva linija sadrži `user default`** — bez nje ostale aplikacije na tom Redisu gube pristup:
     ```bash
     sudo head -1 /data/redis-acl/users.acl
     ```
  3. U konfiguraciju Redisa dodaj `aclfile /data/redis-acl/users.acl` i montiraj fajl u kontejner, pa restartuj Redis. Ako je `redis-core` Coolify resurs, to radi kroz **Custom Redis configuration** i **Custom Docker Options** tog resursa (detalji: `REDIS_ACL.md` §2).
  4. Nakon restarta: `docker exec -it redis-core redis-cli -a '<ADMIN>' ACL LIST | head`

> ⚠️ Kad je `aclfile` aktivan, `requirepass` se **ignoriše**. Zato `user default` linija mora nositi postojeću lozinku — kopiraj je **tačno** iz `ACL LIST`.

---

## 6. Host direktoriji za priloge

Sve datoteke ove aplikacije idu u **jedan** folder na hostu, po konvenciji servera:

```
/mnt/shared-app-files/vozni-park/          ← montira se na /data/vfm u kontejneru
├── attachments/                            ← prilozi (trajno)
│   └── exports/                            ← izvezeni PDF/XLSX
└── tmp/                                    ← privremeni upload (isti filesystem!)
```

```bash
sudo mkdir -p /mnt/shared-app-files/vozni-park/attachments/exports \
              /mnt/shared-app-files/vozni-park/tmp

sudo chown -R 1001:1001 /mnt/shared-app-files/vozni-park
sudo chmod 750 /mnt/shared-app-files/vozni-park

sudo mkdir -p /etc/vfm/secrets
sudo chmod 750 /etc/vfm/secrets
```

**Zašto 1001:** kontejner radi kao korisnik `vfm` s uid 1001. Ako folder ostane `root:root`, upload priloga i export izvještaja padaju s `EACCES`.

Provjeri:
```bash
ls -ld /mnt/shared-app-files/vozni-park
# drwxr-x--- 2 1001 1001 ... vozni-park
```

---

## 7. Napravi aplikaciju u Coolify

1. Otvori Coolify → **Projects** → tvoj projekat → **+ New**.
2. Izaberi **Public Repository** (ili GitHub App ako je repo privatan) i zalijepi:
   `https://github.com/mudzy992/Vehicle-Fleet-Management-App`
3. **Build Pack:** `Docker Compose`
4. Popuni:

| Polje | Vrijednost |
|---|---|
| **Branch** | `main` |
| **Base Directory** | `/` |
| **Docker Compose Location** | `docker-compose.yml` |
| **Auto Deploy** | ✅ uključeno |

5. Klikni **Save** i sačekaj da Coolify parsira compose. Otvori **Docker Compose Content** da potvrdiš da vidi 4 servisa: `migrate`, `api`, `worker`, `web`.

> **Ne uključuj** „Connect to predefined network“. Naše mreže su `external: true` i već postoje na hostu.
> **Ne uključuj** „Raw (deploy file as-is)“ — tada domene ne rade.

---

## 8. Environment varijable

Coolify je iz compose fajla već napravio spisak varijabli. **Ne lijepi sve** — popuni samo ove.

### 8.1 Obavezne (bez njih Deploy ne kreće)

| Varijabla | Vrijednost |
|---|---|
| `DATABASE_URL` | `postgresql://vehicle:<DB_PASS>@hgpchekxb6dutalsyctu42al:5432/vehicle?schema=public&connection_limit=10&pool_timeout=20` |
| `VFM_STORAGE_PATH` | `/mnt/shared-app-files/vozni-park` |
| `REDIS_HOST` | `redis-core` |
| `REDIS_PASSWORD_API` | LOZINKA za `vfm-api` iz 5.2 |
| `REDIS_PASSWORD_WORKER` | LOZINKA za `vfm-worker` iz 5.2 |
| `REDIS_PASSWORD_READONLY` | LOZINKA za `vfm-readonly` iz 5.2 |
| `JWT_ACCESS_SECRET` | vidi 8.3 |
| `JWT_REFRESH_SECRET` | vidi 8.3 (mora biti **različit** od prethodnog) |
| `FILE_SIGNING_SECRET` | vidi 8.3 |
| `CORS_ORIGINS` | `https://vehicle.ba101.top` |

### 8.2 Preporučene

| Varijabla | Vrijednost | Zašto |
|---|---|---|
| `DB_NETWORK` | ime mreže iz koraka 2 (default `db_net`) | baza mora biti dostupna |
| `REDIS_NETWORK` | ime mreže iz koraka 2 (default `redis_net`) | Redis mora biti dostupan |
| `PUBLIC_API_URL` | `https://api.vehicle.ba101.top` | linkovi u budućim obavijestima |
| `TRUST_PROXY` | `all` | iza Traefika i nginx-a; bez toga se u logu vidi IP proxy-ja |
| `MIGRATIONS_STRICT` | `true` | Prisma CLI je u image-u; nedostatak prekida deploy (vidi §11) |
| `FIREBASE_ENABLED` | `false` | push dolazi u Fazi 5 |

Ostale (timezone, locale, limiti, queue) imaju ispravne defaultove u compose-u — ne diraj ih.

### 8.3 Generiši tri tajne (na hostu)

```bash
for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET FILE_SIGNING_SECRET; do
  echo "$k=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-48)"
done
```

Kopiraj u Coolify. **Ne commitaj** ih nikuda.

### 8.4 Ako lozinka baze ima specijalne znakove

`DATABASE_URL` je URL — `@ : / # ? % &` u lozinci moraju biti enkodirani. Najlakše:

```bash
docker run --rm node:22-alpine -e \
  "console.log(encodeURIComponent(process.argv[1]))" 'TVOJA_LOZINKA'
```

Dobijeni string zamijeni na mjesto `<DB_PASS>` u `DATABASE_URL`.

---

## 9. Domene

Coolify → aplikacija → **Domains** → **Add domain**, dva puta:

| Service | Domain | Port |
|---|---|---|
| `web` | `https://vehicle.ba101.top` | `80` |
| `api` | `https://api.vehicle.ba101.top` | `3000` |

> Format je `https://host:interni_port`. Port je **port unutar kontejnera**, ne na hostu.

**Prije nego klikneš Deploy** — provjeri DNS:
```bash
dig +short vehicle.ba101.top
dig +short api.vehicle.ba101.top
```
Moraju vratiti IP tvog servera. Ako ne — Let's Encrypt ne može izdati certifikat i domena neće raditi. Sačekaj propagaciju.

---

## 10. Deploy

Klikni **Deploy** i prati **Deployment Logs**.

Redoslijed je: `migrate` (izlazi) → `api` (zdrav) → `worker` i `web`.

**Očekivano u logovima:**

```
vfm-migrate  ... "PostgreSQL prihvata konekcije."
vfm-migrate  WARN "Prisma CLI nije instaliran ... MIGRATIONS_STRICT=false → preskačem migracije"
vfm-migrate  Exited (0)
vfm-api      "Nest application successfully started"
vfm-api      "VFM API spreman na http://0.0.0.0:3000/api/v1"
```

`migrate` koji stoji kao **Exited (0)** je **ispravno** — to je jednokratni servis.

Build traje ~3–6 minuta prvi put.

---

## 11. Verifikacija

```bash
curl -s https://api.vehicle.ba101.top/health/live
# {"status":"ok","uptimeSeconds":12,"at":"..."}

curl -s https://api.vehicle.ba101.top/health/startup
# {"status":"ok",...,"env":{"node":"v22...","app":"Vozni park","profile":"api"}}

curl -s -o /dev/null -w '%{http_code}\n' https://api.vehicle.ba101.top/health/ready
# 200 = sve radi | 503 = nešto ne radi (tijelo kaže šta)

curl -s https://vehicle.ba101.top/healthz
# ok

curl -s https://vehicle.ba101.top/api/v1/nema
# {"error":{"code":"NOT_FOUND",...,"requestId":"..."}}
```

U browseru otvori `https://vehicle.ba101.top` — trebaš vidjeti sidebar sa grupama
**Operativa / Vozni park / Konfiguracija / Sistem** i placeholder ekrane.

**Tumačenje `/health/ready`:**

| Poruka | Znači |
|---|---|
| `database: degraded` + `ECONNREFUSED` | `DATABASE_URL` ili `DB_NETWORK` nije tačan |
| `database: degraded` + `ENOTFOUND` | ime kontejnera baze nije vidljivo na toj mreži |
| `redis: down` + `WRONGPASS` | lozinka u ENV ≠ hash u ACL-u |
| `redis: down` + `NOPERM` | ACL korisnik nema pravo na ključ (provjeri `~vfm:*`, pa BullMQ prefiks `vfm:queue` — `REDIS_ACL.md` §4) |
| `storage: unknown` | `VFM_STORAGE_PATH` nije montiran ili folder ne postoji |

> **Poznata sitnica:** ekran `/zdravlje` na web domeni trenutno ne može da pročita `/health/*`
> jer nginx u verziji na `main` proksira samo tačno `/health`. Popravka je već napravljena lokalno
> i stiže sa Faza 1 PR-om. Do tada zdravlje provjeravaj preko `https://api.vehicle.ba101.top/health/ready`.

---

## 12. Automatski rebuild na push

Coolify → aplikacija → **Webhooks** → kopiraj URL i secret →
GitHub → repo → **Settings → Webhooks → Add webhook**:
- Payload URL: kopirani URL
- Content type: `application/json`
- Secret: kopirani secret
- Events: **Just the push event**

(Ako si koristio GitHub App pri kreiranju, webhook je već postavljen — preskoči.)

Test: napravi bilo kakvu izmjenu na `main` → Coolify → **Deployments** → novi deployment kreće sam.

---

## 13. Troubleshooting

| Simptom | Uzrok / rješenje |
|---|---|
| Deploy padne: `network db_net declared as external, but could not be found` | mreža ne postoji → korak 2, slučaj C |
| Deploy padne: `VFM_STORAGE_PATH je obavezan` | nisi popunio varijablu u §8.1 |
| `migrate` izlazi s 1 | `MIGRATIONS_STRICT=true`, a Prisma nije instalirana → postavi `false` |
| `migrate` ne prolazi, `PostgreSQL nije dostupan unutar 60 s` | pogrešan `DATABASE_URL` ili `DB_NETWORK` |
| API log: `Konfiguracija nije kompletna` | nedostaje neka od obaveznih ENV varijabli — log ispiše koja |
| Domena: **404 No Available Server** | pogrešan port u domeni (`:80` za web, `:3000` za api) ili servis nije zdrav |
| **502 Bad Gateway** na webu | `api` nije podigao → Runtime Logs servisa `api` |
| `EACCES` pri uploadu | `sudo chown -R 1001:1001 /data/vfm` |
| `not a directory` pri startu api/worker | `/etc/vfm/secrets` ne postoji kao direktorij → korak 6 |
| Redis `WRONGPASS` | lozinka u Coolify ≠ hash u ACL-u → ponovi 5.2–5.3 |
| Worker log: `Redis ACL greška za korisnika "vfm-worker": NOPERM … access a key` | ACL je učitan, ali ključevi nisu unutar `~vfm:*` — gotovo uvijek BullMQ `prefix` (default `'bull'`). Ispravno je `vfm:queue` (`REDIS_ACL.md` §4, changelog 1.0.3) → deployaj zadnju verziju koda i Redeploy `api` + `worker` |
| Nakon restarta Redisa sve pada | `aclfile` nije bio postavljen → 5.5, opcija 2 |
| Coolify: `Invalid Docker volume definition: Invalid volume source: contains forbidden character` | u volume source-u ima razmak/zagrada — najčešće poruka u `${VAR:?poruka}`. Koristi `${VAR:-/cista/putanja}` bez teksta (popravljeno u `docker-compose.yml`) |

---

## 14. Šta dalje

1. **Faza 1** (login, korisnici, role, audit) — najveći dio posla.
2. Prije Faze 1, na serveru/računaru s pristupom `binaries.prisma.sh`:
   ```bash
   pnpm --filter @vfm/api add prisma@7.10.1 @prisma/client@7.10.1
   pnpm prisma:generate
   pnpm --filter @vfm/api exec prisma migrate dev --name init
   ```
   pa commit `apps/api/prisma/migrations/`, pa u Coolify `MIGRATIONS_STRICT=true`.
3. Tek tada baza dobija tabele i seed (3 role, katalog permisija + grantovi, forma
   vozila; demo korisnici i 10 fiktivnih vozila **samo** van produkcije ili uz
   `SEED_DEMO_DATA=true`):

   ```bash
   # migracije + seed u jednom prolazu (compose servis `migrate` ili ručno):
   node dist/tools/migrate.js --seed
   # ili odvojeno, iz apps/api:
   pnpm --filter @vfm/api seed          # tsx nad izvorom
   node dist/tools/seed.js              # kompajlirano (image)
   ```

4. Kreiraj **prvog Super Admina**. Dva načina — biraj jedan.

   **A) Automatski, kroz `migrate` servis (bez ručnog koraka, preporučeno za Coolify):**
   u ENV dodaj `RUN_DB_SEED=true`, `BOOTSTRAP_SUPER_ADMIN_ENABLED=true`,
   `BOOTSTRAP_SUPER_ADMIN_EMAIL` / `_FIRST_NAME` / `_LAST_NAME` i
   `BOOTSTRAP_SUPER_ADMIN_PASSWORD` (min 12 znakova, 3 klase). Na redeploy-u
   `migrate` odradi seed pa bootstrap; u logu piše `Super Admin spreman`.
   Lozinka se **ne ispisuje** nigdje — mijenja se pri prvoj prijavi.
   ⚠️ Nakon uspjeha vrati `BOOTSTRAP_SUPER_ADMIN_ENABLED=false` i **obriši**
   `BOOTSTRAP_SUPER_ADMIN_PASSWORD`. Ako Super Admin već postoji, korak se
   preskače uz `WARN` — deploy ne pada.

   **B) Ručno** (lozinka se generiše i ispiše samo jednom):

   ```bash
   node scripts/bootstrap-super-admin.mjs --email super@firma.ba --name "Ime Prezime"
   ```

   U oba slučaja: dodatni administratori se kreiraju kroz aplikaciju (Users →
   novi korisnik + rola), uz audit — bootstrap je samo za **prvi** nalog.

---

## Kratka checklista — sve na jednom mjestu

```
[ ] 1. docker ps → vidim hgpchekxb6dutalsyctu42al i redis-core
[ ] 2. docker inspect → znam mreže (DB_NETWORK / REDIS_NETWORK)
[ ] 3. test iz kontejnera → psql radi, redis PING/NOAUTH
[ ] 4. CREATE EXTENSION pgcrypto, btree_gist, citext
[ ] 5. Redis ACL: 3 korisnika + ACL SAVE (ili aclfile)
[ ] 6. /mnt/shared-app-files/vozni-park (+tmp, exports) i /etc/vfm/secrets, chown 1001
[ ] 7. Coolify: Docker Compose, branch main, docker-compose.yml
[ ] 8. ENV: DATABASE_URL, VFM_STORAGE_PATH, REDIS_HOST, 3×REDIS_PASSWORD,
         JWT×2, FILE_SIGNING_SECRET, CORS_ORIGINS, DB_NETWORK, REDIS_NETWORK
[ ] 9. Domene: web:80, api:3000, DNS provjeren
[ ] 10. Deploy → migrate Exited(0), api healthy
[ ] 11. curl /health/live → ok, /health/ready → 200
[ ] 12. Webhook za auto-deploy
```
