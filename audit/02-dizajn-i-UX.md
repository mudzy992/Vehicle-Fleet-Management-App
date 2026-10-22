# 02 — UX/UI audit i referentni dizajn

## 1. Referentni ZIP — šta jeste, a šta nije

`vehicle-fleet-management-application.zip` je arhiva od 89 stavki, približno 273 kB. Pregledani su CSS, shell, dashboard, mobilna landing ruta i `MOBILE.md`.

- **Vizuelna referenca:** tamna industrijska površina, lime akcent, jasna hijerarhija, naglašeni statusi, dashboard/operativni fokus i responsivni raspored.
- **Nije native Expo aplikacija:** mobilna landing ruta je Next.js web ekran, a `MOBILE.md` je uputa/scaffold za zaseban Expo klijent. U arhivi nema gotovog native mobile flow-a koji se može prekopirati.
- **Nije backend referenca:** ZIP koristi zasebnu Next.js/Drizzle demo arhitekturu. Demo endpointi, data model, auth i security nisu provjereni za produkcijsku primjenu niti su zamjena za postojeći NestJS/Prisma API.

Zato se preuzima samo vizuelni pravac i produktne ideje koje korisnik odobri. Routing, session, RBAC, validacija, API, audit, persistence i upload ostaju na postojećoj sigurnoj platformi.

## 2. Potvrđene UX razlike i rizici

1. **Web/mobile vizuelni drift:** `apps/mobile/src/lib/theme.ts` je zeleno-bijel, dok ZIP koristi tamnu podlogu s lime akcentima. Web dizajn-sistem već postoji; prije velikog redizajna treba napraviti token mapping umjesto lokalnog override-a po ekranu.
2. **Native nije web u malom:** safe-area, status bar, touch target, tastatura, offline, gesture/back, permission prompts i kamera/QR traže zasebne RN komponente i interakcije.
3. **Task tok mora biti akcijski:** vozač treba odmah vidjeti zadatak, vozilo, lokaciju/opis, rok, checkliste i primarnu radnju; detalji sekundarni. Administratorski ekran treba dati pregled i brze filtere, ali ne sakriti permission/API validaciju.
4. **Statusi nisu samo boja:** svaki status mora imati tekst/ikonu, accessibility label i kontrast; ne oslanjati se samo na lime/amber/red.
5. **Stanja ekranâ:** svaki list/detail/form ekran treba imati loading, empty, error, retry, success i permission-denied state, plus pagination/filter state gdje važi.
6. **Veliki bundle:** web build generiše oko 901 kB JS chunk. Prije redizajna izbjegavati dodavanje chart/animation biblioteka bez lazy load i bundle budget-a.

Ove stavke su početna UX procjena; ne znače da je svaki ekran već detaljno pregledan na stvarnom telefonu ili sa korisnicima.

## 3. Predloženi design system

### Tokeni

- `surface`: glavna pozadina, sekundarna površina i podignuta kartica (tamno, ali ne crno na crno).
- `text`: primarni, sekundarni, disabled; kontrast testirati po WCAG 2.2 AA gdje je primjenjivo.
- `accent`: lime samo za primarnu radnju/aktivno stanje, ne za sav tekst i sve površine.
- `status`: success, warning, danger, info; svaki ima tekst/ikonu i tamnu/svijetlu varijantu.
- `border`, `focus`, `overlay`, `scrim`, `shadow`; izbjegavati custom hex u feature komponentama.
- Type scale, spacing (4/8 px grid), radius, elevation, animation duration/easing i reduced-motion policy.

### Komponente i stanja

- Button: primary/secondary/tertiary/destructive/loading/disabled.
- Status badge + task card + vehicle identity block.
- Filter chips, searchable selector, date/driver/vehicle picker.
- Data table za desktop; stacked cards/list rows za narrow viewport.
- Form field sa hint/error/help, optional marker, unsaved state i validation summary.
- Empty/error/offline/retry components s lokalizovanim copy tekstom.
- Native tab bar, safe-area header, bottom sheet, camera/QR scanner permission/error state.

### Responsive pravila

- Web: desktop operativni prikaz i tabela; na tablet/mobile kolone se slažu ili prelaze u kartice, toolbar se wrap-a, drawer se pretvara u sheet.
- Native: thumb-first, primarne akcije pri dnu, minimalno horizontalnog skrolanja; list/detail navigacija ostaje predvidiva.
- Touch target cilj najmanje 44×44 pt/px ekvivalent, fokus tastature vidljiv, redoslijed tab-a semantičan.
- Ne koristiti hover kao jedini način otkrivanja akcije; testirati zoom i dugačke nazive vozila/vozača.

## 4. Odobrene produktne dopune — još planirane

- Brzi šabloni za ponavljajuće tipove zadataka.
- Administratorska tabla: dostupni / u toku / završeni zadaci.
- QR skeniranje vozila i siguran fallback ručnim izborom.
- Opcionalne checklist stavke i fotografije završetka, sa upload limitima i jasnim razlogom za svaki permission prompt.
- Operativna matrica vozilo / zadatak / status / vozač; opterećenje vozača; rokovi i čekanje; izvještaji.
- Mobile tok mora ostati brz i offline/network-aware; podaci se sinhronizuju preko postojećeg API ugovora.

## 5. UX acceptance kriteriji prije release-a

- Web: zadatak može biti pronađen, kreiran/dodijeljen, otvoren, filtriran i završen bez horizontalnog overflow-a na ciljanim viewportima.
- Mobile: najčešći vozački tok je ostvariv jednom rukom; jasni loading/retry/offline states; nema Android `localhost` URL-a; API koristi javni environment URL.
- Vizuelni jezik je konzistentan kroz auth, dashboard, task, vehicle i settings, uz native platform konvencije.
- Tastatura/screen reader: accessible name, focus order, modal announcement, touch targets i status bez same boje.
- Reduced motion, slabija mreža, permission denied i large text su provjereni.
- UI test ne zamjenjuje API autorizaciju; API mora i dalje odbiti nedozvoljenu mutaciju.
