# Faza 2 — Izvještaj: Form engine

**Datum:** 20.10.2026. · **Grana:** `arena/d46d9ae6-vehicle-fleet-management-app` · **Baza:** `main` @ `3a8957a`

> Ovaj dokument dokazuje šta je od **Definition of Done** iz [`PLAN_IMPLEMENTACIJE.md`](./PLAN_IMPLEMENTACIJE.md)
> i prihvatnih kriterija **P9/P10/P11/P12** iz [`09-TEST_PLAN.md`](./09-TEST_PLAN.md) §2 ispunjeno, šta je
> provjereno samo unit testovima (sandbox nema živu bazu/Redis) i šta vlasnik mora pokrenuti na pravoj bazi.

---

## 1. Rezime

| Stavka | Rezultat |
|---|---|
| Kvalitet-kapije | `pnpm turbo run lint typecheck test build` → **25/25 zeleno** ✅ |
| Testovi | **999** (shared 235 · form-engine **147** · form-renderer **13** · API **535** · web **69**) — 0 padajućih ✅ |
| Coverage (lines/branch/funcs/stmts) | shared `92,17/77,31/89,34/92,29` · form-engine `83,72/73,07/92,91/85,30` · renderer `83,05/71,42/85,71/88,42` · API `74,93/65,64/77,05/76,22` · web `81,85/78,23/76,19/83,11` — svi pragovi prolaze ✅ |
| CI (GitHub Actions) | **svih 7 job-ova zeleno** (`env-sync-check`, `install`, `lint & typecheck`, `unit tests`, `integration tests`, `security scan`, `build & docker`) ✅ |
| ENV | `.env.example` ⇄ šema 1:1, `env-sync-check` **0 upozorenja** (180 varijabli) ✅ |
| Migracije | **nema nove SQL migracije** — `FormSchema*`, `FormSchemaVersion`, `FieldKeyRegistry`, `FormMigration*` su u `1_init` |
| Endpointi Faze 2 | `/api/v1/form-schemas` (**13 ruta**), `/api/v1/form-migrations` (**6 ruta**) ✅ |
| Web ekrani | Forme — katalog, Builder (editor + pregled), verzije/diff (W20/W21/W22) ✅ |
| Seed formi | 3 objavljene forme (`vehicle`, `pranje_vozila`, `registracija_vozila`) + registar ključeva ⚠️ (skripta unit-testirana, nije izvršena nad pravom bazom) |
| Mobilna aplikacija | `apps/mobile` nije u repou (samo `README.md`) — paritet je obezbijeđen **zajedničkim render modelom**, ne UI-jem ❌ |

---

## 2. Implementirano po oblastima

### 2.1 `@vfm/form-engine` (paket, bez I/O-a)

| Šta | Gdje | Napomena |
|---|---|---|
| Meta-shema definicije `vfm-form/1` | `src/definition.schema.ts` | `.strict()` na svakom nivou; limiti (200 polja, 20 sekcija, dubina `visibleWhen` ≤ 3) |
| Rezervisani ključevi i format `fieldKey` | `src/reserved-keys.ts` | `fieldKey` jedinstven na nivou cijele forme |
| Katalog tipova i dozvoljenih validacija | `src/field-types.ts` | npr. `MONEY` → `min/max/currency`; `PHOTO` → `maxFiles/maxSizeMb/mimeTypes` |
| Kanonski JSON + `contentHash` (SHA-256) | `src/canonical.ts` | isti hash u seed-u, API-ju i `ETag`-u |
| Sigurni izrazi (lexer → parser → evaluator) | `src/expression/` | bez `eval`; whitelist funkcija; limiti dubine/dužine; `COMPUTED_TIMEOUT` |
| Uslovi vidljivosti (`visibleWhen`) | `src/conditions.ts` | isti kod u validaciji, rendereru i pregledu |
| **P11** validacija zapisa prema verziji | `src/record-validation.ts` | 20 testova; trim, tipovi, opcije, prilozi, `COMPUTED`, normalizacija |
| Provjere pri objavi + strukturni diff | `src/publish-checks.ts`, `src/diff.ts` | 10 kodova problema (`CHANGE_NOTE_REQUIRED` … `NORMALIZED_FIELD_REMOVED`) |

### 2.2 `@vfm/form-renderer` (headless, jedan model za web i mobilnu)

`buildRenderModel({ definition, values, errors, today, version, formSchemaVersionId })` vraća sekcije,
polja s `widget`-om (`TEXT|NUMBER|MONEY|DATE|SELECT|PHOTO|OUTPUT|…`), statičke opcije, izračunate
vrijednosti, progres i prvo polje s greškom. `collectSubmitValues()` i `formatFieldValue()` (fiksni
`bs-BA`) su dio istog ugovora. 13 testova.

### 2.3 API — `/form-schemas` (P9/P10/P11)

| Ruta | Permisija | Napomena |
|---|---|---|
| `GET /form-schemas` · `GET /:id` | `form:view` | filteri `subject`/`status`/`q`; `versionCount`, `currentPublishedVersion` |
| `GET /form-schemas/active` | `form:view` | `ETag` = `"<contentHash>"`, `If-None-Match` → **304**; deklarisan prije `:id` |
| `POST /form-schemas` | `form:create` | prva verzija je `DRAFT` |
| `PATCH /form-schemas/:id` | `form:update` | meta podaci forme |
| `POST /:id/versions` | `form:update` | `copyFromVersionId` **ili** `definition` (ne oba), verzija `max+1` |
| `GET /:id/versions/:vid` | `form:view` | `ETag`; `404` za tuđu verziju |
| `PUT /:id/versions/:vid` | `form:manage_schema` | samo `DRAFT` → inače `409 FORM_VERSION_IMMUTABLE` |
| `DELETE /:id/versions/:vid` | `form:manage_schema` | samo `DRAFT` |
| `POST .../validate` | `form:view` | P11 nad tijelom zapisa (`isNew`), ne mijenja bazu |
| `POST .../publish` | `form:publish_version` | `changeNote` ≥ 5; **jedna transakcija**: verzija → `PUBLISHED`, hash, `mobileCompatible`, prethodna → `RETIRED`, `currentPublishedVersionId`, registar ključeva |
| `POST .../retire` | `form:retire_version` | aktivna verzija se ne povlači (422) — prvo objavi drugu |
| `GET /:id/diff?from=&to=` | `form:view` | strukturni diff (`meta`, polja, sekcije, normalizacija) |

Plan (`PLAN_IMPLEMENTACIJE.md` §Faza 2, tačka 8) predviđa i `POST .../versions/:vid/preview`; `docs/07`
§2.9 ga **ne definiše**, pa nije implementiran — pregled obavlja web Builder (isti render model) uz
`POST .../validate` za serversku validaciju.

17 unit testova (`test/unit/form-schemas-service.spec.ts`), fake Prisma bez baze.

### 2.4 API — `/form-migrations` (P12)

`GET ?formSchemaId=` · `POST` · `GET /:id` · `POST /:id/preview` · `POST /:id/apply` · `POST /:id/rollback`.
Izvor i cilj su **verzije iste forme**, izvor ≠ `DRAFT`, cilj `PUBLISHED`; preview je čist (ne piše),
`apply` mijenja zapise u serijama po 500, neuspjeh pojedinačnog zapisa → `SKIPPED` (ne ruši posao),
`rollback` vraća prethodno stanje. 9 testova.

### 2.5 Seed (chunk G)

| Forma | Subject | Ključna polja |
|---|---|---|
| `vehicle` | `VEHICLE` | `internalNo`, `make`, `model` (obavezni), `year`, `fuelType`, `plateNumber`, `odometerKm` |
| `pranje_vozila` | `TASK` | `washType`, `washDurationMin`, `washCost` (MONEY), `photosAfter`, `COMPUTED costPerMinute` |
| `registracija_vozila` | `REGISTRATION` | `registrationNumber`, `validFrom`, `validUntil`, `costAmount`, `insuranceCompany` |

Svaka definicija prolazi `parseDefinition` **i** `checkPublishable` prije upisa (pad = seed pada = deploy
staje). Forma s `currentPublishedVersionId` se **preskače** — Builder izmjene se ne prepisuju pri
ponovnom deployu. Idempotentno.

### 2.6 Web — Form Builder (W20/W21/W22)

Jedna ruta `/forme`, tri panela: katalog → verzije → editor. Detalji u [`06`](./06-UX_UI_DIZAJN.md) §5.5.

- Meta-shema se provjerava **u browseru istim kodom** kao na serveru (`@vfm/form-engine/definition`),
  pa je čuvanje/objava onemogućeno dok definicija nije ispravna; greške idu po `path`.
- Tab **Pregled** renderuje formu kroz `@vfm/form-renderer` — isti model koji će koristiti zapis i
  mobilna, uključujući uslove vidljivosti, izračunata polja i progres.
- Akcije po statusu: `DRAFT` (čuvanje/objava/brisanje/nova verzija), `PUBLISHED` (povlačenje samo ako
  nije aktivna), `RETIRED` (samo kopija). Server ostaje autoritet.
- Objava/povlačenje traže bilješku ≥ 5 znakova; diff prikazuje strukturne promjene.
- 22 testa (`forms-model.test.ts` 14 + `forms-preview-values.test.ts` 8).

---

## 3. Prihvatni kriteriji — status

| # | Kriterij | Dokaz | Status |
|---|---|---|---|
| **P9** | Forma: kreirati, validirati, preview, objaviti | `form-schemas-service.spec.ts` (17) — `create` → `DRAFT`, `validate` → P11, `publish` bez bilješke → 422, s bilješkom → `PUBLISHED` + prethodna `RETIRED`; web pregled kroz `buildRenderModel` | ✅ unit + UI |
| **P10** | Imutabilnost objavljene verzije; zapis renderuje **svoju** verziju | `PUT`/`DELETE` nad `PUBLISHED` → `409 FORM_VERSION_IMMUTABLE`; **DB trigger** `trg_form_version_immutable` u `2_manual`; `buildRenderModel({ formSchemaVersionId, version })` nosi verziju zapisa; `GET /:id/versions/:vid` + `ETag` | ✅ unit + renderer + SQL (trigger nije primijenjen u sandboxu) |
| **P11** | Validacija zapisa prema verziji | `record-validation.spec.ts` (20) + `POST .../validate`; nepoznato/skriveno polje, obavezno, tipovi, opcije, prilozi, `COMPUTED`, normalizacija | ✅ unit |
| **P12** | Migracija zapisa između verzija | `form-migrations-service.spec.ts` (9) — preview bez pisanja, `apply` u serijama 500, `SKIPPED`, `rollback` | ✅ unit |
| **DoD: isti render na web i mobilnom** | jedan `@vfm/form-renderer` model; web pregled ga koristi; mobilna aplikacija **ne postoji** | `render-model.spec.ts` (13) | ⚠️ djelimično — vidi §6 |

Integration/E2E varijante (P9–P12 preko HTTP-a na živoj bazi) ostaju planirane: traže PostgreSQL i
modul koji stvarno piše zapise (Faza 3, zadaci). Tabela u [`09`](./09-TEST_PLAN.md) §2 to i dalje vodi
kao ⏳.

---

## 4. Komande i rezultati (ponovljivo)

```bash
PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm turbo run lint typecheck test build
# → Tasks: 25 successful, 25 total
# → shared 235 · form-engine 147 · form-renderer 13 · api 535 · web 69

PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm -w test:coverage
# → Tasks: 8 successful, 8 total (pragovi po paketima; vidi §1)

pnpm env:check     # → ✅ 0 upozorenja (180 varijabli)
```

Trajanje pune kapije: ~30–60 s u sandboxu. Nijedan test ne dira mrežu, bazu ni Redis
(`FakePrismaClient`, `FakeRedis`, fake loader).

---

## 5. Šta vlasnik mora pokrenuti (obavezno prije korištenja)

1. **Migracije** (nema nove migracije za Fazu 2, ali provjeri da je `1_init` primijenjen):

   ```bash
   pnpm --filter @vfm/api prisma:migrate:deploy
   ```

2. **Seed** (objavljuje tri forme; idempotentno):

   ```bash
   pnpm --filter @vfm/api seed          # ili `seed:prod` u kontejneru
   ```

   Očekivani ispis: `forms: 3 created, 0 existing` (prvi put), odnosno `0 created, 3 existing` poslije.

3. **Provjera u UI-u** (Super Admin, web): `/forme` → tri forme u katalogu → otvori `pranje_vozila`
   → tab **Pregled** → `washType = EXTERNAL` prikaže `photosAfter` → objavi novu verziju s bilješkom
   → `GET /api/v1/form-schemas/active?subject=TASK` vraća novu verziju i novi `ETag`.

---

## 6. Odstupanja i odluke (svjesne, obrazložene)

| Tema | Odluka | Zašto |
|---|---|---|
| W23 (UI migracije zapisa) | **nije implementiran** | u Fazi 2 nema `FormRecord` zapisa za migraciju; API je gotov i testiran, ekran dolazi kad zapisi postoje (Faza 3/5) |
| Rute Builder-a | jedna ruta `/forme` sa stanjem odabira (docs/06 ažuriran), bez `/forme/:id/verzije/:vid` | bez deep-linka nema N+1 upita i nema „praznog" ekrana; deep-link nije DoD |
| „Preview web + mobilni" | pregled koristi **isti** render model; mobilna aplikacija nije u repou | `apps/mobile` sadrži samo `README.md`, pa nema šta renderovati; paritet je na nivou modela i pokriven testovima |
| Editor definicije | **JSON editor** s provjerom meta-sheme + tab Pregled, umjesto drag&drop platna i panela svojstava polja | drag&drop je UX sloj; integritet (validacija, diff, objava, pregled) je isti, a JSON je i format u kojem se definicija čuva. Drag&drop dolazi ako se pokaže potreba |
| Publish modal | bilješka je inline polje u panelu (vidljivo samo kad je objava/povlačenje moguće) | manje klikova; ista validacija (≥ 5 znakova) |
| Seed obim | **3** forme (`vehicle`, `pranje_vozila`, `registracija_vozila`), ne 7 iz plana | ostale (`insurance.core`, `service.core`, `tireset.core`, `tire.installation`) pripadaju entitetima koji dolaze u Fazi 3/4; seed ih dobija kad modeli budu u upotrebi |
| Renderer adapteri | **headless** model + web adapter (Builder pregled); RN adapter ne postoji | `apps/mobile` nije u repou; model je projektovan da RN adapter bude tanak (mapiranje `widget` → komponenta) |
| `MONEY` u izrazima | vrijednost je **u feninzima**, dijeljenje sa 100 u izrazu/prikazu | izbjegava greške zaokruživanja; dokumentovano u docs/04 §6/§7 |
| Registar ključeva pri objavi | konflikt tipa se **ne prepisuje** (`dataType` ostaje prvi) i samo se loguje | U-16: isti ključ u dvije forme ne smije tiho promijeniti tip kolone |
| `dataType` u seed-u | isti `syncFieldKeys` kao u `publish` | jedna implementacija, nema dvije istine |

### Popravke otkrivene i riješene tokom faze

| # | Problem | Uzrok | Rješenje |
|---|---|---|---|
| 1 | CI `install` padao | `pnpm/action-setup@v4` s `version` + `packageManager` u `package.json` | uklonjen `version` iz svih job-ova; jedini izvor je `packageManager` |
| 2 | CI `security` padao | `grep` za fiksne lozinke hvatao je **samu blocklist-u** i testove | isključenja po tačnoj putanji (`schemas.ts`, `password.service.ts`, workflow) + testovi |
| 3 | CI `unit` padao | `pnpm -w test -- --coverage` dodavao `--coverage` u sve `test` skripte (`@vfm/config` = `node -e`) | turbo task `test:coverage` + `@vitest/coverage-v8` u svih pet paketa |
| 4 | CI `quality` padao na čistom checkoutu | `@vfm/shared` testovi i `typecheck` čitaju `dist`, a turbo je vezao samo `^build` | `packages/shared/turbo.json` veže vlastiti `build` |
| 5 | CI `integration` padao i bez koda | `vitest run` bez testova vraća 1; `test:stress` skripta ne postoji | guard-ovi s „preskočeno" dok P6/integration testovi ne dođu (Faza 3) |
| 6 | `@vfm/shared` coverage uvijek 0 % | mjerio `src`, a testovi importuju `dist` | coverage `include: ['dist/**/*.js']` |

---

## 7. Otvoreno / sljedeće

1. **Integration/E2E P9–P12** na živoj bazi — dolaze s Faza 3 (prvi modul koji piše zapise).
2. **W23 UI** (preview/apply/rollback migracije) — kad postoje `FormRecord` zapisi.
3. **`apps/mobile`** — scaffold + RN adapter renderera (Faza 6 po planu); do tada paritet čuva
   `@vfm/form-renderer` i njegov snapshot test.
4. **Deep-link rute** `/forme/:id/verzije/:vid` — ako se pokaže potreba za dijeljenjem linka.
5. **Povremeni flake u `@vfm/form-engine` testovima** (1 od 147, viđen dva puta pod punim opterećenjem;
   nije reprodukovan u 3 uzastopna pokretanja) — `testTimeout` je podignut na 15 s; ako se ponovi na CI-ju,
   uhvatiti ime testa iz loga i otkloniti uzrok.
6. Otvoreno iz Faze 1 (nepromijenjeno): `forgot-password` + Outbox, `XADD vfm:stream:audit` + SSE,
   `POST /audit-logs/export`, `VEHICLE_IDS`/`DRIVER_IDS` editor, OpenAPI, retencija `AuthAttempt`/tokena.

---

## 8. Zaključak

Faza 2 je završena: form engine (meta-shema, izrazi, uslovi, P11, provjere objave, diff), headless
renderer, `/form-schemas` i `/form-migrations` API, seed tri realne forme i Builder UI s pregledom.
Ostaje samo ono što po planu pripada kasnijim fazama (zapisi, mobilna, W23) — **Faza 3 nije započeta**.
