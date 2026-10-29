# 09 — Frontend audit (web/mobile)

**Datum:** 28.10.2026
**Stanje:** u toku; ovaj izvještaj ne zatvara nalaze bez izvršenog dokaza.

## Sažetak provedenog

- Uklonjena je zastarjela plava boja browser chrome-a iz `apps/web/index.html`; `theme-color` sada prati `--bg` (`#0B0F0C`).
- Mobilne sjene više ne ponavljaju crnu vrijednost na ekranima prijave i zadataka: koriste `colors.shadow`.
- Boja rezervnog prikaza native color pickera za vrstu zadatka čita CSS `--neutral`; prilagođena boja vrste zadatka ostaje korisnički/domain podatak, ne hardkodovani UI token.
- Dodan `scripts/check-design-tokens.mjs` i `pnpm design-tokens:check`. Skripta poredi 19 parova web/mobile, provjerava 11 kombinacija WCAG AA kontrasta i 22 Tailwind aliasa za spacing/tipografiju/leading/radius/shadow, `theme-color` i sirove hex boje. CI je poziva u `quality` poslu.
- Dodano je 35. Vitest provjera tokena za browser chrome. Postavljen je Playwright config i četrnaest API-mock scenarija za autentikaciju, redirect, neispravne i uspješne prijave, odjavu, pravo pristupa vozilima, responsive login, mobile drawer keyboard/fokus/Escape i guardove budućih `/obavijesti` i `/izvjestaji` kostura. Dodan je i `@axe-core/playwright` WCAG 2.1 A/AA scan za responsive login, dashboard, design system, autorizovane liste vozila/vozača/zadataka i otvoreni mobile drawer. Prvi browser scan otkrio je jednu grešku `color-contrast` na vozilima. Uklonjeno je nepotrebno snižavanje opacity za navigacijski meta-tekst; naknadni CI axe scan login-a, liste vozila i otvorenog drawer-a prolazi bez WCAG 2.1 A/AA prekršaja; axe provjere dashboard/design-system/driver-list također prolaze u CI, zajedno s login/vehicle/drawer scanovima. Playwright CI koristi Chromium i determinističke API mocks; ne povezuje se s backendom, bazom niti produkcijom.
- Lokalna validacija: `design-tokens:check` PASS; web build PASS; Vitest **33 fajla / 296 testova PASS**; web lint i typecheck PASS. `playwright test --list` učitava svih **14** scenarija; Playwright CI run `40777560563` za commit `3ccbeca` je prošao; lokalni Chromium nije dostupan.

## Web redizajn — faza 1 (temelji, 28.10.2026)

Pokrenut je odvojeni web-redizajn; mobilni UI nije mijenjan. Prvi prolaz uvodi centralne skale za spacing, tipografiju, radius, depth, motion, širinu navigacije/sadržaja i visinu kontrola; Tailwind spacing/type/leading/radius/shadow utilities sada su mapirani na te varijable, a CI guard provjerava svih 22 aliasa; osvježava shell (sidebar, active state, header, user block, footer i responsive drawer), zajedničke button/card/table/stat primitive i dashboard hijerarhiju. Dodano je 34 provjere prisustva foundation tokena uz postojeće kolor/kontrast provjere. Lokalni web lint, typecheck, build, design-token guard i suite (25 fajlova / 251 test) prolaze.

### Plan rada i kriteriji za završetak web-redizajna

1. **Dizajn sistem i shell — temelji završeni; širina primjene otvorena:** semantičke skale, responsive shell, primitive i token guard su implementirani; provjeriti preostale ekrane da koriste skale dosljedno.
2. **Temeljni tokovi — u toku:** login je redizajniran i CI browser/axe scan prolazi; dashboard je osvježen. Preostaje provjera svih vizuelnih stanja (pending, greška, prazno, uspjeh), permission varijanti i browser prikaza.
3. **Operativni moduli — djelimično u toku:** uveden zajednički page-heading/layout pristup za liste vozila, vozača, zadataka, formi, guma i rokova. Nije kompletna ekran-po-ekran provjera; detalji, CRUD, responsive tabele, bulk akcije, empty/error i konfliktni API odgovori ostaju.
4. **Administracija i konfiguracija — na čekanju:** forme, tipovi zadataka, korisnici/uloge, profil, audit i zdravlje; buduće `/obavijesti` i `/izvjestaji` ostaju skeletoni.
5. **Kvalitet i release acceptance — djelimično:** axe WCAG 2.1 A/AA scanovi prolaze na login-u, dashboardu, design systemu, vozilima, vozačima i draweru; preostaje širiti automatizovanu pokrivenost na ostale module. Keyboard/focus/escape i responsive smoke prolaze u Playwrightu. Logout može zadržati siguran `next` parametar, što test eksplicitno prihvata. Širiti axe i browser scenarije na module, zatim izvršiti zabilježen vizuelni browser pregled. Lint/typecheck/unit/build/CI ostaju gateovi; testovi izolovani od produkcije.

**„Gotovo” se označava tek kad** svi aktivni web moduli imaju evidentiran pregled; nema poznatih ozbiljnih UI/accessibility/responsive nedostataka; token check, lint, typecheck, testovi, produkcijski build i CI prolaze; Playwright runtime prođe; browser vizuelni smoke je dokumentovan. Pojedinačni backend ili mobilni nalazi ne zatvaraju se ovim kriterijem. Mobilna aplikacija je van ovog opsega.

**Ovo nije završetak potpunog redizajna.** Ne zatvara vizuelni acceptance niti potvrđuje da su svi ekrani i forme prebačeni na jedinstvene primitive. Preostaje modul-po-modul pregled i dorada auth/login, liste/detalji, forme, empty/loading/error, tabelarni responsive prikaz, pristupačnost/keyboard, tipografska i spacing konzistentnost, i Playwright vizuelni/runtime smoke. Browser/device pregled ostaje otvoren. Zadržati namjerno prazne `/obavijesti` i `/izvjestaji` kosture i postojeće permission guardove.

## Browser-run ograničenje

Playwright browser **nije pokrenut lokalno u ovom sandboxu**: lokalno preuzimanje Chromiuma nije uspjelo (`ECONNRESET`). GitHub Actions Playwright job je prošao u runu `40777560563` za commit `3ccbeca`; `playwright test --list` registruje 14 mocked scenarija, uključujući novi task-list scan. Axe WCAG 2.1 A/AA scanovi prolaze na login-u, dashboardu, design systemu, listama vozila/vozača/zadataka i draweru. CI browser pass ne zamjenjuje screenshot/vizuelni pregled niti fizički uređaj UAT. Lokalni Vite preview/HTTP 200 i `playwright --list` sami nisu browser-runtime dokaz.

## Inventar modula i pokrivenost

Kategorije: **model/unit** = deterministička funkcionalnost; **component** = UI komponenta/screen u Vitest-u; **browser** = Playwright runtime. „Nema direktnog testa“ je nalaz pokrivenosti, ne dokaz greške.

| Modul                     | Trenutni dokaz                                                                                                                  | Status / naredni korak                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `auth`                    | Session unit/component testovi (5); 14 Playwright mocked scenarija; logout se vraća na prijavu uz eventualni siguran `next`     | PARTIAL — dodati slučajeve isteka sesije, rate-limit i `mustChangePassword`; backend revoke nije obuhvaćen mockom |
| `audit`                   | Vitest list/filter/detail-lazy/empty/securityHidden/network-error/detail-error UI provjere (4)                                  | PARTIAL — dodati permission scenarij i Axe/browser provjeru                                                       |
| `dashboard`               | Playwright empty-data render + axe; Vitest pending/error/permission testovi (3)                                                 | PARTIAL — dodati podatke i datumske widgete te provjeru većih viewport-a                                          |
| `drivers`                 | Model unit testovi (8); list screen pending/error/filter/permission+archive (3); detail PII-redaction/category-load/archive/delete-error testovi (3); Playwright mobile empty state + axe | PARTIAL — provjeriti OWN/ALL/ID scope, create/edit forme, restore/server-conflict stanja, responsive i vizuelni browser prikaz |
| `forms`                   | Model, preview i field component testovi (32 ukupno); forms-catalog network-error UI test (1)                                   | PARTIAL — dodati browser tok kreiranja/validacije/publish; testirati keyboard/accessibility                       |
| `profile`                 | Vitest error/empty-session, revoke-error, forced password/mismatch testovi (3)                                                  | PARTIAL — dodati uspješnu promjenu lozinke/revoke i session pagination/browser provjeru                           |
| `records`                 | Model testovi za vehicle records (16); screen testovi za server filtere, pending vehicle lookup i API error (3)                 | PARTIAL — testirati insurance prikaz, datumske rokove, pagination i responsive pregled                            |
| `reminders`               | Vitest provjere za permissions, kilometarski rok, acknowledge/snooze/scan i query error (3)                                     | PARTIAL — dodati filter/pagination, mutation-conflict i Axe/browser provjeru                                      |
| `roles`                   | Matrix model/unit testovi (6); UI test pristupačne greške učitavanja (1); route permission unit testovi                          | PARTIAL — browser scenario upravljanja pravima i read-only ponašanja                                              |
| `services`                | Edit/delete/items model/component testovi (13); create form network-error UI test (1)                                           | PARTIAL — browser CRUD, konkurentna izmjena, responsive stanje i širi API/Axe pregled                             |
| `system`                  | Vitest liveness/readiness/startup success, partial-failure i outage/retry provjere (3)                                          | PARTIAL — dodati Axe/browser i permission UAT provjeru                                                            |
| `task-types`              | Model testovi (10); list network-error UI test (1); dinamički izbor boje provjeren buildom/token skenerom                       | PARTIAL — form/page CRUD, konfigurabilne boje i keyboard test                                                     |
| `tasks`                   | Model + create/detail/list/status component testovi (5); novi Playwright mobile empty-state/axe scenario čeka CI                | PARTIAL — browser create/claim/status/comment i server-conflict tokovi                                            |
| `tires`                   | Set/install model testovi (16)                                                                                                  | PARTIAL — screen tokovi, validity i konkurentni update                                                            |
| `users`                   | Vitest UI provjere za list API grešku (bez lažnog empty stanja) i archive konflikt (2)                                            | PARTIAL — browser admin CRUD, create/reset/force-logout mutations, role/status guardovi i Axe/responsive pregled   |
| `vehicles`                | Model + records testovi (30); vehicle-create and record-create form network failures (2); detail archive conflict/registration API failure (2); Playwright authorized/denied list, empty-state mobile + axe | PARTIAL — browser CRUD, edit/version conflict, record/odometer/attachment UI states i filter/scope prikaz |
| `notifications`/`reports` | Namjerni budući kosturi; permission guards postoje. Dva CI Playwright guard scenarija prolaze                                   | SCOPE PRESERVED — funkcionalnosti ostaju neimplementirane; oba permission guard E2E testa prolaze                 |

App-shell, nav, guards, router permissions, API client i design tokens dodatno imaju direktne unit/component suite-ove. Testovi ne dokazuju vizuelnu ispravnost, fizički uređaj, backend autorizaciju niti produkcijsku sigurnost.

## Evidencija statusa / ne zatvarati unaprijed

| Nalaz                      | Trenutna odluka                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-01 E2E infrastruktura    | PARTIAL: Playwright CI job `40777560563` prolazi s 14 registrovanih scenarija; lokalni Chromium i vizuelni/uređajni acceptance ostaju                                                                  |
| A-03 bundle/runtime        | PARTIAL: build/lint/unit i Playwright CI job `40777560563` prolaze; vizuelni smoke i ručni pregled nisu izvršeni                                                                                       |
| A-05 tema                  | PARTIAL: token test i axe na login/dashboard/design-system/vozila/vozači/drawer prolaze; task-list scan prolazi u Playwright CI jobu `40777560563`; širi vizuelni browser/Android pregled nije izvršen |
| A-08 permission scope      | PARTIAL: raniji fokus testovi potvrđeni; ovaj frontend pregled ne obuhvata pun backend cross-module scope sweep                                                                                        |
| A-13 logout/session revoke | PARTIAL: mocked logout scenario prolazi; backend revoke dokaz nije obuhvaćen mock testom                                                                                                               |
| Preostali audit statusi    | Ostaju nepromijenjeni iz `audit/08-status-registar.md`; ne mogu se zatvoriti ovim frontend prolazom                                                                                                    |

**Zaključak:** prijavljene konkretne token nekonzistentnosti su ispravljene i automatizovana provjera prolazi. Modul-po-modul frontend audit je napravio eksplicitan coverage inventar, ali nije završen: testovi za module bez direktne pokrivenosti, potpuna ruta-po-ruta browser provjera, vizuelni smoke, Android uređaj i nefrontend nalazi ostaju otvoreni.
