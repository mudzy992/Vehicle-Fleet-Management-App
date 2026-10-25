# Faza 5 — početni audit i otvoreni kriteriji

**Datum presjeka:** 25.10.2026.  
**Status:** aktivna, nepotpuna. Ovo je audit koda, ne potvrda završetka Faze 5.

## Nalazi prema `docs/PLAN_IMPLEMENTACIJE.md` §6

| Područje                 | Nalaz                                                                                                                                                                                                                                                                                                 | Status                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| TaskType i seed kataloga | TaskType API, seed osam vrsta i web upravljanje tipovima postoje.                                                                                                                                                                                                                                     | Implementirano; CI pokriva build/test                                                                |
| Tok zadatka i prava      | API pokriva kreiranje, dodjelu, claim, završetak, otkazivanje, reopen/release, komentare i evente; web ima listu, detalj, kreiranje i statusne akcije.                                                                                                                                                | Implementirano uz unit/HTTP testove; P4/P5 nisu ovim auditom ponovo potvrđeni u live toku            |
| Atomski claim            | `TasksService.claim()` radi uslovni update/CAS i zapisuje assignment, event i OutboxEvent u istoj transakciji. Jedinični test paralelnih zahtjeva postoji.                                                                                                                                            | Kod/unit i P6 DB stress potvrđeni CI runom **40140186523**                                           |
| P6 stress                | Dodan `test:stress` i `apps/api/test/stress/task-claim-stress.stress.spec.ts`: 200 poziva stvarnog `TasksService.claim()` prema izolovanoj CI PostgreSQL bazi; provjerava jedan uspjeh, 199 `TASK_ALREADY_CLAIMED`, jedan `IN_PROGRESS`, jedan ASSIGNEE, jedan CLAIMED TaskEvent i jedan OutboxEvent. | Implementirano i potvrđeno CI runom **40140186523**                                                  |
| Transactional outbox     | Task mutacije upisuju OutboxEvent u istoj DB transakciji. Worker obrađuje batch-eve uz `FOR UPDATE SKIP LOCKED`, lease recovery, idempotentno kreiranje in-app Notification redova, backoff i `DEAD` nakon limita pokušaja.                                                                           | Implementirano; integration + CI run **40184248265** prolaze                                         |
| In-app obavijesti        | Lista, unread count, mark-read/mark-all-read postoje; Outbox kreira vidljive Notification redove prema `channelInApp`, dok FCM-only poruke ostaju skrivene iz inboxa.                                                                                                                                 | Implementirano; vidljivost i obrada potvrđene CI runom **40186692509**                               |
| FCM, uređaji i SSE       | Firebase Admin gateway i NotificationDelivery processor su CI-potvrđeni; DeviceToken API je owner-scoped; SSE je permission-checked DB polling stream s Last-Event-ID replayom, unread-count i keepalive događajima. Redis pub/sub fan-out nije uveden. | FCM/DeviceToken potvrđeni CI **40187788005**; SSE unit/HTTP pokrivenost potvrđena CI **40190059428** |
| NotificationPreference   | API sada omogućava prijavljenom korisniku čitanje i upsert vlastitih kanal-postavki uz `notification:manage_preferences`; body ne prihvata `userId`. Globalno upravljanje primaocima/tipovima Super Admina još nije pokriveno.                                                                        | Djelimično implementirano; dodat HTTP owner/permission test                                          |
| Idempotency              | Globalni HTTP Idempotency-Key middleware i testovi postoje. Task događaji imaju stabilne idempotency ključeve.                                                                                                                                                                                        | Kod/unit pokriven; treba potvrda integracije cijelog task HTTP toka                                  |

## Provjere i granice

- Pregledani su `PLAN_IMPLEMENTACIJE.md` §6, task/notification/queue moduli, worker, Prisma modeli, CI workflow i postojeći unit/integration testovi.
- CI run **40140186523** prolazi u cijelosti. Integracijski job je izvršio i zaseban `test:stress`; raniji CI **40138552249** je P6 preskočio jer skripta još nije postojala.
- Nije pokrenuta produkcijska ni korisnička baza. P6 fixture koristi jedinstvene ID-jeve i ostaje u disposable CI PostgreSQL-u zato što je TaskEvent append-only; CI gasi cijeli servisni kontejner nakon joba. Svaki naredni stress/DB test mora koristiti samo izolovanu CI/staging bazu; lokalni testovi se ne smiju usmjeravati na neprovjeren DB URL.
- Firebase nalog/tajne se ne traže niti mijenjaju. Dok korisnik ne omogući konfiguraciju u vlastitom okruženju, push dostava ostaje blokirana; možemo razvijati i testirati adapter uz mock.

## Ažurirane provjere (25.10.2026.)

- Commit `9d2a5e7` dodao je OutboxEvent → Notification obradu, worker polling/shutdown i retry/DEAD/dedupe testove; push CI `40184248265` je u cijelosti uspješan (uklj. integration, unit+coverage, typecheck, build i Docker).
- Lokalni processor/service/controller lint je prošao; ciljani unit/HTTP testovi nakon promjene postavki: 13 prošlo. DB integration je potvrđen samo u CI izolovanoj PostgreSQL bazi; lokalno se nije spajalo na DB.
- Commit `04e30e5` stabilizovao je datum fixture-a za overdue task test; ciljano 44 testa prolaze.
- Dodan je self-service API za vlastite notification kanal-postavke; body ne prihvata `userId` klijenta.
- FCM tok je implementiran: migration za lease/retry polja, notification visibility po kanalu, Firebase Admin gateway (lazy file-mount credentials) i zaseban delivery processor. Lokalni gateway/processor unit testovi prolaze (7); ciljani unit/HTTP skup prolazi (20); targetirani TypeScript check processor/gateway-a prolazi, a DB integracija/migracija potvrđene su CI runom **40186692509**.
- DeviceToken API: `GET/POST/DELETE /api/v1/devices/tokens`; vlasnik se određuje isključivo iz prijavljenog korisnika. SHA-256 hash služi deduplikaciji; sirovi token se čuva za FCM, ali se ne vraća, a audit ga redaktuje. Isti token ne može registrovati drugi korisnik dok ga prethodni vlasnik ne opozove. Ciljani service/HTTP + P14 testovi (12), Prisma select-registry test i CI-guarded isolated-DB lifecycle test prolaze.
- CI **40187616341**: isolated integration (uklj. DeviceToken lifecycle), P6/P15 i security su prošli; typecheck/unit našli su neispravan Vitest mock tip i nedostajući `DEVICE_TOKEN_SELECT` u registru. Popravke su potvrđene punim CI runom **40187788005** (unit+coverage, integration, typecheck, build/Docker i security).
- CI **40186049858**: Prisma client generation i migration deployment prošli; integration je otkrio dva tokena na istom testnom korisniku (2 umjesto 1 dostave), a unit zastarjelu očekivanu listu migracija; dependency audit prijavio je ranjiv `node-forge`. Fixture je razdvojen po vlasniku uređaja, lista migracija ažurirana, a `firebase-admin` podignut na 14.5.0 (`pnpm audit --audit-level=high` prolazi). CI **40186411541** prošao je unit, lint/typecheck, build/Docker i security, ali je integration otkrio zastarjelu aserciju broja `PROCESSED` događaja (3 umjesto 2). CI **40186692509** potvrdio je punu integraciju, unit+coverage, migration, lint/typecheck, dependency/security scan, build i Docker.
- Firebase ostaje isključen bez vlasničke konfiguracije. Ne čitaju se niti mijenjaju produkcijske tajne; `P16` backup/restore ostaje odgođen. Faza 5 ostaje aktivna/nepotpuna.

## SSE i naredne provjere (25.10.2026.)

- Implementiran `GET /api/v1/notifications/stream` (`Accept: text/event-stream`, opcioni `Last-Event-ID`) s filtrom po prijavljenom korisniku, samo `inAppVisible` obavijestima, početnim `unread-count`, keepalive svakih 5 s i batch pollingom od najviše 100 događaja. Redis pub/sub nije uveden; ovo je DB-polling MVP i API specifikacija bilježi razliku.
- `notification:view` provjerava se na otvaranju i svakom pollu; opoziv prava prekida postojeći stream. API envelope se preskače za SSE. Ciljani API unit/HTTP skup: 23/23 prolaze lokalno; lokalni puni API typecheck nije dostupan jer generisani Prisma klijent nedostaje (CI ga generiše).
- CI **40190059428** prolazi: unit+coverage, isolated integration, P6/P15, lint/typecheck, security, build i Docker. SSE je pokriven unit/HTTP testovima u tom runu, ali nema zaseban DB-backed stream integration test. Nema produkcijskih testova za SSE. Firebase konfiguraciju ne dirati.

## P4–P8 dokazni jazovi

| Kriterij | Dokaz koji postoji | Šta nedostaje za prihvatanje |
|---|---|---|
| P4 | Task-create API permisije pokrivene P14 HTTP sweepom; web task-create komponentni testovi postoje. | Nema mobilnog create wizard/Maestro E2E testa koji provjerava kreiranje i vidljivost u listi/webu; nema mobilnog UI dokazivanja da FAB nestaje bez prava. |
| P5 | `task-open-visibility.integration.spec.ts`: dva korisnika kroz HTTP GET `/tasks/available`, stvarni DB outbox i dvije Notification stavke, HTTP claim pa GET detalja drugom korisniku. | Potvrđeno CI **40192057825** na izolovanoj PostgreSQL bazi. |
| P6 | CI stress `40190059428`: 200 poziva stvarnog `TasksService.claim()` prema izolovanom PostgreSQL-u; tačno jedan claim/event/ASSIGNEE. | Nije puni acceptance tok kroz HTTP/Redis Idempotency-Key; trenutni stress koristi isti korisnički akter za sve pozive, za razliku od mješovitih korisnika iz test plana. |
| P7 | Unit testovi provjeravaju 403 NOT_ASSIGNEE, izvršioca i override granu/event podatke. | Nema DB integration potvrde za stvarni rollback, TaskEvent `OVERRIDE_COMPLETED` i AuditLog `COMPLETE` zajedno kroz transakcijski tok. |
| P8 | CI outbox/FCM integration s mock gateway-em provjerava retry, invalid token, deduplikaciju i SENT. | Test ne veže fixture za stvarni Task; zato ne potvrđuje da stvarni task ostaje IN_PROGRESS dok FCM pada i nakon retry nema duplih Notification redova. |

## Sljedeći uski korak

P5 je potvrđen CI-jem. Sljedeće: dodati DB integration dokaze za P7/P8, definisati admin politiku primaoca/tipova, uskladiti P6 stress s acceptance putem idempotentnog HTTP toka i odrediti izvediv testni pristup za mobilni P4 E2E. Ne označavati Fazu 5 završenom.
