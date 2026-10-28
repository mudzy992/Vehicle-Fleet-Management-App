# 09 — Frontend audit (web/mobile)

**Datum:** 28.10.2026
**Stanje:** u toku; ovaj izvještaj ne zatvara nalaze bez izvršenog dokaza.

## Sažetak provedenog

- Uklonjena je zastarjela plava boja browser chrome-a iz `apps/web/index.html`; `theme-color` sada prati `--bg` (`#0B0F0C`).
- Mobilne sjene više ne ponavljaju crnu vrijednost na ekranima prijave i zadataka: koriste `colors.shadow`.
- Boja rezervnog prikaza native color pickera za vrstu zadatka čita CSS `--neutral`; prilagođena boja vrste zadatka ostaje korisnički/domain podatak, ne hardkodovani UI token.
- Dodan `scripts/check-design-tokens.mjs` i `pnpm design-tokens:check`. Skripta poredi 19 parova web/mobile, provjerava 11 kombinacija WCAG AA kontrasta, `theme-color` i skenira TS/TSX UI za sirove hex boje. CI je poziva u `quality` poslu.
- Dodano je 35. Vitest provjera tokena za browser chrome. Postavljen je Playwright config i osam API-mock scenarija za autentikaciju, redirect, neispravne i uspješne prijave, odjavu, pravo pristupa vozilima i guardove budućih `/obavijesti` i `/izvjestaji` kostura. Playwright CI posao koristi Chromium i samo determinističke browser mocks; ne povezuje se s backendom, bazom niti produkcijom.
- Lokalna validacija: `design-tokens:check` PASS; web build PASS; Vitest **25 fajlova / 217 testova PASS**; web lint i typecheck PASS. `playwright test --list` učitava svih **8** scenarija.

## Web redizajn — faza 1 (temelji, 28.10.2026)

Pokrenut je odvojeni web-redizajn; mobilni UI nije mijenjan. Prvi prolaz uvodi centralne skale za spacing, tipografiju, radius, depth, motion, širinu navigacije/sadržaja i visinu kontrola; osvježava shell (sidebar, active state, header, user block, footer i responsive drawer), zajedničke button/card/table/stat primitive i dashboard hijerarhiju. Dodano je 34 provjere prisustva foundation tokena uz postojeće kolor/kontrast provjere. Lokalni web lint, typecheck, build, design-token guard i suite (25 fajlova / 251 test) prolaze.

**Ovo nije završetak potpunog redizajna.** Ne zatvara vizuelni acceptance niti potvrđuje da su svi ekrani i forme prebačeni na jedinstvene primitive. Preostaje modul-po-modul pregled i dorada auth/login, liste/detalji, forme, empty/loading/error, tabelarni responsive prikaz, pristupačnost/keyboard, tipografska i spacing konzistentnost, i Playwright vizuelni/runtime smoke. Browser/device pregled ostaje otvoren. Zadržati namjerno prazne `/obavijesti` i `/izvjestaji` kosture i postojeće permission guardove.

## Browser-run ograničenje

Playwright browser **nije pokrenut u ovom sandboxu**: `playwright install chromium` nije uspio jer browser preuzimanje sa `cdn.playwright.dev` nije dostupno u mrežnim pravilima okruženja (ECONNRESET). To nije prolaz E2E testa. CI posao je konfigurisan da instalira Chromium i izvrši testove; A-01/A-13 ostaju otvoreni dok se taj job stvarno ne izvrši uspješno. Lokalni Vite preview/HTTP 200 i `playwright --list` nisu browser-runtime dokaz.

## Inventar modula i pokrivenost

Kategorije: **model/unit** = deterministička funkcionalnost; **component** = UI komponenta/screen u Vitest-u; **browser** = Playwright runtime. „Nema direktnog testa“ je nalaz pokrivenosti, ne dokaz greške.

| Modul                     | Trenutni dokaz                                                                                                 | Status / naredni korak                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `auth`                    | Session unit/component testovi (5); novi Playwright login, redirect, logout testovi definisani, nisu pokrenuti | PARTIAL — browser CI rezultat potreban; proširiti slučajeve isteka sesije, rate-limit i `mustChangePassword` |
| `audit`                   | Nema direktnog feature testa u web suite-u                                                                     | OPEN — dodati list/detail stanja, filtere, prazne/greška stanja i dozvole                                    |
| `dashboard`               | Nema direktnog screen testa; dashboard permission/queries postoje                                              | OPEN — testirati dozvoljene/odbijene widgete, prazne i greška odgovore                                       |
| `drivers`                 | Model unit testovi (8); nema direktnog screen testa                                                            | PARTIAL — testirati PII redakciju i OWN/ALL/ID grant prikaz, list/detail/form                                |
| `forms`                   | Model, preview i field component testovi (32 ukupno)                                                           | PARTIAL — dodati browser tok kreiranja/validacije/publish; testirati keyboard/accessibility                  |
| `profile`                 | Nema direktnog feature testa                                                                                   | OPEN — testirati profil, promjenu lozinke i `mustChangePassword` tok                                         |
| `records`                 | Model testovi za vehicle records (16); nema direktnog records-list screen testa                                | PARTIAL — testirati registracije/osiguranja, datume, filtere, empty/error                                    |
| `reminders`               | Nema direktnog feature testa                                                                                   | OPEN — testirati status akcije, due-date i permission scenarije                                              |
| `roles`                   | Matrix unit testovi (6); route permission unit testovi                                                         | PARTIAL — browser scenario upravljanja pravima i read-only ponašanja                                         |
| `services`                | Edit/delete/items model/component testovi (13)                                                                 | PARTIAL — browser CRUD, konkurentna izmjena i greške API-ja                                                  |
| `system`                  | Nema direktnog health-page testa                                                                               | OPEN — health loading/error/success prikaz i ograničeni pristup                                              |
| `task-types`              | Model testovi (10); dinamički izbor boje provjeren buildom/token skenerom                                      | PARTIAL — form/page CRUD, konfigurabilne boje i keyboard test                                                |
| `tasks`                   | Model + create/detail/list/status component testovi (5)                                                        | PARTIAL — browser create/claim/status/comment i server-conflict tokovi                                       |
| `tires`                   | Set/install model testovi (16)                                                                                 | PARTIAL — screen tokovi, validity i konkurentni update                                                       |
| `users`                   | Nema direktnog feature testa                                                                                   | OPEN — browser admin CRUD, role/status guardovi                                                              |
| `vehicles`                | Model + records model testovi (30); nema direktnog list/detail screen testa                                    | PARTIAL — browser CRUD, version conflict, filter/scope prikaz                                                |
| `notifications`/`reports` | Namjerni budući kosturi; permission guards postoje. Dva Playwright scenarija definisana, još nisu pokrenuta    | SCOPE PRESERVED — ne implementirati funkcionalnost; zatvoriti guard test tek nakon browser CI PASS           |

App-shell, nav, guards, router permissions, API client i design tokens dodatno imaju direktne unit/component suite-ove. Testovi ne dokazuju vizuelnu ispravnost, fizički uređaj, backend autorizaciju niti produkcijsku sigurnost.

## Evidencija statusa / ne zatvarati unaprijed

| Nalaz                      | Trenutna odluka                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 E2E infrastruktura    | PARTIAL: web Playwright harness + CI job dodani; lokalni browser nedostupan; čekati GitHub Actions runtime rezultat i fizički uređaj UAT gdje je relevantno |
| A-03 bundle/runtime        | PARTIAL: build/lint/unit prolaze; browser console/navigation i vizuelni smoke nisu izvršeni                                                                 |
| A-05 tema                  | PARTIAL: automatizovana token/kontrast provjera prolazi; browser i fizički Android vizuelni pregled nisu izvršeni                                           |
| A-08 permission scope      | PARTIAL: raniji fokus testovi potvrđeni; ovaj frontend pregled ne obuhvata pun backend cross-module scope sweep                                             |
| A-13 logout/session revoke | E2E OPEN: scenario postoji, ali nije runtime izvršen                                                                                                        |
| Preostali audit statusi    | Ostaju nepromijenjeni iz `audit/08-status-registar.md`; ne mogu se zatvoriti ovim frontend prolazom                                                         |

**Zaključak:** prijavljene konkretne token nekonzistentnosti su ispravljene i automatizovana provjera prolazi. Modul-po-modul frontend audit je napravio eksplicitan coverage inventar, ali nije završen: navedeni testovi za module bez direktne pokrivenosti, Playwright runtime, browser vizuelna provjera, Android uređaj i nefrontend nalazi ostaju potvrđeno otvoreni.
