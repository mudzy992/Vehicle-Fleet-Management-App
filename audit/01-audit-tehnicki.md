# 01 — Tehnički audit i prioriteti

## 1. Opseg i pouzdanost

Pregledan je committed snapshot `44ecf00` na aktivnoj Arena grani, uz početni pregled root konfiguracije, CI pipeline-a, API modula, web shell-a/dizajn-sistema, Expo strukture, testne infrastrukture i ZIP referentnog dizajna. Izvršeni su build/lint/typecheck/test komande navedene u `05-testiranje-i-verifikacija.md`.

**Ovo nije završeni line-by-line security/code audit.** `06-registar-datoteka.md` sadrži 360 relevantnih source/config/test datoteka i LOC za committed snapshot. Svaka datoteka je inventarisana, ali nije označena kao ručno odobrena; modulsku provjeru treba voditi kroz fazni plan, pregledati implementaciju i testove zajedno, te bilježiti nalaz, dokaz i status zatvaranja.

## 2. Arhitektura — potvrđena struktura

- **API:** NestJS + Prisma/PostgreSQL + Redis; 16 domena/modula u `apps/api/src/modules/`, uz 56 API unit test datoteka u `apps/api/test/unit/`.
- **Web:** React/Vite, feature-moduli, zajedničke UI komponente, React Router/Query; prisutni shell/navigacija i 17 feature područja (plus placeholder stranica).
- **Mobile:** Expo Router/React Native; 13 route datoteka u `apps/mobile/app/`, zajednički source/theme u `apps/mobile/src/`; nema mobile test datoteka u inventarisanom testnom formatu.
- **Shared packages:** `shared`, `form-engine`, `form-renderer`, `config`; form-engine ima browser build upozorenje vezano za Node crypto import.
- **CI:** `.github/workflows/ci.yml` obuhvata env sync, lint/typecheck, unit, integration/stress, security, build i Docker build. Integration/stress koraci se eksplicitno preskaču kada testovi/skripte ne postoje.

## 3. Nalazi i akcije

### A-01 — Nema E2E automatizacije preko cijelog sistema — P1, potvrđeno

Pretragom repozitorija nije pronađen Playwright/Cypress/Maestro/Detox setup, `e2e/` direktorij niti API integration spec datoteka. Postoji CI korak za integration, ali on se preskače kada `apps/api/test/integration/*.spec.ts` ne postoji. Unit/component testovi sami ne dokazuju prijavu → API → baza → UI → završetak zadatka.

**Akcija:** uvesti ponovljiv web E2E runner, API integration sa stvarnim test PostgreSQL/Redis servisima i kontrolisani mobile E2E; početne tokove i kriterije prolaza definisati u `03-plan-E2E.md`. Ne blokirati ručno testiranje, ali ne označavati integraciju kao verifikovanu bez izvještaja.

### A-02 — API puni baseline blokiran generisanim Prisma clientom — P1 za CI pouzdanost, bloker okruženja

U čistom trenutnom workspace-u nema `apps/api/src/generated/prisma/client.js`. `prisma generate` traži engine/checksum sa `binaries.prisma.sh`, koji nije dostupan u ovom okruženju. Direktni API Vitest je pokrenuo 56 suiteova: 18 suiteova / 332 testa su prošli; preostalih 38 suiteova padaju prije izvršavanja testova zbog nedostajućeg generisanog clienta. API ESLint prolazi; API typecheck daje greške jer Prisma client tipovi nisu generisani.

**Interpretacija:** ovo je trenutno environment/build-gating blocker, a ne potvrđen bug u 38 suiteova. CI treba dokazati da `pnpm install` + `prisma generate` pouzdano radi u odobrenom runneru; lokalni testni rezultat ne smije se predstavljati kao puni API pass. Ne commitati generisani client kao zaobilaznicu.

### A-03 — Web produkcijski bundle upozorenja — P2, potvrđeno upozorenje; runtime uticaj treba dokazati

`vite build` uspijeva, ali prijavljuje glavni JS chunk oko 901 kB (granica upozorenja 500 kB) i externalizaciju `node:crypto` iz `packages/form-engine/dist/canonical.js` za browser kompatibilnost. Pretraga web source-a nije našla direktan poziv `contentHash`, ali paket/modul je prisutan u izgrađenom grafu.

**Akcija:** izmjeriti stvarni gzip/transfer, pregledati network waterfall i browser console, potvrditi da web ekran koji učitava form-engine ne poziva Node-only `contentHash`; razdvojiti browser/server exports ili izdvojiti lazy chunks gdje je opravdano. Ne dodavati Node polyfill na slijepo.

### A-04 — Referentni ZIP je vizuelna referenca, ne pouzdana aplikacijska osnova — P1 za scope sigurnosti

ZIP sadrži zaseban Next.js/Drizzle demo, a `MOBILE.md` opisuje plan/scaffold za Expo i navodi dodatni posao potreban prije produkcije. Njegovi modeli, demo endpointi, auth i persistence nisu dokazano kompatibilni s postojećim Nest/Prisma sistemom.

**Akcija:** prenijeti samo vizuelne principe i ponovo ih implementirati preko postojećih API ugovora i permission-aware UI-a. Ne kopirati demo backend, bazu, credential/config ili pravila autorizacije.

### A-05 — Web/mobile vizuelni jezik nije usklađen s referencom — P2, potvrđeno

ZIP cilja tamnu industrijsku podlogu, visok kontrast i lime naglaske. Postojeći mobile theme u `apps/mobile/src/lib/theme.ts` koristi svjetliji zeleno-bijeli pravac; web ima postojeći dizajn-sistem koji treba mapirati prije većih izmjena. To je UX konzistentnost, ne runtime greška.

**Akcija:** dogovoriti tokene, states, typography, spacing, dark/light policy, responsive breakpoints i accessibility prije redizajna; posebno definisati native status/navigation bar i safe-area ponašanje.

### A-06 — Mobile EAS izmjene postoje u radnom stablu i nisu auditni sadržaj — obavezna zaštita

Prije ovog rada u radnom stablu je bilo pet lokalnih mobile diffs: `apps/mobile/.gitignore` (obrisan), `app.json`, `expo-env.d.ts`, `package.json` i `pnpm-lock.yaml`. Trenutni worktree uklanja EAS project/owner i `googleServicesFile`, uklanja `eas-cli` i mijenja Expo ignore/config. Na `HEAD` je sačuvana EAS veza i konfiguracija. Ove izmjene **nisu dio ovog auditnog commita** i ne smiju se slučajno stageati.

**Akcija:** ostaviti netaknuto; prije EAS builda vlasnik projekta treba zasebno odlučiti da li su promjene namjerne. Ne vraćati ih niti ih commitati bez odvojenog dogovora. `google-services.json` i Firebase credentials nisu commitovani.

### A-07 — Integracioni testovi nedostaju, iako je CI korak definisan — P1, potvrđeno

`apps/api/test` trenutno ima `unit` i `helpers`, ali nema `integration` direktorij. CI daje poruku da se integration testovi preskaču, a stress test nema skriptu. Za task claim, transakcije, audit log i RBAC samo mockovi nisu dovoljno jaki dokaz.

**Akcija:** implementirati integration suite za PostgreSQL/Redis i concurrency testove za claim/assignment; CI mora fail-closed kada suite postoji, a skip status mora biti jasno vidljiv.

### A-08 — API completeness i permission-aware ekranima potrebna provjera po ugovoru — otvoreno, ne potvrđen bug

Web/Mobile features i API moduli postoje, ali ovaj baseline nije validirao svaki endpoint/DTO/permission par end-to-end. Potvrđeni `vehicle:view` scope `ALL` ostaje ispravan i nije nalaz. Treba provjeriti i druge grantove, filtriranje po scope-u, mutacije, export, audit zapis i UI skrivanje/prikaz akcija.

**Akcija:** napraviti permission matrix po roli, permission key i scope; testirati i API enforcement (source of truth) i UI affordance. Nikad ne zaključivati autorizaciju samo iz skrivanja dugmeta.

### A-09 — GPS i push nisu trenutni aktivni scope — potvrđeni zahtjev/ograničenje

GPS tok tek treba projektovati uz eksplicitno pokretanje taska od dodijeljenog vozača; nema praćenja vozila, fleet-wide GPS-a ni telematike. FCM je neaktivan (`FIREBASE_ENABLED=false`), zato UI/plan ne smije obećavati push obavijesti kao već implementirane.

**Akcija:** GPS je zaseban privacy-gated release; obavijesti prvo trebaju biti jasno razdvojene na in-app/email/push status.

## 4. Modularni audit — obavezna checklista

Za svaki domen/modul pregledati: controller/rute i HTTP status; DTO/schema i granice inputa; servisne poslovne invarijante; Prisma upite/indekse/transakcije; RBAC permission+scope enforcement; audit trail i PII logove; idempotency/retry; list pagination/filter/sort; frontend query/mutation/error/loading/empty state; mobile offline/retry/navigation; testove za happy path i negativne/konkurentne slučajeve.

| Domen / područje                            | API lokacija                                  | Web lokacija                                                     | Mobile lokacija                        | Stanje baseline-a                                        |
| ------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Auth, sesije i password policy              | `apps/api/src/modules/auth/`                  | `apps/web/src/features/auth/`                                    | `apps/mobile/src/` + auth routes       | Unit testovi postoje; kompletan E2E nije izvršen         |
| Users, roles, permissions                   | `users/`, `roles/`                            | `users/`, `roles/`                                               | korisnički session/permission checks   | Scope matrix nije pregledan red-po-red                   |
| Vehicles, odometer, registration, insurance | `vehicles/`, `registrations/`, `insurances/`  | `vehicles/`, `records/`                                          | screens/services                       | End-to-end CRUD i mobilni tok nisu potvrđeni             |
| Tasks, task types, attachments              | `tasks/`, `task-types/`, `attachments/`       | `tasks/`, `task-types/`                                          | task workflow/screens                  | Claim/assignment integracija nije potvrđena kroz bazu/UI |
| Services, tires, drivers                    | `services/`, `tires/`, `drivers/`             | odgovarajući feature folders                                     | mobile screens/services                | Domain scenario audit je naredna faza                    |
| Forms i migracije                           | `form-schemas/`, `form-migrations/`           | `forms/`, shared renderer                                        | shared form flow                       | Web build warning za Node crypto treba razriješiti       |
| Reminders, notifications, audit logs        | `reminders/`, `notifications/`, `audit-logs/` | `reminders/`, `audit/`                                           | in-app states                          | FCM neaktivan; provjeriti delivery/error policies        |
| Shell, design system, routing               | —                                             | `apps/web/src/app/`, `components/ui/`, `features/design-system/` | `apps/mobile/app/`, `src/lib/theme.ts` | Vizuelni drift potvrđen                                  |

Ovo je mapa pregleda, ne ocjena da je svaki modul neispravan ili bez nedostataka.

## 5. Radno stablo i scope commita

- Aktivna grana je `arena/d46d9ae6-vehicle-fleet-management-app`; lokalni HEAD je `44ecf00` nakon fast-forwarda na `origin/main` radi ZIP reference.
- Remote Arena grana bila je na `8cc68f1` prije slanja ove auditne isporuke.
- Ostaviti pet postojećih lokalnih `apps/mobile/` izmjena netaknutim i unstaged.
- Audit commit smije sadržavati samo `audit/`; push isključivo na aktivnu Arena granu.
- Ne uključivati secrets, Firebase JSON, service account, `.env` ili private key.
