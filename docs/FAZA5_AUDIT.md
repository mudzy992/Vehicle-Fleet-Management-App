# Faza 5 — početni audit i otvoreni kriteriji

**Datum presjeka:** 25.10.2026.  
**Status:** aktivna, nepotpuna. Ovo je audit koda, ne potvrda završetka Faze 5.

## Nalazi prema `docs/PLAN_IMPLEMENTACIJE.md` §6

| Područje | Nalaz | Status |
| --- | --- | --- |
| TaskType i seed kataloga | TaskType API, seed osam vrsta i web upravljanje tipovima postoje. | Implementirano; CI pokriva build/test |
| Tok zadatka i prava | API pokriva kreiranje, dodjelu, claim, završetak, otkazivanje, reopen/release, komentare i evente; web ima listu, detalj, kreiranje i statusne akcije. | Implementirano uz unit/HTTP testove; P4/P5 nisu ovim auditom ponovo potvrđeni u live toku |
| Atomski claim | `TasksService.claim()` radi uslovni update/CAS i zapisuje assignment, event i OutboxEvent u istoj transakciji. Jedinični test paralelnih zahtjeva postoji. | Kod/unit pokriven; P6 DB stress kriterij nije potvrđen |
| P6 stress | `apps/api/package.json` nema `test:stress`; CI workflow zato izvršava fallback poruku da je stress test preskočen. U `apps/api/test/integration/` nema 200 paralelnih claim poziva protiv stvarne baze. | **Otvoren potvrđeni gap** |
| Transactional outbox | Task mutacije dodaju OutboxEvent unutar DB transakcije, ali `apps/api/src/tools/worker.ts` trenutno samo loguje da je outbox/notification obrada placeholder. `OutboxService` i dalje šalje direktno u BullMQ ili koristi prolazni in-memory buffer. | **Otvoren potvrđeni gap** |
| In-app obavijesti | API lista, unread count, mark-read i mark-all-read postoje. Kreiranje Notifications iz OutboxEvent i redelivery/obrada retryja nisu povezani u workeru. | Djelimično implementirano |
| FCM, uređaji i SSE | U repozitoriju nema FCM worker/delivery adaptera ni token lifecycle API-ja; notification controller nema SSE stream. `FIREBASE_ENABLED=false` je dokumentovano dok vlasnik ne pripremi Firebase konfiguraciju. | Nije implementirano / Firebase konfiguracija zavisi od vlasnika |
| NotificationPreference | Prisma model postoji, ali se nije našao API modul za upravljanje postavkama/kanalima. | **Otvoren potvrđeni gap** |
| Idempotency | Globalni HTTP Idempotency-Key middleware i testovi postoje. Task događaji imaju stabilne idempotency ključeve. | Kod/unit pokriven; treba potvrda integracije cijelog task HTTP toka |

## Provjere i granice

- Pregledani su `PLAN_IMPLEMENTACIJE.md` §6, task/notification/queue moduli, worker, Prisma modeli, CI workflow i postojeći unit/integration testovi.
- Posljednji puni CI za Phase 4, **40138552249**, prolazi. Njegov korak „Stress (P6 — atomski claim)” nije dokaz P6: workflow je uslovno preskočio izvršavanje jer nema `test:stress` skripte.
- Nije pokrenuta produkcijska ni korisnička baza. Svaki naredni stress/DB test mora koristiti samo izolovanu CI/staging bazu; lokalni testovi se ne smiju usmjeravati na neprovjeren DB URL.
- Firebase nalog/tajne se ne traže niti mijenjaju. Dok korisnik ne omogući konfiguraciju u vlastitom okruženju, push dostava ostaje blokirana; možemo razvijati i testirati adapter uz mock.

## Sljedeći uski korak

Prvo implementirati P6 kao zaseban, CI-only integration stress test od 200 konkurentnih claim zahtjeva nad izolovanom bazom: tačno jedan uspjeh, 199 odbijanja, jedan `IN_PROGRESS`, jedan `CLAIMED` TaskEvent i jedan OutboxEvent. Nakon zelenog testa nastaviti s trajnom OutboxEvent → Notification obradu. Ne označavati Fazu 5 završenom dok P4–P8 i kanali/isporuke iz plana nisu potvrđeni.
