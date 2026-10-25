# Faza 5 — početni audit i otvoreni kriteriji

**Datum presjeka:** 25.10.2026.  
**Status:** aktivna, nepotpuna. Ovo je audit koda, ne potvrda završetka Faze 5.

## Nalazi prema `docs/PLAN_IMPLEMENTACIJE.md` §6

| Područje                 | Nalaz                                                                                                                                                                                                                                                                                                 | Status                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| TaskType i seed kataloga | TaskType API, seed osam vrsta i web upravljanje tipovima postoje.                                                                                                                                                                                                                                     | Implementirano; CI pokriva build/test                                                                     |
| Tok zadatka i prava      | API pokriva kreiranje, dodjelu, claim, završetak, otkazivanje, reopen/release, komentare i evente; web ima listu, detalj, kreiranje i statusne akcije.                                                                                                                                                | Implementirano uz unit/HTTP testove; P4/P5 nisu ovim auditom ponovo potvrđeni u live toku                 |
| Atomski claim            | `TasksService.claim()` radi uslovni update/CAS i zapisuje assignment, event i OutboxEvent u istoj transakciji. Jedinični test paralelnih zahtjeva postoji.                                                                                                                                            | Kod/unit pokriven; P6 DB stress kriterij nije potvrđen                                                    |
| P6 stress                | Dodan `test:stress` i `apps/api/test/stress/task-claim-stress.stress.spec.ts`: 200 poziva stvarnog `TasksService.claim()` prema izolovanoj CI PostgreSQL bazi; provjerava jedan uspjeh, 199 `TASK_ALREADY_CLAIMED`, jedan `IN_PROGRESS`, jedan ASSIGNEE, jedan CLAIMED TaskEvent i jedan OutboxEvent. | Implementirano i potvrđeno CI runom **40140186523**                                                       |
| Transactional outbox     | Task mutacije upisuju OutboxEvent u istoj DB transakciji. Worker obrađuje batch-eve uz `FOR UPDATE SKIP LOCKED`, lease recovery, idempotentno kreiranje in-app Notification redova, backoff i `DEAD` nakon limita pokušaja.                                                                           | Implementirano; integration + CI run **40184248265** prolaze                                              |
| In-app obavijesti        | Lista, unread count, mark-read/mark-all-read postoje; Outbox kreira vidljive Notification redove prema `channelInApp`, dok FCM-only poruke ostaju skrivene iz inboxa.                                                                                                                                 | Implementirano; vidljivost i obrada provjeravaju se CI integracijom                                       |
| FCM, uređaji i SSE       | Dodani su Firebase Admin gateway (service-account file mount, lazy inicijalizacija) i zaseban NotificationDelivery processor s `SKIP LOCKED`, backoff do 5 pokušaja, `DEAD` i invalid-token oznakom; dostava poštuje `channelFcm`. `DeviceToken` lifecycle API i SSE još nedostaju.                   | Implementacija dodana; čeka CI migraciju/integraciju; Firebase stvarni projekat/tajne obezbjeđuje vlasnik |
| NotificationPreference   | API sada omogućava prijavljenom korisniku čitanje i upsert vlastitih kanal-postavki uz `notification:manage_preferences`; body ne prihvata `userId`. Globalno upravljanje primaocima/tipovima Super Admina još nije pokriveno.                                                                        | Djelimično implementirano; dodat HTTP owner/permission test                                               |
| Idempotency              | Globalni HTTP Idempotency-Key middleware i testovi postoje. Task događaji imaju stabilne idempotency ključeve.                                                                                                                                                                                        | Kod/unit pokriven; treba potvrda integracije cijelog task HTTP toka                                       |

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
- FCM tok je implementiran u radnoj promjeni: migration za lease/retry polja, notification visibility po kanalu, Firebase Admin gateway (lazy file-mount credentials) i zaseban delivery processor. Lokalni gateway/processor unit testovi prolaze (7); prošireni ciljani unit/HTTP skup prolazi (20); targetirani TypeScript check processor/gateway-a prolazi. DB integracija/migracija mora biti potvrđena narednim CI runom.
- Firebase ostaje isključen bez vlasničke konfiguracije. Ne čitaju se niti mijenjaju produkcijske tajne; `P16` backup/restore ostaje odgođen. Faza 5 ostaje aktivna/nepotpuna.

## Sljedeći uski korak

Nakon CI potvrde migration-a i FCM retry toka, dodati DeviceToken registraciju/opoziv (hash tokena, owner scope, test invalidacije) pa provjeriti P4–P8 kroz end-to-end tokove. Ne uključivati Firebase bez vlasničke konfiguracije niti označavati Fazu 5 završenom.
