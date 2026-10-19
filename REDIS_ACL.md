# REDIS ACL — Vozni park (VFM)

> **JEDINI IZVOR ISTINE za Redis pristup.** Redis ACL useri se ne mogu postaviti
> kroz `.env` — oni se definišu u **posebnom ACL fajlu** koji se montira na Redis
> kontejner i referencira direktivom `aclfile` u Redis konfiguraciji.
> Ovaj dokument je kopija sadržaja tog fajla + upute za primjenu na Coolify.

| | |
|---|---|
| **Redis mreža** | `redis_net` (eksterni Docker network — **globalni Redis već postoji na hostu**) |
| **Prefix aplikacije** | `vfm` → svi ključevi počinju s `vfm:` |
| **Redis verzija** | 7.4+ (ACL, `%R~`/`%W~`, `&` kanali) |
| **ACL fajl u repo-u** | [`infra/redis/users.acl.example`](infra/redis/users.acl.example) (dev) · produkcija: §1 |
| **Verzija ACL-a** | **1.0.2** (19.10.2026.) |
| **Zadnja provjera** | 19.10.2026. — usklađeno s `.env.example` 1.0.2 i `docker-compose.yml` |

> 🔴 **GLOBALNI / DIJELJENI REDIS.** Vlasnik je potvrdio (R-02) da na istom Docker hostu
> već radi **globalni Redis** priključen na `redis_net`, i da ga koriste i druge aplikacije.
> Posljedice:
> 1. **NE dirati `default` usera** ako se druge aplikacije oslanjaju na njega (`requirepass`).
>    Koristi **varijantu B** iz §1. `user default off` (varijanta A) smije se primijeniti
>    **samo** ako je VFM jedini korisnik te Redis instance.
> 2. Naše ACL korisnike **izolujemo** ključevima (`~vfm:*`) i kanalima, tako da druge
>    aplikacije ne mogu čitati/pisati naše queue-ove, a mi ne možemo dirati njihove.
> 3. `maxmemory-policy` je **zajednička** postavka: ako je na globalnom Redisu postavljena
>    evikcija (`allkeys-lru` i sl.), BullMQ će gubiti jobove. Tražiti od administratora
>    Redisa da postavi `noeviction` + `appendonly yes` (§2) ili nam odobri zaseban DB/instancu.
> 4. ACL izmjene utiču na **cijelu instancu** → prije `ACL LOAD`/`ACL SAVE` obavezno
>    `ACL LIST` sačuvati kao backup (`/data/coolify/redis-acl/backup-<datum>.acl`).

---

## ⚠️ UPOZORENJE O IZMJENAMA

**Svaka promjena Redis ključeva, prefiksa, queue-ova ili korisnika u kodu zahtijeva
izmjenu ovog fajla I stvarnog ACL fajla na serveru.** Bez toga servis dobija
`NOPERM ... has no permissions to access the key` i pada.

Agent je dužan na kraju svake faze reći:

> ⚠️ **REDIS_ACL.md je izmijenjen** — promjene (navesti tačno koje linije) moraju se
> prenijeti u ACL fajl na Coolify Redis resursu i aktivirati sa `ACL LOAD`.

### Changelog ACL-a

| Verzija | Datum | Izmjena | Treba akciju na serveru? |
|---|---|---|---|
| 1.0.0 | 19.10.2026. | Inicijalni ACL: `default off`, `vfm-api`, `vfm-worker`, `vfm-readonly`. Ključevi `~vfm:*`, kanali `&*`. | **DA** — kreirati ACL fajl + `aclfile` direktivu + restart Redis |
| 1.0.2 | 19.10.2026. | Ispravljena tabela §3: `migrate` **koristi** Redis (`vfm:lock:migrate` s `vfm-worker` kredencijalima), ranije je pisalo da ne koristi. `scripts/gen-secrets.mjs --redis` usklađen s ovim fajlom (`vfm-readonly` sada ima `&*` i `client\|*`/`memory\|*` dozvole). Sadržaj ACL-a se **ne mijenja**. | **NE** — nema izmjene ACL fajla |
| 1.0.1 | 19.10.2026. | **Globalni/dijeljeni Redis (R-02):** dodana **varijanta A/B** u §1 (A = `default off` samo ako smo jedini korisnik; **B = default se ne dira**, preporučeno za dijeljeni Redis), backup ACL-a prije izmjena, napomena o zajedničkom `maxmemory-policy noeviction`. Sadržaj `vfm-*` usera **nije** mijenjan. | **DA** — primijeniti varijantu B + `ACL LOAD`/`ACL SAVE` |

---

## 1. Sadržaj ACL fajla (kopirati 1:1)

**Tri `vfm-*` usera su identična u obje varijante** — razlika je samo u tome šta se radi s
`default` userom.

#### VFM useri (obavezno, obje varijante)

```
user vfm-api on #<SHA256_LOZINKE_API> ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover
user vfm-worker on #<SHA256_LOZINKE_WORKER> ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover
user vfm-readonly on #<SHA256_LOZINKE_READONLY> ~vfm:* &* +@read +ping +info +client|getname +client|setname +client|id +client|list +scan +type +ttl +pttl +exists +dbsize +memory|usage +memory|stats +slowlog|get +latency|latest -keys -debug -config -acl
```

#### Varijanta A — VFM je **jedini** korisnik ove Redis instance

```
user default off
```

#### Varijanta B — Redis je **globalni/dijeljeni** (⬅ preporučeno za naše stanje, R-02)

`default` user **ostaje onakav kakav jeste** (druge aplikacije ga koriste preko `requirepass`).
U ACL fajlu ga **ne navodimo** ako već postoji u `redis.conf` — ali pazi: `aclfile` i `user`
direktive u `redis.conf` su **međusobno nekompatibilne**, pa sve `user ...` linije moraju biti
na jednom mjestu. Ako administrator Redisa vodi korisnike kroz `aclfile`, dodati:

```
user default on > postojeća requirepass lozinka ~* &* +@all
```

(ili ostaviti postojeću `default` definiciju netaknutu) i **ispod nje** dodati tri `vfm-*` usera.
Naša izolacija tada počiva na `~vfm:*` + zasebnim lozinkama, ne na gašenju `default`-a.

**Pravila**
- `default`: varijanta A (`off`) **samo** ako smo jedini korisnik instance; varijanta B (ne diramo ga)
  za dijeljeni globalni Redis. `requirepass` se **ignoriše** kada je `aclfile` aktivan — zato u
  varijanti B lozinka `default` usera mora biti definisana u ACL fajlu (`>` ili `#hash`).
- Lozinke **nikad** u plaintextu u repozitoriju: koristi `#<sha256-hex>` (preporučeno) ili `>lozinka` samo ako se ACL fajl ne commit-uje.
- `~vfm:*` — pristup **svim** ključevima aplikacije i ničemu drugome (npr. Coolify-jev vlastiti Redis na istoj instanci ostaje nedostupan).
- `&*` — pub/sub kanali (BullMQ koristi pub/sub za evente i `xreadgroup` koordinaciju).
- `+@all` uz eksplicitne minus komande: BullMQ i NestJS cache koriste širok skup komandi
  (`SCRIPT LOAD`, `EVALSHA`, `CLIENT SETNAME`, `SMEMBERS`, `X*`, `Z*`, `SADD`...), pa je
  restrikcija po **ključevima** sigurnija i stabilnija od restrikcije po kategorijama.
  Oduzete su samo destruktivne/admin komande.
- **Bez komentara u ACL fajlu** ako je Redis < 8.8 (`ACL LOAD` ne podržava `#` komentare
  u eksternom fajlu prije 8.8). Komentari u ovom MD-u su dokumentacija, ne sadržaj fajla.

### Generisanje hash-ova

```bash
# Linux/macOS
echo -n 'MOJA_JAKA_LOZINKA' | sha256sum | cut -d' ' -f1

# ili node
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" 'MOJA_JAKA_LOZINKA'

# ili generisati sve odjednom
node scripts/gen-secrets.mjs --redis
```

Rezultat upisati u ACL fajl iza `#`, a ** plaintext** u Coolify Environment Variables
aplikacije (`REDIS_PASSWORD_API`, `REDIS_PASSWORD_WORKER`, `REDIS_PASSWORD_READONLY`).

---

## 2. Redis konfiguracija (Coolify → Redis → General → Custom Redis configuration)

Coolify upisuje ovaj sadržaj kao `redis.conf` i pokreće Redis s njim. Dodati:

```
aclfile /etc/redis/users.acl
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
save ""
```

> ⚠️ **`maxmemory-policy noeviction` je obavezno** dok je Redis u ulozi queue-a
> (BullMQ). `allkeys-lru` bi **brisao jobove** i outbox stanje. Ako se Redis dijeli
> s nekim keš-om, keš mora koristiti TTL, a ne evikciju.
>
> ⚠️ Kada je `aclfile` postavljen, `requirepass` **ne radi**. Zato:
> - **varijanta A** (sami na instanci): `user default off` u ACL fajlu je dovoljna zaštita;
> - **varijanta B** (globalni/dijeljeni Redis): lozinka `default` usera mora biti u ACL fajlu,
>   a `maxmemory-policy noeviction` i `appendonly yes` su **zajedničke** postavke — promjena se
>   dogovara s administratorom Redisa jer utiče na sve aplikacije na toj instanci.
>
> ⚠️ `save ""` isključuje RDB snapshot-e; na dijeljenoj instanci to može biti neprihvatljivo za
> druge aplikacije. Ako administrator želi zadržati RDB, ostaviti `save` postavke kakve jesu —
> za VFM je ključno samo `appendonly yes` (queue ne smije izgubiti jobove) i `noeviction`.

### Montaža ACL fajla na Coolify Redis resursu

Redis je **Coolify resurs (Service)**, ne dio našeg compose-a. ACL fajl se montira
kroz **Custom Docker Options** (Compose YAML) tog resursa:

```yaml
# Coolify → Redis resurs → Custom Docker Options / Compose
services:
  redis:
    volumes:
      - /data/coolify/redis-acl/vfm-users.acl:/etc/redis/users.acl:ro
```

Na hostu:

```bash
sudo mkdir -p /data/coolify/redis-acl
sudo tee /data/coolify/redis-acl/vfm-users.acl > /dev/null <<'ACL'
user default off
user vfm-api on #<SHA256_LOZINKE_API> ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover
user vfm-worker on #<SHA256_LOZINKE_WORKER> ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover
user vfm-readonly on #<SHA256_LOZINKE_READONLY> ~vfm:* &* +@read +ping +info +client|getname +client|setname +client|id +client|list +scan +type +ttl +pttl +exists +dbsize +memory|usage +memory|stats +slowlog|get +latency|latest -keys -debug -config -acl
ACL
sudo chmod 640 /data/coolify/redis-acl/vfm-users.acl
```

Zatim **Redeploy/Restart** Redis resursa.

### Alternativa (ako montaža nije moguća)

Pokrenuti jednokratno `ACL SETUSER` iz Coolify terminala Redis kontejnera i odmah
`ACL SAVE` (radi samo ako je `aclfile` konfigurisan, jer `ACL SAVE` piše u njega):

```bash
docker exec -it <redis-kontejner> redis-cli --user default --pass '<ADMIN_PASS>' <<'EOF'
ACL SETUSER default off
ACL SETUSER vfm-api on #<SHA256_API> ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover
ACL SETUSER vfm-worker on #<SHA256_WORKER> ~vfm:* &* +@all -flushdb -flushall -debug -shutdown -config -acl -keys -swapdb -reset -failover
ACL SETUSER vfm-readonly on #<SHA256_RO> ~vfm:* &* +@read +ping +info +client|getname +client|setname +client|id +client|list +scan +type +ttl +pttl +exists +dbsize +memory|usage +memory|stats +slowlog|get +latency|latest -keys -debug -config -acl
ACL SAVE
EOF
```

> Napomena: ako je `default off`, za administraciju je potreban zaseban privremeni
> admin user (`vfm-admin`), koji se **ne** koristi iz aplikacije i briše se nakon rada:
> `ACL DELUSER vfm-admin && ACL SAVE`.

---

## 3. Koji servis koristi kojeg usera

| Servis / kontejner | ACL user | Env varijabla | Zašto |
|---|---|---|---|
| `api` (NestJS) | `vfm-api` | `REDIS_USER_API` / `REDIS_PASSWORD_API` | keš permisija, throttle, signed-url nonce, SSE pub/sub, lock |
| `worker` (BullMQ) | `vfm-worker` | `REDIS_USER_WORKER` / `REDIS_PASSWORD_WORKER` | queue-ovi, retry, lock, outbox |
| `migrate` / skripte | `vfm-worker` | `REDIS_USER_WORKER` / `REDIS_PASSWORD_WORKER` | Redis lock `vfm:lock:migrate` (sprječava paralelne migracije) |
| Ops / monitoring, `redis-cli` inspekcija | `vfm-readonly` | `REDIS_PASSWORD_READONLY` | dijagnostika bez prava na pisanje |
| CI / testovi (lokalni dev Redis) | `vfm-api` + `vfm-worker` | `TEST_REDIS_URL` | isti model kao produkcija |

**Princip najmanjih prava:** aplikacija nikad ne koristi `default` usera i nikad nema
`+config`, `+acl`, `+debug`, `+keys`, `+flushall`, `+shutdown`.

---

## 4. Popis Redis ključeva (namespace inventar)

Svi ključevi **moraju** počinjati s `vfm:` (ACL `~vfm:*`). Ako uvedeš novi namespace —
dodaj ga u ovu tabelu **u istom commit-u**.

| Namespace | Tip | Namjena | TTL | Servis |
|---|---|---|---|---|
| `vfm:perm:{userId}` | string (JSON) | Keš izračunatih permisija korisnika | 60 s (`PERMISSIONS_CACHE_TTL_SECONDS`) | api |
| `vfm:permver:global` | string (int) | Globalna verzija permisija (revokacija) | trajno | api |
| `vfm:permver:role:{roleId}` | string (int) | Verzija permisija po roli | trajno | api |
| `vfm:tokenver:{userId}` | string (int) | `tokenVersion` za trenutno odjavljivanje | trajno | api |
| `vfm:session:{jti}` | hash | Aktivna refresh sesija (revokacija, device info) | = refresh TTL | api |
| `vfm:rl:{scope}:{key}` | string (INCR) | Throttler brojači | po TTL-u limitera | api |
| `vfm:lock:task:{taskId}` | string (SET NX PX) | Dodatni lock oko claim/complete | 5 s | api, worker |
| `vfm:lock:fcm:{userId}` | string (SET NX PX) | Serijalizacija push slanja po korisniku | 10 s | worker |
| `vfm:lock:migrate` | string (SET NX PX) | Sprječava paralelne migracije | 300 s | migrate |
| `vfm:lock:reminder-scan` | string (SET NX PX) | Jedan skener podsjetnika istovremeno | 600 s | worker |
| `vfm:idem:{key}` | string (JSON) | Idempotency-Key rezultat | 24 h | api |
| `vfm:cache:unread:{userId}` | string (int) | Broj nepročitanih obavijesti (badge) | 300 s | api |
| `vfm:cache:activeform:{subject}` | string (JSON) | Aktivna objavljena verzija forme | 300 s | api |
| `vfm:cache:vehicle:{id}` | string (JSON) | Keš profila vozila | 120 s | api |
| `vfm:cache:stats:dashboard` | string (JSON) | Dashboard KPI keš | 60 s | api |
| `vfm:cache:settings` | hash | Globalne postavke | 300 s | api |
| `vfm:queue:<naziv>:*` | BullMQ | Jobovi (`id`, `wait`, `active`, `delayed`, `completed`, `failed`, `meta`, `events`, `marker`, `stalled-check`, `pc`) | po job configu | worker |
| `{vfm:queue:<naziv>}:*` | BullMQ pub/sub | Kanali s hash-tagom (`x`, `pc`, ...) | — | worker |
| `vfm:stream:audit` | stream | Opciono: mirror audit događaja za ops | maxlen 100k | api, worker |
| `vfm:metrics:*` | hash/string | Interni brojači (queue depth, push success) | 3600 s | worker |
| `vfm:sse:{userId}` | pub/sub kanal | Server-Sent Events fan-out obavijesti | — | api |

Nazivi queue-ova (iz `.env.example`): `vfm-queue-outbox`, `vfm-queue-notifications`,
`vfm-queue-reminders`, `vfm-queue-reports`, `vfm-queue-maintenance` → Redis ključevi
`vfm:queue:vfm-queue-outbox:*` itd.

### 4.1 ENV varijable koje utiču na Redis (sinhronizovano s `.env.example` 1.0.0)

| ENV varijabla | Vrijednost | Uticaj na ACL |
|---|---|---|
| `REDIS_HOST` | `redis-<uuid>` (Coolify) | — (mreža `redis_net`) |
| `REDIS_PORT` | `6379` | — |
| `REDIS_TLS` | `false` | ako `true`, klijent koristi `rediss://` |
| `REDIS_DB` | `0` | ACL ne ograničava DB indeks → držati **0** (ključevi su već odvojeni prefixom) |
| `REDIS_NETWORK` | `redis_net` | naziv eksterne Docker mreže |
| `REDIS_NET_EXTERNAL` | `true` | da li je mreža eksterna (Coolify) |
| `REDIS_USER_API` / `REDIS_PASSWORD_API` | `vfm-api` / tajna | user iz §1, linija 2 |
| `REDIS_USER_WORKER` / `REDIS_PASSWORD_WORKER` | `vfm-worker` / tajna | user iz §1, linija 3 |
| `REDIS_USER_READONLY` / `REDIS_PASSWORD_READONLY` | `vfm-readonly` / tajna | user iz §1, linija 4 (samo ops) |
| `VFM_REDIS_KEY_PREFIX` | `vfm:` | **mora** odgovarati ACL patternu `~vfm:*` |
| `QUEUE_OUTBOX` | `vfm-queue-outbox` | ključevi `vfm:queue:vfm-queue-outbox:*` |
| `QUEUE_NOTIFICATIONS` | `vfm-queue-notifications` | isto pravilo |
| `QUEUE_REMINDERS` | `vfm-queue-reminders` | isto pravilo |
| `QUEUE_REPORTS` | `vfm-queue-reports` | isto pravilo |
| `QUEUE_MAINTENANCE` | `vfm-queue-maintenance` | isto pravilo |
| `QUEUE_MAX_ATTEMPTS`, `QUEUE_BACKOFF_TYPE`, `QUEUE_BACKOFF_DELAY_MS` | retry politika | bez uticaja na ACL |
| `QUEUE_REMOVE_ON_COMPLETE_MS`, `QUEUE_REMOVE_ON_FAIL_MS` | retencija jobova | bez uticaja na ACL |
| `PERMISSIONS_CACHE_TTL_SECONDS` | `60` | TTL ključa `vfm:perm:*` |
| `THROTTLE_*` | rate limit | ključevi `vfm:rl:*` (treba `+incr +expire +pexpire +ttl`) |
| `DEV_REDIS_PASSWORD_API` / `_WORKER` / `_READONLY` | dev | samo `docker-compose.dev.yml`, plaintext u `infra/redis/users.acl.example` |
| `TEST_REDIS_URL` | dev/CI | koristi `vfm-api` usera |

> 🔒 **Pravilo:** naziv queue-a u ENV-u **mora** počinjati s `vfm` (npr. `vfm-queue-…`),
> jer BullMQ gradi ključeve kao `<prefix><queueName>:…`. Ako neko promijeni naziv tako da
> ne počinje s `vfm:`, ACL `~vfm:*` će blokirati pristup → worker pada s `NOPERM`.

> 💡 BullMQ koristi **hash-tagove** (`{vfm:queue:...}`) da bi ključevi bili u istom
> slotu. Hash-tag je dio ključa, pa `~vfm:*` i dalje odgovara (ključ počinje s `{`?
> **NE** — počinje s `vfm:queue:` pa *sadrži* `{...}`; ACL glob `~vfm:*` matchuje
> prefix, što je dovoljno). Ako ikad uvedeš prefix koji **počinje** s `{`, ACL pattern
> mora biti proširen (npr. `~{vfm:*`).

---

## 5. Primjena izmjena (runbook)

```bash
# 0) BACKUP postojećeg ACL stanja (obavezno na dijeljenoj instanci!)
docker exec -it <redis-kontejner> redis-cli --user default --pass '<PASS>' ACL LIST \
  | sudo tee /data/coolify/redis-acl/backup-$(date +%Y%m%d).acl > /dev/null

# 1) Ažuriraj ACL fajl na hostu (vidi §2)
sudo nano /data/coolify/redis-acl/vfm-users.acl

# 2) Aktiviraj BEZ restarta (ako postoji admin user s +acl)
docker exec -it <redis-kontejner> redis-cli --user vfm-admin --pass '<PASS>' ACL LOAD

# 3) Provjeri
docker exec -it <redis-kontejner> redis-cli --user vfm-admin --pass '<PASS>' ACL LIST
docker exec -it <redis-kontejner> redis-cli --user vfm-api --pass '<PASS>' PING
docker exec -it <redis-kontejner> redis-cli --user vfm-api --pass '<PASS>' SET vfm:test 1 EX 10
docker exec -it <redis-kontejner> redis-cli --user vfm-api --pass '<PASS>' SET bez-prefiksa 1   # MORA vratiti NOPERM

# 4) Restart aplikacije (api + worker) da pokupi nove lozinke iz ENV-a
#    Coolify → VFM Application → Redeploy / Restart

# 5) Ako su lozinke mijenjane kroz ACL SETUSER → obavezno ACL SAVE da preživi restart
```

### Rotacija lozinke (bez prekida rada)

1. Generiši novi hash i **dodaj** ga postojećem useru (Redis podržava više lozinki):
   `ACL SETUSER vfm-api on ><NOVA_LOZINKA>` (ili `#<hash>`).
2. Upiši novu lozinku u Coolify ENV → Redeploy api/worker.
3. Provjeri da radi s novom lozinkom.
4. Ukloni staru: `ACL SETUSER vfm-api <stara_lozinka>` pa `ACL SAVE`.

---

## 6. Troubleshooting

| Simptom | Uzrok | Rješenje |
|---|---|---|
| `NOAUTH Authentication required` | Klijent se spaja bez usera (`default` je `off`) | Koristi `REDIS_USER_*` + lozinku; URL format `redis://vfm-api:PASS@host:6379/0` |
| `WRONGPASS invalid username-password pair` | Pogrešan hash/lozinka ili `requirepass` + `aclfile` konflikt | Provjeri `ACL LIST`; ukloni `requirepass` iz konfiguracije |
| `NOPERM ... no permissions to access a key` | Ključ nije unutar `~vfm:*` | Ispravi prefix u kodu **ili** proširi ACL pattern + ažuriraj §4 i changelog |
| `NOPERM ... no permissions to run the command` | Nedostaje komanda (npr. `+config`) | Provjeri §1; **nemoj** dodavati `+config`/`+acl` aplikacijskom useru |
| `ERR command 'CONFIG' not allowed` | Namjerno oduzeto | Koristi `vfm-admin` privremeno, pa ga obriši |
| BullMQ: `Missing lock for job ...` / stalled jobovi | Redis evikcija briše ključeve | Postavi `maxmemory-policy noeviction`, provjeri `maxmemory` |
| Jobovi nestaju nakon restarta | `appendonly no` / `save ""` bez AOF | Uključi `appendonly yes` (§2) |
| `ACL LOAD` vraća grešku o sintaksi | Komentari (`#...`) u fajlu na Redisu < 8.8 | Ukloni linije s komentarima iz ACL fajla |
| `ERR ACL SAVE failed` | `aclfile` nije konfigurisan ili fajl nije upisiv | Dodaj `aclfile /etc/redis/users.acl`; provjeri permisije (640, vlasnik redis) |
| Aplikacija se spoji na **pogrešan** Redis | Kratki hostname `redis` na dijeljenoj mreži | `docker network inspect redis_net` → tačan naziv globalnog kontejnera u `REDIS_HOST` |
| Druge aplikacije su pale nakon naših ACL izmjena | Primijenjena varijanta A (`user default off`) na dijeljenoj instanci | Vratiti `default` iz backup-a (§5, korak 0) → `ACL LOAD` → koristiti **varijantu B** |
| BullMQ jobovi nestaju / stalled | Globalni Redis ima `maxmemory-policy allkeys-*` | Tražiti od admina Redisa `noeviction` (§2) ili zaseban DB/instancu za VFM |
| `NOPERM` samo kod naših ključeva, druge aplikacije rade | Naš user nema traženu komandu/pattern | Provjeri §1; promjenu upiši u changelog i §4 |

---

## 7. Checklist pri svakoj promjeni

- [ ] Promjena je zabilježena u **Changelog ACL-a** (§0) s verzijom i datumom.
- [ ] Sadržaj ACL fajla u §1 je ažuran i kopiran na server.
- [ ] Novi/izbrisani namespace ključeva je upisan u §4.
- [ ] Hash-ovi lozinki su generisani, plaintext **nije** u repozitoriju.
- [ ] `.env.example` sadrži odgovarajuće `REDIS_*` varijable (sinhronizacija!).
- [ ] `ACL LOAD`/restart izvršen i provjeren (`ACL LIST`, `PING`, test ključa).
- [ ] api i worker redeploy-ovani i logovi čisti (bez `NOPERM`/`WRONGPASS`).
- [ ] Vlasnik je **eksplicitno upozoren** u izvještaju faze da je ACL izmijenjen.
