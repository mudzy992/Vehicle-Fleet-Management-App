# Web UI standard, obrasci i obavijesti

## Opseg

Implementacija je ograničena na web aplikaciju. Mobilna aplikacija i produkcijski podaci/servisi nisu mijenjani. `/izvjestaji` ostaje namjerni `report:view` placeholder; nije proširivan izvan traženog opsega.

## Jedinstveni standard stilova

- Semantičke boje dolaze iz CSS tokena i Tailwind semantičkih aliasa; CSS sirove boje smiju postojati samo kao vrijednosti CSS tokena u `apps/web/src/styles/globals.css`.
- Dark/light kontrast provjerava se posebnom WCAG AA matricom. Primarne akcije koriste zajedničku `Button` komponentu.
- Razmaci, tipografija i dimenzije u TSX-u koriste postojeću skalu/alias; arbitrary-value Tailwind klase i direktne Tailwind palete su zabranjene.
- Inline `style` je zabranjen u web aplikaciji, osim galerije dizajn tokena koja prikazuje vrijednosti postojećih tokena. CSS ostaje centralizovan u `globals.css`; CSS komponente koriste imenovane klase i custom properties.
- Izbor boje vrste zadatka koristi zatvorenu VFM paletu; prikaz mapira vrijednost na imenovanu klasu, ne na inline `backgroundColor`.
- `scripts/check-ui-standards.mjs` provjerava TS/TSX potrošnju stilova, CSS raw boje izvan tokena i phase metadata/render u sidebaru. Skripta je dostupna kao `pnpm ui:standards:check` i dio je CI quality posla.

Provjere za lokalni razvoj:

```bash
pnpm design-tokens:check
pnpm ui:standards:check
pnpm exec node scripts/check-frontend-route-matrix.mjs
pnpm exec node scripts/check-frontend-contrast.mjs
pnpm audit:frontend:ci
```

## Modal dijalozi

Zajednički `Modal` i `ConfirmModal` daju dialog semantiku, fokus/Tab containment i povrat fokusa, Escape, zaključavanje scrolla, zatvaranje klikom na pozadinu (isključivo kad akcija nije u toku), naslov/opis za pristupačnost i standardizovan footer. Uklonjene su browser-native `window.confirm` potvrde iz uređivanja zapisa, setova guma, vrsta zadataka i panela usluga/stavki usluge.

## Vizuelni dizajner formi

Korisnik sa `form:create` može iz UI-a otvoriti „Nova forma“, unijeti naziv, stabilni ključ, predmet i opis, te kreirati nacrt. Početni nacrt odmah se otvara u dizajneru. Bez ručnog JSON-a dizajner omogućava:

- izmjenu naziva/opisa/trajanja i web rasporeda;
- dodavanje, uklanjanje i promjenu redoslijeda sekcija/polja;
- odabir tipa polja, oznake, internog ključa i prikazivanja/čuvanja;
- statičke, list-query i lookup opcije;
- pravila validacije preko kontrola prilagođenih tipu pravila (broj, datum, tekst, checkbox, lista);
- jednostavne uslove vidljivosti, izračunata polja i mapiranja na dozvoljene standardne kolone;
- preview, provjeru zajedničkim `@vfm/form-engine` parserom, verzionisanje i postojeći workflow objave.

Interno se stanje i dalje serijalizuje prema API ugovoru; korisnički interfejs ne izlaže JSON editor.

## Obavijesti

- `/obavijesti` je funkcionalna, zaštićena rutom `notification:view`.
- Inbox prikazuje lične in-app obavijesti, sve/nepročitane filtere, straničenje, pojedinačno i grupno označavanje pročitanim prema `notification:mark_read`.
- Shell prikazuje broj nepročitanih uz link na inbox.
- SSE koristi autentifikovani API helper, parsira događaje i čuva `Last-Event-ID` za reconnect; stream se prekida pri napuštanju ekrana.
- Postavke su dostupne uz `notification:manage_preferences`; in-app i push su podesivi. E-mail je jasno označen kao neaktivan umjesto da se nudi kao funkcionalan kanal.
- API i server ostaju autoritet za identitet, scope i dozvole; klijentsko sakrivanje kontrola nije zamjena za backend autorizaciju.

## Provjera

U ovom radu su dodani unit/component testovi za modal, vizuelno dodavanje i uređivanje formi, stvaranje početnog nacrta i notification inbox/postavke.

- `pnpm audit:frontend` — prošao: design-token audit, route/permission matrica, UI standards i WCAG AA kontrast.
- Web lint, TypeScript typecheck, unit/component suite i produkcijski web build — prošli; suite: 48 test datoteka, 324 testa.
- Playwright test discovery (`playwright test --list`) — prošao, 66 browser scenarija prepoznato.
- Playwright izvršenje nije potvrđeno: lokalnom okruženju nedostaje Chromium headless binary (`chromium_headless_shell-1248`). Zato je `pnpm audit:frontend:ci` završio neuspješno na browser koraku; ovaj blocker nije tretiran kao prolaz.

Automatske provjere ne zamjenjuju korisnikov završni vizuelni acceptance u stvarnom okruženju.
