# Frontend — završni audit i plan implementacije

**Datum pregleda:** 30.10.2026.
**Opseg:** web frontend `apps/web`; mobilni UI i backend funkcionalnosti nisu predmet ovog izvještaja.
**Status:** automatizovane kapije imaju raniji uspješan CI dokaz; završna vizuelna i ekran-po-ekran potvrda još nije potpuna. Ovaj dokument je plan implementacije i provjere, a ne tvrdnja da je frontend konačno prihvaćen.

## Sažetak

1. **Izvještaji i obavijesti nisu implementirani kao funkcionalni moduli.** Rute postoje kao placeholderi i imaju `report:view` odnosno `notification:view` guardove. Prema važećoj odluci, ostaju budući fazni kosturi; ovaj audit ih ne pretvara u funkcionalnosti niti uklanja njihove guardove.
2. **Poznati UI nedostatak — „Novi zadatak“:** link na `/zadaci/novi` u `apps/web/src/features/tasks/tasks-page.tsx` ručno ponavlja osnovne klase umjesto zajedničkog `Button` primitiva. Ima semantičke primary boje, ali odstupa od zajedničkog radiusa/weighta/ponašanja. Korisnik je posebno prijavio da kontrast/izgled dugmeta nije zadovoljavajući. Predloženo je usklađivanje primitiva i provjera u svim interaktivnim stanjima, ne nasumično mijenjanje boja.
3. **Token kontrast nije isto što i vizuelno prihvatanje:** statička provjera računa 24 semantic foreground/background kombinacije za tamnu i eksplicitnu svijetlu temu. Primarni tekst na dugmetu iznosi tamna **14,63:1**, svijetla **4,92:1** (WCAG AA minimum 4,5:1). Ovo ne pobija korisnikov vizuelni nalaz: skripta ne procjenjuje ukus, percepciju, kompoziciju, efekt opacity/hover na konkretnom ekranu niti produkcijski browser render.
4. **Rute i osnovni guardovi:** statička matrica provjerava navigacijske stavke, odgovarajuće React Router rute i permission podudaranje, uključujući buduće placeholder rute.
5. **Postojeći automatizovani dokaz:** CI `40965788687` je prošao sve poslove, uključujući Playwright **65/65**, lint/typecheck, unit/integration, security, mobile typecheck/Android export i build/Docker. Ovaj rezultat je regresijski dokaz za tadašnji commit; ne predstavlja screenshot audit svih ekrana, produkcijski UAT, niti dokaz da izvještaji/obavijesti postoje.

## Obuhvaćene matrice

### A. Navigacija, ruta i ovlaštenje

Izvorna matrica je `apps/web/src/app/nav.ts` + `apps/web/src/app/router.tsx`. Novi `scripts/check-frontend-route-matrix.mjs` provjerava svaku `NAV_ITEMS` stavku prema ruti i poredi permission string, te posebno potvrđuje da su `/obavijesti` i `/izvjestaji` placeholderi sa guardovima.

| Oblast | Ruta/e | Trenutni status | Šta treba potvrditi prije prihvatanja |
|---|---|---|---|
| Operativa | `/nadzorna-tabla`, `/rokovi`, `/zadaci`, `/zadaci/novi`, `/zadaci/:taskId` | Implementirano; dashboard/rokovi/zadaci imaju automatizovane tokove | Pregled svih permission varijanti, prazno/loading/error/populated, tabovi i akcije na desktopu i telefonu |
| Vozni park | `/vozila`, `/vozila/novo`, `/vozila/:vehicleId`, `/vozila/:vehicleId/izmjena`, `/registracije`, `/osiguranja`, `/gume` | Implementirano; više Playwright scenarija i konflikt/retry regresija | Cjelovit prolaz kroz detalje, filtere/paginaciju, upload/priloge, sve tabove i tabele; vizuelni pregled |
| Vozači | `/vozaci`, `/vozaci/novi`, `/vozaci/:driverId` | Implementirano | Provjeriti PII maskiranje, read-only i permission stanja u svakom viewportu |
| Konfiguracija | `/forme`, `/vrste-zadataka`, `/administracija/korisnici`, `/administracija/prava` | Implementirano; neki tokovi imaju browser E2E | CRUD/validacija/greške/prava; matrica prava i široke tabele uz tastaturu/zoom |
| Sistem | `/audit-log`, `/profil`, `/zdravlje`, `/dizajn-sistem` | Implementirano | Ekran-po-ekran vizuelni prolaz, responsive i poruke grešaka; audit security-hidden stanje |
| Obavijesti | `/obavijesti` | **Placeholder**, `notification:view` guard | Zadržati kostur i guard; funkcionalnost samo nakon promjene faznog scopea/odobrenja |
| Izvještaji | `/izvjestaji` | **Placeholder**, `report:view` guard | Zadržati kostur i guard; funkcionalnost samo nakon promjene faznog scopea/odobrenja |

### B. Dizajn tokeni i kontrast

Novi `scripts/check-frontend-contrast.mjs` provjerava za obje teme: primarni CTA tekst/podlogu, glavni i sekundarni tekst na pozadinama/površinama, primarni link/akcent, te semantičke statusne boje. Postojeći `scripts/check-design-tokens.mjs` dodatno provjerava web/mobile token paritet, Tailwind skale, sirove UI hex vrijednosti i definisani set AA kombinacija.

| Stavka | Dokaz / nalaz | Odluka za implementaciju |
|---|---|---|
| Primary CTA kontrast (dark/light) | 14,63:1 / 4,92:1; obje vrijednosti prolaze AA za obični tekst | Ne mijenjati token samo na osnovu pretpostavke; pregledati stvarni ekran i hover/focus/disabled slojeve |
| „Novi zadatak“ | Koristi `--primary` + `--primary-fg`, ali ima zasebne klase i `hover:opacity-90`; ne koristi zajednički `Button` primitive | Uskladiti s istom semantikom/visinom/radiusom/weightom kao druge primarne akcije; dodati ciljanu test provjeru i zatražiti vizuelnu potvrdu |
| Tamna/svijetla tema | Statički token parovi provjereni | Ručno provjeriti kompletan ekran po temi samo ako je svijetla tema izložena korisnicima |
| Fokus/disabled/hover | Statičke token vrijednosti ne dokazuju stvarni composited contrast ili vidljivost na pozadini | Dodati browser test computed stilova i vizuelni pregled ključnih stanja; osigurati vidljiv focus ring i disabled label |
| Statusi | Tokeni za success/info/warning/danger provjereni na propisanim soft pozadinama | Na svakom ekraniku provjeriti i tekst/ikonu/status label; ne prenositi značenje samo bojom |

### C. Pokrivenost funkcionalnih stanja

Prije konačne potvrde proći svaku aktivnu stranicu (bez budućih placeholder funkcija) kroz ovu zajedničku matricu. Postojeći testovi pokrivaju dio kombinacija, ali nijedan pojedinačni uspješan CI run ne dokazuje sve kombinacije ispod.

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

### P0 — popraviti uočenu primarnu akciju zadataka

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

### P3 — budući moduli samo uz izmjenu scopea

- **Izvještaji:** sada nema stvarne report stranice, upita, filtera ni PDF/Excel exporta; ruta je Faza 7 placeholder. Za funkcionalnu implementaciju traži se zasebna odluka o sadržaju/kolonama, izvorima podataka, scope pravilima, formatima izvoza i dozvoli `report:view`.
- **Obavijesti:** sada nema web inboxa/postavki uživo na ovoj ruti; placeholder je guarded. Za implementaciju traži se odluka o inboxu/SSE, read/unread, postavkama, preferencama, permissionima i FCM granici. Postojeći backend/API ne znači da je frontend funkcija završena.
- Dok se scope eksplicitno ne promijeni, obje rute ostaju kosturi; ne uklanjati navigaciju/permission guardove i ne dodavati „lažne“ funkcionalne kontrole.

## Nove skripte i komande

- `scripts/check-frontend-route-matrix.mjs` — statički provjerava `NAV_ITEMS` ↔ React Router rute, permission podudaranje i buduće guarded placeholdere.
- `scripts/check-frontend-contrast.mjs` — provjerava semantic foreground/background AA parove za dark/light temu i posebno izvještava o ručno stilizovanom CTA-u „Novi zadatak“.
- `scripts/audit-frontend.mjs` — orkestrator. Podrazumijevano izvršava statičke matrice; `--ci` dodatno pokreće lint, typecheck, Vitest, produkcijski web build i Playwright Chromium/axe runtime.

```bash
pnpm audit:frontend       # brze statičke matrice
pnpm audit:frontend:ci    # sve lokalne frontend kapije, uključujući browser runtime
```

`audit:frontend:ci` zahtijeva instalirane workspace zavisnosti i Playwright Chromium. Ne koristi produkcijsku bazu/servise. Lokalni browser nedostupnost je **BLOCKED**, nikad PASS; GitHub CI rezultat navesti sa run ID-jem/commitom.

## Kriteriji zatvaranja

Frontend se može označiti spremnim za release tek kada: (1) P0 CTA izgled potvrdi korisnik; (2) sve aktivne web rute imaju popunjenu matrice C sa dokazom; (3) route/permission, kontrast, lint, typecheck, unit, production build i Playwright/axe kapije prolaze na aktuelnom commitu; (4) nema otvorenih ozbiljnih vizuelnih, pristupačnih ili responsive nalaza; (5) korisnik potvrdi svoj završni vizuelni pregled. Izvještaji i obavijesti ostaju izvan DoD-a ovog web prolaza dok se fazni scope ne promijeni.
