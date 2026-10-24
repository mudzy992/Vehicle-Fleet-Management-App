# Faza 1 — detaljni sigurnosni audit i dopuna

**Datum:** 22.10.2026.
**Grana:** `arena/d46d9ae6-vehicle-fleet-management-app`
**Bazni commit:** `720c655` (`docs: add application audit and phased E2E plan`)
**Master plan:** [`docs/PLAN_IMPLEMENTACIJE.md`](../docs/PLAN_IMPLEMENTACIJE.md)
**Izvještaj Faze 1:** [`docs/FAZA1_IZVJESTAJ.md`](../docs/FAZA1_IZVJESTAJ.md)

> Ovo je audit postojeće implementacije i ciljano popravljanje potvrđenih rizika — ne prepisivanje auth/RBAC modula. Zaključci su odvojeni na unit dokaz, SQL verifier i neizvršene live HTTP/DB/Redis/E2E provjere.

## 1. Sažetak

- Ponovo pregledani su auth controller/service/token flow, login lockout, refresh/reset, guards, permisije i scope evaluacija, roles/users kontroleri i servisi, PII projekcija, audit read/write/redakcija, rate limiter te web prijava/profil/sesije.
- Evidentirano je **10 nalaza** i implementirane su pripadajuće popravke/mitigacije kroz API, DB migraciju i web session UI. Regresijski unit testovi pokrivaju promijenjena ponašanja.
- Regresijski unit testovi prošli su za promjene; puna lokalna kapija završila je `25/25` Turbo taskova, exit `0`. API je prošao `916/916` testova.
- **Nije** pokrenut PostgreSQL verifier, Redis integration test, stvarni HTTP prolaz ni E2E runner. Migracije `3` i `4` nisu primijenjene na živu bazu; njihovo ponašanje ostaje uslovno dok se ne izvrši verifier.
- Pet ranijih necommitovanih mobile izmjena sačuvano je i nije uključeno u Fazu 1.

## 2. Potvrđeni nalazi i popravke

| ID | Prioritet | Nalaz | Popravka / regresijski dokaz | Status |
|---|---|---|---|---|
| F1-01 | P1 | User/role/audit endpointi su provjeravali samo prisustvo permissiona; `OWN`, `VEHICLE_IDS` ili `DRIVER_IDS` grant mogao je otključati globalni collection/admin endpoint bez provjere reda. | User, role, permission i audit globalni endpointi sada traže `ALL` kroz `@RequireScope`; metadata testovi provjeravaju zahtijevani scope. `user:view_pii:OWN` primjenjuje se samo na vlastiti red, `ALL` na sve korisnike. | Popravljeno |
| F1-02 | P1 | Union `allowedClientTypes` iz više rola mogao je sadržavati mobilni tip i preskočiti Super Admin web-only provjeru na loginu/refreshu. | Super Admin + mobile provjerava se prije union liste; regresijski test širi union namjerno i potvrđuje `403 MOBILE_ACCESS_FORBIDDEN`, bez kreiranja sesije. | Popravljeno |
| F1-03 | P1 | Dva refresh zahtjeva mogla su pročitati istu aktivnu sesiju, oba kreirati nasljednika, pa tek onda opozvati stari token. | Opoziv/CAS (`updateMany` samo gdje `revokedAt IS NULL` i token nije istekao) + kreiranje nasljedne sesije premješteni su u jednu DB transakciju. Izgubljeni CAS prolazi kroz reuse revokaciju. Konkurentni unit test: jedan poziv uspije, drugi ne, nema aktivne sesije poslije reuse politike. | Popravljeno; live PostgreSQL potvrda otvorena |
| F1-04 | P1 | Reset-token se provjeravao prije transakcije, a paralelni zahtjevi nisu atomarno zahtijevali potrošnju baš tog tokena. | Unutar transakcije `updateMany` potroši red samo ako `id`, `usedAt IS NULL` i `expiresAt > consumedAt`; `count` mora biti `1` prije izmjene lozinke. Dva paralelna zahtjeva: tačno jedan uspije i `tokenVersion` se poveća jednom. | Popravljeno; live PostgreSQL potvrda otvorena |
| F1-05 | P1 | Dva administratora mogli su istovremeno proći `count(activeSuperAdmins) > 1`, pa ukloniti oba Super Admina. Postojeći trigger nije serijalizovao provjeru. | Dodana migracija `4_super_admin_guard_lock`: `pg_advisory_xact_lock` triggeri izvršavaju se prije postojećih guard triggera na `User`/`UserRole`. Dodan je stvarni concurrency case u `scripts/db-verify/behavior_tests.py`. Servis prevodi DB guard poruku u `409 LAST_SUPER_ADMIN_PROTECTED`. | Kod/migracija dodani; **nije izvršeno nad PostgreSQL-om** |
| F1-06 | P2 | Login lockout je računao `failedLoginCount + 1` iz ranije pročitanog reda pa apsolutnim upisom gubio paralelne neuspješne pokušaje. | DB-atomarni `{ increment: 1 }`; prag se računa iz ažuriranog reda. Regresija s tri paralelna pogrešna login-a potvrđuje brojač `3` i `lockedUntil`. | Popravljeno |
| F1-07 | P2 | `INCR` pa neuspjeli `PEXPIRE` mogao je ostaviti trajni Redis limiter key bez TTL-a. | Prvi `PEXPIRE` mora potvrditi da je TTL postavljen; pri kvaru se novi brojač briše, zahtjev ide u dokumentovano `degraded` stanje, a DB lockout ostaje rezervni sloj. Test simulira PEXPIRE timeout. | Popravljeno; Redis server nije testiran |
| F1-08 | P2 | Audit redakcija je bila samo na vršnom nivou; tajna u ugniježđenom objektu/nizu mogla je proći u JSONB. | Redakcija je rekurzivna za plain objecte/nizove i pokriva camelCase/snake_case tokene, authorization i cookie ključeve. Test sadrži nested object + array. | Popravljeno |
| F1-09 | P1 | Opoziv trenutne sesije iz web UI-a ostavljao je cookie sa upravo opozvanim refresh tokenom. Sljedeći automatski refresh mogao je aktivirati reuse detekciju i ugasiti i ostale sesije. | `DELETE /auth/sessions/:id` vraća `{currentSessionRevoked}`; server briše refresh cookie samo kad je opozvana trenutna sesija. Web UI čisti lokalnu sesiju bez dodatnog `/auth/logout`/refresh poziva. API-controller i SessionProvider testovi. | Popravljeno; browser E2E otvoren |
| F1-10 | P2 | `invalidateAll()` podiže Redis globalni permission version, ali access token je nosio samo DB role version; novi token poslije globalne invalidacije mogao je ostati trajno `PERMISSIONS_STALE`. | Izdavanje tokena i `/auth/me` sada koriste `currentPermissionsVersion(roleIds, dbVersion)`; token i korisnički payload ostaju poravnati. Regresija s globalnom verzijom `5`. | Popravljeno |

## 3. RBAC/scope odluka

`user`, `role`, `permission` i `audit` API-ji su administrativne kolekcije bez pouzdanog vlasničkog filtera. Njihove rute zato traže permission scope `ALL`, umjesto da se implicitno tretira `OWN` kao dovoljan. Vlastiti profil i vlastite sesije ostaju dostupni preko `/auth/me` i `/auth/sessions`.

PII za User se dodatno provjerava po konkretnom redu: `user:view_pii:ALL` vidi sve, `OWN` vidi samo vlastiti red, ID-opsezi se za User ne tretiraju kao dozvola. `audit:view_security:OWN` ne otključava globalni SECURITY skup; za njega je potreban `ALL`.

### Cross-phase opažanje

**Riješeno u nastavku Faze 3:** flat provjera `driver:view_pii` zamijenjena je rednom scope provjerom. `ALL` otkriva PII globalno, `OWN` samo kada je akter kreator konkretnog vozača, a `DRIVER_IDS` samo za ID prisutan u grantovima; ostali/neprimjenjivi opsezi ostavljaju PII redigovan. Ista odluka se primjenjuje na detalj vozača i osjetljive podatke kategorija dozvole. `p14-drivers-pii-http.spec.ts` sada pokriva OWN/DRIVER_IDS match i mismatch. Ovaj follow-up je zatvoren za logiku i regresijski HTTP test; puni P14 OpenAPI sweep i dalje je zasebno otvoren.

## 4. Testovi i dokaz

### Izvršeno

- Puna kapija: `PATH="/tmp/vfm-pnpm-bin:$PATH" PRISMA_SCHEMA_ENGINE_BINARY=/bin/true corepack pnpm exec turbo run lint typecheck test build` → **exit 0**, Turbo **25/25**.
- API: **56 test fajlova, 916 testova, sve prolaze**.
- Targetirani paket Faze 1 nakon izmjena: **197 API testova** preko 8 fajlova i **5 web session testova** prolaze.
- `python3 -m py_compile scripts/db-verify/apply_migrations.py scripts/db-verify/behavior_tests.py` i `git diff --check` prolaze.
- `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` je lokalni workaround da Prisma Client generisanje prođe; nije produkcijski postupak niti razlog da se generated client commita.

### Nije izvršeno — ne predstavljati kao dokaz

- `scripts/db-verify/apply_migrations.py` i `behavior_tests.py` nad PostgreSQL-om (uključujući 3/4 i paralelni Super Admin scenario).
- Redis stvarni kvar/ACL test; trenutni dokaz je unit fake.
- HTTP/API integration i E2E scenariji iz `audit/03-plan-E2E.md`; runner nije implementiran/pokrenut.
- Browser E2E za opoziv trenutne web sesije, cookie brisanje i prijavu poslije odjave.
- Deploy/migrate/seed/bootstrap na serveru.

## 5. Otvoreni sigurnosni i operativni uslovi

1. Prije release-a pokrenuti PostgreSQL verifier na izoliranoj `vfm_verify` bazi i obavezno potvrditi `4_super_admin_guard_lock` + konkurentni case. Ne ciljati produkciju verifierom — on briše i kreira bazu.
2. Pokrenuti live test za refresh CAS i reset-token CAS na PostgreSQL-u; unit fake serijalizuje `$transaction` callbacke i nije zamjena za DB izolacijski dokaz.
3. Pokrenuti Redis test s PEXPIRE/ACL/timeout kvarom i potvrditi cleanup/log metrike.
4. Izvršiti HTTP P1/P2/P3/P14 i browser E2E scenarije; posebno Super Admin mobile, session logout-one, refresh/reuse i password-reset race.
5. ✅ `driver:view_pii` scope follow-up za Fazu 3 — redna PII provjera i OWN/DRIVER_IDS HTTP regresije dodane su (vidi cross-phase opažanje iznad).
6. FCM i Firebase ostaju neaktivni; ova faza ih ne uključuje.

## 6. Neizmijenjeni uslovi

- GPS i FCM guardrails ostaju netaknuti: GPS se ne dodaje; pravilo ostaje task-scoped, nakon eksplicitnog starta i samo dodijeljenom vozaču.
- Nema commitovanja Firebase JSON, service account, `.env`, ključeva ili credentials.
- Pet ranijih mobile working-tree izmjena nije dio ovog patch seta i ne smije se slučajno stageati.
