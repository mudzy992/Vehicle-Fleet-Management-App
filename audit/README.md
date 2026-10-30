# Auditni paket — Vozni park

**Datum baseline pregleda:** 22.10.2026.<br>
**Repozitorij:** `mudzy992/Vehicle-Fleet-Management-App`<br>
**Radna grana:** `arena/d46d9ae6-vehicle-fleet-management-app`<br>
**Pregledani committed snapshot:** `44ecf00` (`Create vehicle-fleet-management-application.zip`).<br>
**Jezik dokumentacije:** bosanski.

## Svrha i granice

Ovaj direktorij objedinjuje početni tehnički/UX audit, rezultate izvršenih provjera, prijedlog E2E pokrivenosti, zaštitne uslove privatnosti lokacije, fazni plan i inventar od 360 izvornih datoteka. To je **auditni baseline i plan rada**, ne izjava da je svih 360 datoteka već pregledano red-po-red ili da je aplikacija spremna za produkciju.

Nalazi su označeni kao:

- **Potvrđeno** — direktno provjereno u repozitoriju, konfiguraciji ili komandnom rezultatu.
- **Rizik / za provjeru** — vjerovatna posljedica koju treba dokazati tokom modulske ili runtime provjere.
- **Bloker okruženja** — test nije mogao doći do aplikacijskog koda zbog nedostupne generisane zavisnosti/infrastrukture.
- **Planirano** — prihvaćena funkcionalnost, još nije implementirana niti se prikazuje kao aktivna.

## Dokumenti

1. [01 — Tehnički audit i prioriteti](01-audit-tehnicki.md)
2. [02 — UX/UI i analiza referentnog ZIP-a](02-dizajn-i-UX.md)
3. [03 — E2E scenariji i kriteriji prolaza](03-plan-E2E.md)
4. [04 — Fazni plan realizacije](04-plan-faza.md)
5. [05 — Testovi i verifikacija baseline-a](05-testiranje-i-verifikacija.md)
6. [06 — Registar datoteka](06-registar-datoteka.md)
7. [07 — GPS privatnost i acceptance kriteriji](07-gps-privatnost.md)
8. [08 — Status nalaza i odluka](08-status-registar.md)
9. [09 — Ponovljivi frontend audit](09-frontend-audit.md)
10. [10 — Web UI standard, obrasci i obavijesti](10-web-ui-standard-obavijesti-forme.md)
11. [11 — Audit mobilne aplikacije](11-mobile-audit.md) — [ekrani](11-mobile-ekrani.md), [nalazi](11-mobile-nalazi.md), [verifikacija](11-mobile-verifikacija.md)

## Sažetak baseline-a

- 98 postojećih unit/component test datoteka; nije pronađen Playwright/Cypress/Maestro E2E setup niti `apps/api/test/integration` test suite.
- 572 testa prolaze u shared/form-engine/form-renderer/web paketima; mobile TypeScript provjera, API ESLint, non-API lint/typecheck i web produkcijski build prolaze.
- Direktno pokrenut API Vitest: 18/56 test-suiteova, 332 testa prolaze; 38 suiteova ne mogu se ni učitati jer nedostaje generisani Prisma client. Prisma generisanje je blokirano preuzimanjem engine-a sa nedostupnog hosta. Ovo nije dokaz da je API regresovao, ali znači da puni API baseline u ovom okruženju nije potvrđen.
- Web build upozorava na client bundle chunk od oko 901 kB i na `node:crypto` koji je externalizovan iz browser builda; treba provjeriti stvarnu runtime putanju i podijeliti bundle.
- ZIP daje vizuelni pravac tamne industrijske podloge i lime akcenta; njegov Next/Drizzle demo i `MOBILE.md` nisu produkcijska arhitektura niti native Expo UI.
- Potvrđen permission `vehicle:view` sa scopeom `ALL` ostaje važeći; ovaj audit ga ne označava kao nedostajuću dozvolu.
- FCM nije aktivan (`FIREBASE_ENABLED=false`). GPS ostaje ograničen na eksplicitno pokrenut zadatak i konkretnog dodijeljenog vozača; nema praćenja vozila/fleet-wide lokacije ni telematike.

## Pravila rada uz ovaj paket

1. Prvo stabilizovati osnovni tok i dobiti ponovljiv testni baseline; zatim popraviti potvrđene P0/P1 probleme.
2. Prije šireg redizajna uspostaviti automatske testove preko API-ja i UI-ja.
3. Ponovo koristiti vizuelni jezik ZIP-a, ne njegov demo backend, bazu, autorizaciju ili sigurnosne odluke.
4. Ne stageati pet postojećih lokalnih izmjena u `apps/mobile/` kao dio ovog audit commita. Pogledati sekciju „radno stablo“ u tehničkom auditu.
5. Nikad ne uključivati Firebase JSON, credentials, `.env` ili private keys.
