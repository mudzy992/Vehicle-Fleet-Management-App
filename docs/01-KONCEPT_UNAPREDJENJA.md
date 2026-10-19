# 01 — Unapređenja koncepta, logike i funkcionalnosti

**Ulaz:** `Projektni_zadatak_Vozni_park_Unaprijedjen.md` v2.0
**Cilj dokumenta:** registrovati sve delte u odnosu na zadatak — unapređenja, ispravke uočenih
nedostataka/bug-ova u samom zadatku, te nove funkcionalnosti koje proizlaze iz prakse upravljanja
voznim parkom. Svaka delta ima **ID**, **obrazloženje** i **uticaj na fazni plan**.

Konvencija ID-ova: `U-xx` = unapređenje, `B-xx` = bug/propust u zadatku, `N-xx` = nova
funkcionalnost, `R-xx` = rizik/otvoreno pitanje.

---

## A. Ispravke uočenih nedostataka i bug-ova u projektnom zadatku

| ID | Nalaz u zadatku | Problem | Ispravka (naš dizajn) | Faza |
|---|---|---|---|---|
| **B-01** | §10.3 „oba obična korisnika dobijaju obavijest" | Tok je opisan za tačno 2 korisnika; sistem mora raditi za **N** korisnika | Model `TaskAssignment` (0..N pozvanih) + `OPEN_CLAIM` režim; obavijest ide svim pozvanima; UI poruka „Zadatak je preuzeo {ime}" | 5 |
| **B-02** | §15 „Compose minimalno pokreće PostgreSQL, backend i web" vs. zahtjev vlasnika da se koristi **postojeća** baza na `db_net` | Kontradikcija: compose ne smije sadržavati PostgreSQL ako je on Coolify resurs | Compose **ne** sadrži postgres/redis; `db_net`/`redis_net` su `external`. Lokalni dev koristi `docker-compose.dev.yml` s vlastitim bazama istih naziva mreža | 0 |
| **B-03** | §15 Coolify + custom mreže | Coolify eksplicitno upozorava: kontejner na **dvije** mreže → Traefik nedeterministički bira IP → **504/hang** | `web` ostaje **samo** na Coolify mreži; `db_net`/`redis_net` dobijaju samo `api`/`worker`/`migrate`. Dokumentovan fallback (web kao zaseban Coolify resurs) | 0, 8 |
| **B-04** | §2.6/§15 „PostgreSQL koristi persistent volume" | Kod Coolify-ja DB nije naš; backup je naša odgovornost ali se ne može riješiti volume-om u compose-u | Backup/restore dokumentovan kao procedura nad Coolify PostgreSQL resursom (`pg_dump` + kopija na drugi host) + backup host volume-a s prilozima | 8 |
| **B-05** | §5.5 „čuvati `formSchemaId`, `formSchemaVersionId`" | Nije definisano kako se određuje „aktivna objavljena verzija" u trenutku kreiranja → race ako se objava desi istovremeno | Aktivna verzija se **snapshot-uje** unutar iste transakcije kao i zapis (`SELECT ... WHERE status='PUBLISHED' AND subject=... ORDER BY publishedAt DESC LIMIT 1 FOR UPDATE`), + keš s invalidacijom | 2 |
| **B-06** | §3.5 „Opozvana prava moraju se brzo primijeniti" vs. §14 „stari token ne smije zadržati ukinuta prava" | Nije definisan mehanizam; klasični stateless JWT to **ne može** | `permissionsVersion` (globalni + po roli) i `tokenVersion` (po korisniku) u Redisu; guard na **svakom** zahtjevu upoređuje claim iz tokena s trenutnom verzijom; permisije se **nikad** ne čitaju iz JWT-a | 1 |
| **B-07** | §3.2 „Super Admin nema mogućnost prijave u mobilnu aplikaciju" | Ako se oslanja samo na ulogu iz tokena, mobilni klijent može poslati `clientType=WEB` i zaobići pravilo | `clientType` se **ne vjeruje** slijepo: (1) mobilni tok zahtijeva refresh token izdan za `MOBILE_ANDROID`, (2) zabrana se provjerava iz **DB** (rola + `allowedClientTypes`) na loginu i na svakom zahtjevu guard-om, (3) audit `SECURITY` događaj | 1, 6 |
| **B-08** | §13 model podataka | Nedostaju entiteti bez kojih zahtjevi iz §7–§12 nisu izvodljivi | Dodato: `OdometerReading`, `ServiceItem`, `DriverLicenseCategory`, `TaskAssignment`, `ScheduledReminder`, `ReminderPolicy`, `IdempotencyKey`, `RefreshSession`, `AuthAttempt`, `FieldKeyRegistry`, `FormMigrationJob/Item`, `List/ListItem`, `Setting`, `NotificationPreference`, `ReportDefinition`, `ExportJob`, `UserIdentity` | 1–7 |
| **B-09** | §9 „Spriječiti da isti komplet bude istovremeno montiran na više vozila" | Nije definisano **kako** na nivou baze | Partial unique index na `TireInstallation(setId) WHERE dismountedAt IS NULL` + transakcijska provjera + `409 TIRE_ALREADY_MOUNTED`; stress test | 4 |
| **B-10** | §7 „istorija svih perioda" registracije/osiguranja | Nije spriječeno preklapanje perioda → dupli zapisi i pogrešni „aktuelni" rokovi | `EXCLUDE USING gist (vehicleId WITH =, daterange(validFrom, validUntil, '[]') WITH &&)` (ekstenzija `btree_gist`) | 3 |
| **B-11** | §6 „kilometraža" kao polje vozila | Jedno polje = gubitak historije i nemogućnost provjere potrošnje goriva | `OdometerReading` log (izvor, vrijednost, vrijeme, referenca) + denormalizovan `Vehicle.odometerKm` koji se ažurira u istoj transakciji; pravilo monotoniciteta s eksplicitnom korekcijom | 3 |
| **B-12** | §11 „Preporučiti transactional outbox" | „Preporučiti" je preslabo za zahtjev P8 (push greška ne smije uticati na zadatak) | Outbox je **obavezan** i implementiran: isti DB transakcijski upis, BullMQ potrošač, retry s backoff-om, DLQ, unique `notification_key` za idempotentnost | 5 |
| **B-13** | §7 „Podsjetnici su idempotentni po zapisu, vrsti i roku" | Bez mehanizma → dupli push-ovi pri ponovnom pokretanju skenera | `ScheduledReminder.dedupeKey` = `{kind}:{entityType}:{entityId}:{dueDate}:{thresholdDays}` s **unique** indeksom; skener koristi `INSERT ... ON CONFLICT DO NOTHING` | 3 |
| **B-14** | §2.5 „uklanjati nevažeće tokene" | Nije definisano kada | `DeviceToken.status` (`ACTIVE/INVALID/UNREGISTERED`) + `lastError`; FCM `UNREGISTERED`/`INVALID_ARGUMENT` odmah deaktivira token; čišćenje kroz `vfm-queue-maintenance` | 5 |
| **B-15** | §14 „Zaštita uploadova" | Nema konkretne specifikacije | Whitelist MIME + **magic bytes** provjera + max veličina + SHA-256 + ne-izvršne ekstenzije + serviranje isključivo kroz API s potpisanim URL-om i provjerom permisija + audit pristupa | 3 |
| **B-16** | §16 „bez fiksnih lozinki" u seedu, ali §3.5 traži seed-ovanje rola | Rizik da developeri hardkodiraju `admin/admin` | `scripts/bootstrap-super-admin.mjs` generiše slučajnu lozinku i ispisuje je **jednom**; seed korisnici imaju `mustChangePassword=true`; CI provjera da u repo-u nema poznatih lozinki (gitleaks + custom rule) | 1 |
| **B-17** | §5.3 „kontrolisana izračunata vrijednost" | Bez definicije → najveći sigurnosni rizik cijelog sistema | Zatvorena gramatika izraza + AST evaluator bez `eval`/`Function`, whitelist funkcija, limiti (dužina, dubina, vrijeme), deterministički rezultat; dokumentovano u `04-FORM_ENGINE.md` | 2 |
| **B-18** | §12 „izvoz PDF/Excel uz provjeru prava" | Sinhroni izvoz velikih skupova blokira API | Export ide kroz `vfm-queue-reports` (job + signed URL) iznad `REPORT_EXPORT_SYNC_MAX_ROWS`; svaki izvoz je auditovan | 7 |
| **B-19** | §2.2 „Prisma migracije" bez napomene o ograničenjima | Prisma ne generiše `CHECK`, `EXCLUDE`, partial unique indekse i trigger-e | Ručni SQL u `prisma/migrations/*/migration.sql` (nakon `prisma migrate diff`), nikad `db push` u produkciji; dokumentovano | 0 |
| **B-20** | §4 „Pristup ličnim podacima mora biti ograničen dozvolama" | Nema granularnosti | Uvedena permisija `driver:view_pii` (odvojen pristup JMBG/kontakt/broj dozvole) + field-level redigovanje u API odgovorima i audit pristupa PII | 1, 3 |

---

## B. Unapređenja logike i koncepta

| ID | Unapređenje | Obrazloženje | Faza |
|---|---|---|---|
| **U-01** | **Novac kao integer u feninzima** + `currency` (BAM) | `float`/`double` u troškovima daje greške u izvještajima (0.1+0.2). Svi iznosi `integer`, dijeljenje samo u prezentacijskom sloju | 3–7 |
| **U-02** | **Vremenska zona kao pravilo, ne kao string** | DB `timestamptz` (UTC), „datum isteka" je `date`, a podsjetnici se računaju u `Europe/Sarajevo`. Bez ovoga „5 dana prije isteka" zna promašiti za jedan dan | 3 |
| **U-03** | **Normalizovane kolone + JSONB, s eksplicitnim mapiranjem** | Zadatak traži oboje; mi dodajemo `FormSchemaVersion.normalizedName[]` koji deklarativno mapira `fieldKey → kolona`, pa backend automatski popunjava normalizovane kolone pri create/update. Time izvještaji nikad ne ovise o JSONB pretragama | 2 |
| **U-04** | **Scope podataka kao dio permisije** (`ALL`, `OWN`, `VEHICLE_IDS`, `DRIVER_IDS`) | Zadatak kaže „po potrebi opseg podataka". Bez toga „obični korisnik vidi sva vozila" ili „ne vidi ništa" — scope daje sredinu i omogućava npr. vozaču da vidi samo svoje vozilo | 1 |
| **U-05** | **Statusna mašina zadatka kao kod, forma kao podaci** | Dinamička forma **ne smije** moći promijeniti tok stanja. Tranzicije su definisane u servisu + DB CHECK, a ne u shemi forme | 5 |
| **U-06** | **Idempotency-Key header** za `POST /tasks`, `POST /tasks/:id/claim`, `POST /tasks/:id/complete`, `POST /attachments` | Mobilna mreža puca → klijent retry-uje → bez idempotencije dobijamo dupli zadatak/duplu kilometražu | 5, 6 |
| **U-07** | **Optimistic locking** (`version` kolona) na `Vehicle`, `Task`, `TireInstallation` | Sprječava „lost update" kada dva administratora istovremeno uređuju isti zapis | 3, 5 |
| **U-08** | **Soft delete + `deletedAt`** za poslovne zapise, **hard delete** zabranjen | Arhiviranje ne briše historiju (§6). `delete` permisija = trajno brisanje uz audit i samo za Super Admina, s `deletedAt` i dalje prisutnim (pravna sljedivost) | sve |
| **U-09** | **Audit diff umjesto snapshot-a cijelog zapisa** | `before`/`after` JSONB samo za promijenjena polja → 10× manja tabela, lakše čitljivo u UI | 1 |
| **U-10** | **`OutboxEvent` + `Notification` + `NotificationDelivery` (3 nivoa)** | Odvaja *događaj* (šta se desilo), *obavijest* (ko treba vidjeti) i *isporuku* (FCM po tokenu). Retry i dijagnostika postaju trivialni | 5 |
| **U-11** | **SSE za web real-time, FCM za mobilnu** | Web portal ne treba polling; jedan `EventSource` po korisniku, fan-out preko Redis pub/sub kanala `vfm:sse:{userId}` | 5 |
| **U-12** | **Podsjetnici s eskalacijom** (T-14, T-7, T-3, T-1, T+0) umjesto samo jednog praga | Jedan podsjetnik 5 dana prije isteka registracije se lako previdi. `ReminderPolicy` dozvoljava N pragova po vrsti, svaki s vlastitim `dedupeKey` | 3 |
| **U-13** | **Kilometražni podsjetnici** (servis, zamjena guma) | Servis se često veže za kilometre, ne za datum. Podsjetnik se računa iz posljednjeg `OdometerReading` | 3, 4 |
| **U-14** | **Jedna operacija „swap guma"** | Realni tok: skinuti ljetne, staviti zimske. Dva odvojena poziva ostavljaju vozilo bez guma ako drugi padne → jedna transakcija | 4 |
| **U-15** | **Pozicije guma (FL/FR/RL/RR) + rotacija** | Omogućava praćenje neravnomjernog trošenja i izvještaj „koja guma je gdje bila" | 4 |
| **U-16** | **`FieldKeyRegistry`** (globalni registar ključeva polja) | Sprječava da dva različita polja u različitim formama koriste isti ključ s drugim tipom → čuva normalizovane kolone i izvještaje | 2 |
| **U-17** | **Migracija forme = job s preview-om, snapshot-om i rollback-om** | §5.5 traži „mogućnost oporavka". Bez snapshot-a originalnih `formData` oporavak nije moguć | 2 |
| **U-18** | **`ReportDefinition` + sačuvani filteri** | Korisnici stalno koriste iste filtere; bez ovoga izvještaji postaju neupotrebljivi | 7 |
| **U-19** | **Globalna postavka „fiskalna godina / obračunski period"** | Troškovi se grupišu po mjesecu/godini; bez eksplicitne postavke izvještaji „ove godine" su dvosmisleni | 7 |
| **U-20** | **`Setting` s tipovima i validacijom + audit promjene** | §3.2 „globalne postavke i šifarnici" bez strukture = JSON dumping ground. Postavke imaju `key`, `type`, `schema`, `isSecret` | 1 |
| **U-21** | **Šifarnici (`List`/`ListItem`) kao DB podaci** | Vrste goriva, radionice, lokacije skladišta, razlozi otkazivanja — sve se mijenja bez deploya | 3 |
| **U-22** | **Health endpointi `live`/`ready` + `startup`** | `ready` provjerava DB, Redis, disk prostor za priloge i Firebase inicijalizaciju → Coolify/Docker ne pušta saobraćaj na polomljenu instancu | 0 |
| **U-23** | **Strukturirani logovi (pino) + `requestId` kroz cijeli lanac** | Bez korelacije API → worker → FCM nemoguće je dijagnosticirati P8 | 0, 5 |
| **U-24** | **Redigovanje tajni u logovima i audit diff-u** | `AUDIT_REDACT_FIELDS` centralno; sprečava curenje lozinki/tokena u logove | 0, 1 |
| **U-25** | **Zaseban `worker` kontejner** (ne cron u API-ju) | Push retry i export ne smiju dijeliti event loop s HTTP zahtjevima; scale=1 uz BullMQ locking | 0, 5 |
| **U-26** | **Redis ACL s najmanjim pravima** (`vfm-api`, `vfm-worker`, `vfm-readonly`, `default off`) | Dijeljeni Redis na istom hostu s drugim aplikacijama → bez ACL-a naša aplikacija može čitati/tuđe ključeve | 0 |

---

## C. Nove funkcionalnosti (proizašle iz domene, a nedostaju u zadatku)

| ID | Funkcionalnost | Zašto je potrebna | Prioritet | Faza |
|---|---|---|---|---|
| **N-01** | **Evidencija goriva i potrošnja (L/100 km)** | „Dopuna goriva" postoji kao *zadatak*, ali bez strukture nema potrošnje ni troška po vozilu — najčešće pitanje uprave | Visok | 5 (tip zadatka) + 7 (izvještaj) |
| **N-02** | **Kategorije troškova + budžet po vozilu/godini** | Bez kategorija „ukupni troškovi" su beskorisni; budžet daje upozorenje pri prelasku | Visok | 7 |
| **N-03** | **Vozačka dozvola: kategorije + istek + podsjetnik** | Zadatak spominje „datum isteka dozvole" ali ne i podsjetnik; istekla dozvola = pravni rizik | Visok | 3 |
| **N-04** | **Tehnički pregled kao evidencija s rokom** | U BiH je dio registracijskog procesa; bez eksplicitnog praćenja rok se gubi | Srednji | 3 |
| **N-05** | **Primopredaja vozila (check-in/check-out)** | Ko je vozilo preuzeo, s kojim stanjem (km, gorivo, oštećenja, fotografije). Rješava „ko je napravio ogrebotinu" | Srednji | 3, 6 |
| **N-06** | **Lokacija/skladište guma i setova** | Gume se fizički premještaju; bez lokacije ih ljudi traže | Srednji | 4 |
| **N-07** | **Globalna pretraga (vozila, korisnici, zadaci, dokumenti)** | Sa 10 vozila i stotinama zadataka, navigacija bez pretrage postaje spora | Srednji | 7 |
| **N-08** | **Dashboard s KPI-ovima i „rokovi" listom** | Super Admin/administrator treba jedan pogled: šta ističe, šta je otvoreno, koliko je potrošeno | Visok | 3, 7 |
| **N-09** | **Download centar (export jobovi)** | Veliki izvozi se ne mogu držati u browser requestu | Srednji | 7 |
| **N-10** | **Prilozi uz kompresiju fotografija na uređaju** | Mobilne kamere daju 5–12 MB; bez kompresije troši se prostor i vrijeme | Visok | 6 |
| **N-11** | **EXIF/GPS čišćenje fotografija** | Fotografije s terena sadrže lokaciju i metapodatke → rizik po privatnost | Srednji | 3 |
| **N-12** | **Korisničke postavke obavijesti po vrsti** (`NotificationPreference`) | Bez toga administrator dobija 50 push-ova dnevno i isključi sve | Srednji | 5 |
| **N-13** | **Status vozila `IN_SERVICE` automatski iz otvorenog zadatka** | Sprječava da se vozilo dodijeli na drugi zadatak dok je u servisu | Nizak | 5 |
| **N-14** | **Komentar/diskusija na zadatku s @spomenom** | Realni tok: izvršilac pita nešto, administrator odgovori | Nizak | 5 |
| **N-15** | **QR/kod naljepnica za vozilo** → scan na mobilnoj otvara profil vozila | Brz pristup evidenciji pored vozila bez kucanja | Nizak | 6 (v2) |
| **N-16** | **Mjesečni automatski izvještaj (PDF) na e-mail** | Uprava traži izvještaj bez ulaska u sistem | Nizak | v2 (izvan obima) |
| **N-17** | **`ExportJob` + potpisani link s istekom** | Sigurniji i auditan način dostave izvoza | Srednji | 7 |

> Sve stavke s prioritetom **Nizak** i **v2** idu u backlog i **ne** ulaze u faze 0–9 osim gdje je
> eksplicitno navedeno. Time se štiti rok.

---

## D. Nefunkcionalni zahtjevi (kvantifikovani)

Zadatak ih navodi kvalitativno; ovo su mjerljivi ciljevi po kojima se faze primaju.

| Kategorija | Zahtjev | Cilj |
|---|---|---|
| Performanse | API p95 latencija (liste, čitanje) | < 400 ms |
| Performanse | API p95 latencija (pisanje s transakcijom) | < 700 ms |
| Performanse | Dashboard (prvi load) | < 800 ms |
| Performanse | Mobilna: lista zadataka (keširano) | < 200 ms |
| Kapacitet | Vozila / korisnici / zadaci godišnje | 100 / 200 / 50 000 |
| Dostupnost | Mjesečna dostupnost (jedan server) | ≥ 99 % (planirani održavanje najavljen) |
| RPO / RTO | Gubitak podataka / vrijeme oporavka | RPO ≤ 24 h, RTO ≤ 4 h |
| Revokacija prava | Vrijeme do primjene | ≤ 5 s |
| Obavijesti | Kašnjenje push-a od događaja | p95 ≤ 10 s |
| Sigurnost | OWASP ASVS | nivo 2 |
| Pristupačnost | Web | WCAG 2.2 AA |
| Mobilna | touch target / kontrast | ≥ 44 px / 4.5:1 |
| Podaci | Retencija audit loga | trajno (konfigurabilno) |
| Prilozi | Max veličina / tipovi | 10 MB / JPEG, PNG, WebP, HEIC, PDF |
| Backup | Učestalost / testiran restore | dnevno / kvartalno + pri svakoj većoj promjeni |
| Jezik / lokalizacija | UI, datumi, brojevi | `bs`, `dd.MM.yyyy HH:mm`, `1.234,56 KM` |

---

## E. Otvorena pitanja i rizici (traže potvrdu vlasnika prije/ tokom faza)

| ID | Pitanje | Predloženi default | Blokira fazu |
|---|---|---|---|
| **R-01** | Da li se Redis instanca dijeli s drugim aplikacijama? | Pretpostavka: dijeljena → ACL `~vfm:*` je obavezan | 0 |
| **R-02** | Postoji li već Coolify destinacija (mreža) nazvana `db_net`/`redis_net`, ili ih treba kreirati? | Kreirati (`docker network create db_net redis_net` ili kroz Coolify Destinations) | 0 |
| **R-03** | Domena za web i API (npr. `voznipark.ba` / `api.voznipark.ba`)? | Vlasnik daje prije Faze 8 | 8 |
| **R-04** | Firebase projekat: ko kreira, ima li već Android aplikaciju registrovanu? | Vlasnik kreira projekat + Android app (package `ba.example.voznipark`) i daje `google-services.json` i `firebase-service-account.json` | 5, 6 |
| **R-05** | Da li postoji potreba za 2FA (TOTP) za Super Admina? | Predlažemo **da** (opcionalno, `AUTH_2FA_ENABLED`) | 1 (opciono) |
| **R-06** | Koliko dugo se čuvaju završeni zadaci i prilozi? | Trajno + retencija exportova 7 dana | 8 |
| **R-07** | Da li administrator smije vidjeti lične podatke vozača (broj dozvole, kontakt)? | Predloženo: zasebna permisija `driver:view_pii`, default **ne** za običnog korisnika | 1, 3 |
| **R-08** | Treba li sistem podržati vozila koja nisu u vlasništvu (lizing/rent)? | Predloženo: `ownershipType` polje + `leasing` evidencija (bez finansijskog obračuna) | 3 |
| **R-09** | Da li se izvještaji izvoze i na engleskom? | Predloženo: samo `bs` u v1 | 7 |
| **R-10** | Backup: postoji li off-site lokacija (drugi server, S3, restic)? | Predloženo: restic na drugi host/objekat + šifrovano | 8 |
| **R-11** | Ko odobrava objavu nove verzije forme (dvije osobe)? | Predloženo: jednoosobno + obavezna bilješka + audit (v1); four-eyes u v2 | 2 |
| **R-12** | Treba li ograničiti istovremeni broj zadataka po korisniku? | Predloženo: postavka `TASK_MAX_ACTIVE_PER_USER` (default 5) | 5 |

---

## F. Mapiranje na sekcije projektnog zadatka

| Zadatak § | Naša pokrivenost |
|---|---|
| 1 Sažetak | `PLAN_IMPLEMENTACIJE.md` §1 |
| 2 Tehnologije | `PLAN_IMPLEMENTACIJE.md` §4 (ADR), `02-ARHITEKTURA.md` |
| 3 RBAC | `05-RBAC_PERMISIJE_SIGURNOST.md` |
| 4 Nalozi i profili vozača | `03-MODEL_PODATAKA.md` (`User`, `UserIdentity`, `Driver`), B-08, B-20 |
| 5 Verzionisanje formi | `04-FORM_ENGINE.md`, U-03, U-16, U-17, B-05, B-17 |
| 6 Vozila | `03-MODEL_PODATAKA.md`, U-07, U-08, B-11 |
| 7 Registracija/osiguranje | B-10, B-13, U-02, U-12 |
| 8 Servisi | `03-MODEL_PODATAKA.md` (`ServiceRecord`, `ServiceItem`), U-13 |
| 9 Gume | B-09, U-14, U-15, N-06 |
| 10 Zadaci | B-01, U-05, U-06, U-10, `02-ARHITEKTURA.md` §tokovi |
| 11 Obavijesti | B-12, B-14, U-10, U-11, N-12 |
| 12 Izvještaji | B-18, U-18, U-19, N-01, N-02, N-07, N-09 |
| 13 Model podataka | `03-MODEL_PODATAKA.md` (kompletno + B-08) |
| 14 API i sigurnost | `07-API_SPECIFIKACIJA.md`, `05-RBAC_PERMISIJE_SIGURNOST.md` |
| 15 Docker/Compose | `08-DOCKER_COOLIFY_DEPLOYMENT.md`, B-02, B-03, B-04, U-25, U-26 |
| 16 Testiranje | `09-TEST_PLAN.md` |
| 17 Redoslijed | `PLAN_IMPLEMENTACIJE.md` §6 (faze 0–9, prošireno) |
| 18 Upute agentu | `PLAN_IMPLEMENTACIJE.md` §9 (pravila) |
| 19 Konačni cilj | `PLAN_IMPLEMENTACIJE.md` §2 (mjere uspjeha) |
