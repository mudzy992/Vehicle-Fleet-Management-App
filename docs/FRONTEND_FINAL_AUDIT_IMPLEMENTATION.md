# Frontend — završni audit i plan implementacije

**Datum pregleda:** 30.10.2026.
**Opseg:** web frontend `apps/web`; mobilni UI i backend funkcionalnosti nisu predmet ovog izvještaja.
**Status (dopunjeno 30.10.2026.):** zadaci/historija na detaljima vozila implementirani su u ovom prolazu. Funkcionalni status Izvještaja i Obavijesti iz prvog audita bio je zastario; vidi P3. Završni vizuelni pregled i ekran-po-ekran UAT i dalje nisu proglašeni završenim.

## Sažetak

1. **Izvještaji i obavijesti su funkcionalne web stranice.** Izvještaji imaju katalog, filtere i CSV; obavijesti imaju inbox, read/unread, SSE i korisničke preference. Nedostaju fazni izlazi koji nisu isto što i stranice: asinhroni export Izvještaja i Audit loga (Faza 7) te globalna admin politika tipova/primalaca obavijesti (čeka poslovnu potvrdu).
2. **„Novi zadatak“ CTA:** koristi `buttonClassName('primary', 'lg')`, a zajednička primarna varijanta direktno postavlja boje iz semantičkih button tokena. Vizuelni acceptance ostaje korisnikov završni pregled.
3. **Token kontrast nije isto što i vizuelno prihvatanje:** statička provjera računa 26 semantic foreground/background kombinacija za tamnu i eksplicitnu svijetlu temu. Primarni tekst dugmeta iznosi **14,63:1** u obje teme (WCAG AA minimum 4,5:1); skripta ne procjenjuje produkcijski browser render ni hover/focus/disabled slojeve.
4. **Rute i osnovni guardovi:** statička matrica provjerava navigacijske stavke, odgovarajuće React Router rute i permission podudaranje, uključujući guarded 404 fallback.
5. **Postojeći automatizovani dokaz:** CI `40965788687` je prošao sve poslove, uključujući Playwright **65/65**, lint/typecheck, unit/integration, security, mobile typecheck/Android export i build/Docker. Ovaj rezultat je regresijski dokaz za tadašnji commit; ne predstavlja screenshot audit svih ekrana, produkcijski UAT, niti dokaz da izvještaji/obavijesti postoje.

## Obuhvaćene matrice

### A. Navigacija, ruta i ovlaštenje

Izvorna matrica je `apps/web/src/app/nav.ts` + `apps/web/src/app/router.tsx`. `scripts/check-frontend-route-matrix.mjs` provjerava svaku `NAV_ITEMS` stavku prema ruti i poredi permission string, te posebno potvrđuje da su `/obavijesti` i `/izvjestaji` implementirane stranice s guardovima.

| Oblast | Ruta/e | Trenutni status | Šta treba potvrditi prije prihvatanja |
|---|---|---|---|
| Operativa | `/nadzorna-tabla`, `/rokovi`, `/zadaci`, `/zadaci/novi`, `/zadaci/:taskId` | Implementirano; dashboard/rokovi/zadaci imaju automatizovane tokove | Pregled svih permission varijanti, prazno/loading/error/populated, tabovi i akcije na desktopu i telefonu |
| Vozni park | `/vozila`, `/vozila/novo`, `/vozila/:vehicleId`, `/vozila/:vehicleId/izmjena`, `/registracije`, `/osiguranja`, `/gume` | Implementirano; više Playwright scenarija i konflikt/retry regresija | Cjelovit prolaz kroz detalje, filtere/paginaciju, upload/priloge, sve tabove i tabele; vizuelni pregled |
| Vozači | `/vozaci`, `/vozaci/novi`, `/vozaci/:driverId` | Implementirano | Provjeriti PII maskiranje, read-only i permission stanja u svakom viewportu |
| Konfiguracija | `/forme`, `/vrste-zadataka`, `/administracija/korisnici`, `/administracija/prava` | Implementirano; neki tokovi imaju browser E2E | CRUD/validacija/greške/prava; matrica prava i široke tabele uz tastaturu/zoom |
| Sistem | `/audit-log`, `/profil`, `/zdravlje`, `/dizajn-sistem` | Implementirano | Ekran-po-ekran vizuelni prolaz, responsive i poruke grešaka; audit security-hidden stanje |
| Obavijesti | `/obavijesti` | Inbox, SSE, read/unread i self-service preferences; `notification:view` guard | Globalna admin politika tipova/primalaca čeka poslovnu potvrdu; vizuelni UAT |
| Izvještaji | `/izvjestaji` | Katalog, filteri, rezultati i CSV; `report:view` guard | Faza 7 PDF/Excel asinhroni export nedostaje; vizuelni UAT |

### B. Dizajn tokeni i kontrast

Novi `scripts/check-frontend-contrast.mjs` provjerava za obje teme: primarni CTA tekst/podlogu, glavni i sekundarni tekst na pozadinama/površinama, primarni link/akcent, te semantičke statusne boje. Postojeći `scripts/check-design-tokens.mjs` dodatno provjerava web/mobile token paritet, Tailwind skale, sirove UI hex vrijednosti i definisani set AA kombinacija.

| Stavka | Dokaz / nalaz | Odluka za implementaciju |
|---|---|---|
| Primary CTA kontrast (dark/light) | 14,63:1 / 14,63:1; obje vrijednosti prolaze AA za obični tekst | Ne mijenjati token samo na osnovu pretpostavke; pregledati stvarni ekran i hover/focus/disabled slojeve |
| „Novi zadatak“ | Koristi `buttonClassName('primary', 'lg')` i semantičke button tokene | Statičke provjere prolaze; korisnikov vizuelni pregled ostaje release acceptance |
| Tamna/svijetla tema | Statički token parovi provjereni | Ručno provjeriti kompletan ekran po temi samo ako je svijetla tema izložena korisnicima |
| Fokus/disabled/hover | Statičke token vrijednosti ne dokazuju stvarni composited contrast ili vidljivost na pozadini | Dodati browser test computed stilova i vizuelni pregled ključnih stanja; osigurati vidljiv focus ring i disabled label |
| Statusi | Tokeni za success/info/warning/danger provjereni na propisanim soft pozadinama | Na svakom ekraniku provjeriti i tekst/ikonu/status label; ne prenositi značenje samo bojom |

### C. Pokrivenost funkcionalnih stanja

Prije konačne potvrde proći svaku aktivnu stranicu kroz ovu zajedničku matricu. Postojeći testovi pokrivaju dio kombinacija, ali nijedan pojedinačni uspješan CI run ne dokazuje sve kombinacije ispod.

| Dimenzija | Minimalni slučajevi | Prihvatni dokaz |
|---|---|---|
| Pristup | dozvoljeno, bez permissiona, direktni deep-link, refresh nakon isteka sesije | E2E API mocks + assertion da nema nedozvoljenog upita; backend auth se zasebno audituje |
| Podaci | učitavanje, prazno, jedan red, više stranica, dug tekst | Browser assertion + screenshot na 390px i desktopu |
| Greške | mrežna greška, 401/403, validacijski 422, domen-konflikt 409 | Sačuvan unos, razumljiva poruka, nema duple akcije; test specifičan za svaku akciju |
| Akcije | create/update/archive/status/claim/retry gdje postoje | payload, invalidacija/refetch, navigacija i permission gating |
| Responsive | 390px, tablet oko 768px, desktop 1440px; bez horizontalnog overflowa stranice | Playwright viewport test, fokusabilno skrolanje samo za široke tabele |
| Tastatura/pristupačnost | Tab redoslijed, Enter/Space, Escape za dialog/drawer, fokus vidljiv, labeli | Playwright + axe scan; ručni screen-reader prolaz za ključne tokove |
| Izgled | hijerarhija, tekst/pozadina, CTA, statusi, ikone, spacing, dugački nazivi | Korisnikov vizuelni pregled produkcijskog prikaza; automatizacija ne može zamijeniti ovaj korak |

## Prioritetni plan implementacije

### P0 — primarna akcija zadataka (implementirano; vizuelni acceptance ostaje)

- U `tasks-page.tsx` prebaciti „Novi zadatak“ na zajednički stil/primitive bez mijenjanja routea ili `task:create` uslova.
- Zadržati kontrastne semantičke tokene; izabrati hover/active/focus/disabled ponašanje koje je usklađeno s ostalim primarnim akcijama.
- Dodati test da CTA postoji samo uz `task:create`, vodi na `/zadaci/novi`, ima accessible name i ne stvara overflow na 390px.
- Pokrenuti route matrix, contrast matrix, web lint/typecheck/unit/build i Playwright/axe test.
- Korisnik potvrđuje konačni vizuelni izgled; ne označavati kontrastni nalaz zatvorenim samo na osnovu izračuna.

### P1 — zatvoriti aktivne web stranice ekran-po-ekran

- Napraviti eksplicitnu checklistu po svim aktivnim rutama iz matrice A i po dimenzijama iz matrice C.
- Dodati nedostajuće Playwright testove tamo gdje nema dokazive permission/empty/error/responsive pokrivenosti. Ne koristiti produkcijski backend: E2E ostaje deterministički mock ili izolovani test servis.
- Na svim ekranima zamijeniti osamostaljene primarne akcije neusklađenim lokalnim klasama zajedničkim komponentama/tokenskim pravilima, uz očuvanje namjenskih akcijskih boja i postojećeg UX-a.
- Pregledati table overflow, sticky/focus ponašanje, dialoge, toastove, form greške i tipografiju na ciljanim širinama.

### P2 — dodatni accessibility/browser kvalitet

- Proširiti axe testove sa trenutno pokrivenih ključnih ruta na svaku aktivnu stranicu i važne permission/state varijante.
- Dodati viewport smoke za 390/768/1440px, `document.documentElement.scrollWidth`, fokus redoslijed i computed foreground/background za primarne kontrole u normal/hover/focus/disabled stanju.
- Testovi moraju prijaviti tačan selector, token/boju, ratio, rutu i viewport; flaky screenshot ili nepostojanje lokalnog Chromiuma ne označavati kao PASS.

### P3 — fazni izlazi koji nedostaju u postojećim modulima

- **Matrica prava (Faza 3, `VEHICLE_IDS`/`DRIVER_IDS`):** `matrix-page.tsx` nudi samo `—`/`ALL`/`OWN`; `matrix.ts` normalizira ID-scope na `ALL`, pa se ne mogu birati konkretna vozila/vozači i postojeći opseg se može izgubiti pri izmjeni role. To je još otvoren web nedostatak koji je komentar UI-ja i `docs/06` već označio kao Faza 3.
- **Forme, W23 (Faza 2):** backend `/form-migrations` podržava preview/apply/rollback, ali u `apps/web/src/features/forms/` nema korisničkog toka ni rute. FormRecord izvori sada postoje, pa prvobitni razlog odgađanja više nije dovoljan.
- **Izvještaji (Faza 7):** web ekran i CSV su implementirani, ali asinhroni PDF/Excel izvoz i worker/signed download tok nisu. CSV sam po sebi ne zatvara DoD Faze 7.
- **Audit log (Faza 7):** prikaz/filteri/detalji postoje, ali planirani `POST /audit-logs/export` i web izvoz (CSV/XLSX/PDF pipeline) ne postoje.
- **Obavijesti (Faza 6):** inbox, SSE i self-service preference ekran jesu implementirani. Globalna Super Admin politika tipova/primalaca još nije dogovorena/implementirana i čeka poslovnu potvrdu (vidi `docs/FAZA5_AUDIT.md`).
- Ostale aktivne web oblasti imaju funkcionalne stranice; placeholder ruta je samo 404 fallback, ne fazni ekran.

## Nove skripte i komande

- `scripts/check-frontend-route-matrix.mjs` — statički provjerava `NAV_ITEMS` ↔ React Router rute, permission podudaranje i implementirane stranice Obavijesti/Izvještaji.
- `scripts/check-frontend-contrast.mjs` — provjerava semantic foreground/background AA parove za dark/light temu i semantičke button tokene CTA-a „Novi zadatak“.
- `scripts/audit-frontend.mjs` — orkestrator. Podrazumijevano izvršava statičke matrice; `--ci` dodatno pokreće lint, typecheck, Vitest, produkcijski web build i Playwright Chromium/axe runtime.

```bash
pnpm audit:frontend       # brze statičke matrice
pnpm audit:frontend:ci    # sve lokalne frontend kapije, uključujući browser runtime
```

`audit:frontend:ci` zahtijeva instalirane workspace zavisnosti i Playwright Chromium. Ne koristi produkcijsku bazu/servise. Lokalni browser nedostupnost je **BLOCKED**, nikad PASS; GitHub CI rezultat navesti sa run ID-jem/commitom.

## Kriteriji zatvaranja

Frontend se može označiti spremnim za release tek kada: (1) P0 CTA izgled potvrdi korisnik; (2) sve aktivne web rute imaju popunjenu matrice C sa dokazom; (3) route/permission, kontrast, lint, typecheck, unit, production build i Playwright/axe kapije prolaze na aktuelnom commitu; (4) nema otvorenih ozbiljnih vizuelnih, pristupačnih ili responsive nalaza; (5) korisnik potvrdi svoj završni vizuelni pregled. Izvještaji i obavijesti su funkcionalni; PDF/Excel export i globalna admin politika obavijesti ostaju odvojeni fazni nedostaci.
