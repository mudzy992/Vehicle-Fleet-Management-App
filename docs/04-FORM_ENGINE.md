# 04 — Form engine: verzionisane dinamičke forme

**Verzija:** 1.0.0 · **Paketi:** `packages/form-engine` (logika), `packages/form-renderer` (UI)
**Modul API-ja:** `form-schemas` · **Faza:** 2

> Cilj: Super Admin kreira, mijenja i objavljuje forme **bez izmjene izvornog koda**, a svaki
> zapis trajno čuva verziju forme kojom je nastao. Forme se **ne** smiju pretvoriti u programski
> jezik — ovo je zatvoren, deklarativan sistem.

---

## 1. Principi

1. **Deklarativno, ne imperativno.** Definicija je JSON podatak; nigdje se ne izvršava JavaScript.
2. **Objavljena verzija je nepromjenjiva** (DB trigger + aplikacijska provjera). Izmjena = nova verzija.
3. **Zapis je vezan za verziju, ne za formu.** `formSchemaVersionId` je obavezan na svakom zapisu.
4. **Server je autoritet.** Klijent validira radi UX-a; backend **uvijek** ponovo validira prema
   tačnoj verziji.
5. **Sistemska polja su nedodirljiva.** Dinamička polja ne mogu prepisati `id`, `status`,
   `assigneeUserId`, `createdAt`, `claimedAt`, `completedAt`, `version`, `formSchemaVersionId`
   (rezervisani ključevi, §5).
6. **Normalizovano za upite, JSONB za ostalo.** Polja potrebna za filtere/obračune mapiraju se na
   prave kolone (§7).
7. **Zatvorena lista mogućnosti.** Sve što nije izričito podržano — nije podržano (§13).

---

## 2. Struktura definicije (`FormSchemaVersion.definition`)

```jsonc
{
  "$schema": "vfm-form/1",
  "meta": {
    "title": "Pranje vozila",
    "description": "Vanjsko i unutrašnje pranje",
    "subject": "TASK",
    "language": "bs",
    "estimatedMinutes": 3,
  },
  "layout": {
    "columns": 1, // 1 | 2 (web); mobilna uvijek 1
    "sectionsCollapsible": true,
    "stickySubmit": true,
  },
  "sections": [
    {
      "key": "osnovno",
      "title": "Osnovni podaci",
      "description": null,
      "order": 1,
      "visibleWhen": null,
      "fields": [
        {
          "key": "washType",
          "type": "SINGLE_CHOICE",
          "label": "Vrsta pranja",
          "helpText": "Odaberi šta je urađeno",
          "placeholder": null,
          "required": true,
          "order": 1,
          "visibleWhen": null,
          "disabled": false,
          "optionsSource": {
            "kind": "STATIC",
            "items": [
              { "value": "EXTERNAL", "label": "Vanjsko" },
              { "value": "INTERNAL", "label": "Unutrašnje" },
              { "value": "FULL", "label": "Kompletno" },
            ],
          },
          "validation": { "minSelect": 1 },
        },
        {
          "key": "washDurationMin",
          "type": "INTEGER",
          "label": "Trajanje (min)",
          "required": false,
          "order": 2,
          "validation": { "min": 1, "max": 480 },
        },
        {
          "key": "washCost",
          "type": "MONEY",
          "label": "Trošak pranja",
          "required": false,
          "order": 3,
          "validation": { "min": 0, "max": 100000, "currency": "BAM" },
        },
        {
          "key": "photosAfter",
          "type": "PHOTO",
          "label": "Fotografije nakon pranja",
          "required": true,
          "order": 4,
          "visibleWhen": { "field": "washType", "op": "IN", "value": ["EXTERNAL", "FULL"] },
          "validation": {
            "minFiles": 1,
            "maxFiles": 4,
            "maxSizeMb": 10,
            "mimeTypes": ["image/jpeg", "image/png", "image/webp"],
          },
        },
      ],
    },
    {
      "key": "racun",
      "title": "Obračun",
      "order": 2,
      "fields": [
        {
          "key": "costPerMinute",
          "type": "COMPUTED",
          "label": "Cijena po minuti",
          "order": 1,
          "computed": {
            "expression": "if(washDurationMin > 0, round(washCost / washDurationMin, 2), 0)",
            "resultType": "DECIMAL",
            "precision": 2,
            "unit": "KM/min",
          },
          "visibleOnForm": true,
          "storeInFormData": true,
        },
      ],
    },
  ],
}
```

**Meta-shema:** `packages/form-engine/src/definition.schema.ts` (Zod). Svaki `definition` se pri
snimanju drafta validira ovom meta-shemom; bez prolaska nema ni snimanja, ni objave.

---

## 3. Katalog tipova polja (zatvorena lista)

| Tip                 | Vrijednost (JSON)                           | Validacije                                                       | Web kontrola         | Mobilna kontrola         |
| ------------------- | ------------------------------------------- | ---------------------------------------------------------------- | -------------------- | ------------------------ |
| `TEXT`              | string                                      | `minLength`, `maxLength`, `pattern` (regex whitelist), `trim`    | Input                | TextInput                |
| `TEXTAREA`          | string                                      | isto + `rows`                                                    | Textarea             | TextInput multiline      |
| `INTEGER`           | number (int)                                | `min`, `max`, `step`                                             | Input number         | TextInput numeric        |
| `DECIMAL`           | number                                      | `min`, `max`, `precision` (0–4), `step`                          | Input number         | TextInput decimal-pad    |
| `DATE`              | `"YYYY-MM-DD"`                              | `minDate`, `maxDate`, `notInFuture`, `notInPast`                 | DatePicker           | Native picker            |
| `DATETIME`          | ISO 8601 UTC                                | isto + `granularity` (minute)                                    | DateTimePicker       | Native picker            |
| `BOOLEAN`           | boolean                                     | `requiredTrue`                                                   | Switch               | Switch                   |
| `SINGLE_CHOICE`     | string                                      | `optionsSource`, `minSelect/maxSelect=1`                         | RadioGroup           | Radio lista              |
| `MULTI_CHOICE`      | string[]                                    | `minSelect`, `maxSelect`, `unique`                               | CheckboxGroup        | Checkbox lista           |
| `DROPDOWN`          | string                                      | `optionsSource`, `searchable`, `allowCustom`                     | Select (combobox)    | Bottom-sheet lista       |
| `MONEY`             | `{ amount: int(feninzi), currency: "BAM" }` | `min`, `max`, `currency` (whitelist)                             | Money input          | Money input              |
| `CURRENCY`          | string (ISO 4217)                           | whitelist (`BAM`, `EUR`)                                         | Select               | Select                   |
| `PHOTO`             | `attachmentId[]`                            | `minFiles`, `maxFiles`, `maxSizeMb`, `mimeTypes`, `requireStage` | Dropzone + kamera    | `expo-camera` + galerija |
| `FILE`              | `attachmentId[]`                            | isto + `allowedExtensions`                                       | Dropzone             | Dokument picker          |
| `REFERENCE_VEHICLE` | uuid                                        | `filterStatus`, `required`                                       | Combobox s pretragom | Pretraga + lista         |
| `REFERENCE_DRIVER`  | uuid                                        | `filterActive`, `piiScope`                                       | Combobox             | Pretraga                 |
| `REFERENCE_RECORD`  | `{ entityType, entityId }`                  | `entityType` whitelist                                           | Combobox             | Lista                    |
| `SECTION`           | — (grupa)                                   | `visibleWhen`, `order`                                           | Card/fieldset        | Sekcija                  |
| `COMPUTED`          | rezultat izraza                             | `expression`, `resultType`, `precision`, `unit`                  | Read-only tekst      | Read-only tekst          |

**Izvor opcija (`optionsSource`):**

- `STATIC` — lista u definiciji (`value`, `label`, `colorHex?`, `sortOrder?`);
- `LIST` — šifarnik iz baze (`listCode`, npr. `WORKSHOP`) → omogućava promjenu opcija bez nove
  verzije forme;
- `QUERY` — ograničeni, unaprijed definisani upit (`queryId` iz whitelist-a, npr. `ACTIVE_VEHICLES`).
  **Nikad** slobodan SQL.

---

## 4. Uslovna vidljivost (`visibleWhen`)

```jsonc
{
  "all": [
    { "field": "washType", "op": "IN", "value": ["FULL"] },
    {
      "any": [
        { "field": "washCost", "op": ">", "value": 0 },
        { "field": "hasInvoice", "op": "==", "value": true },
      ],
    },
  ],
}
```

- Operatori: `== != > >= < <= IN NOT_IN CONTAINS IS_EMPTY IS_NOT_EMPTY BETWEEN`.
- `all` / `any` / `not`, maksimalna **dubina 3**.
- Skriveno polje se **ne validira** i **ne šalje** (backend ga odbija ako stigne → `UNKNOWN_FIELD`).
- Ciklusi su zabranjeni (validacija grafa pri objavi).

---

## 5. Rezervisani ključevi (B-17/U-05 zaštita)

`fieldKey` **ne smije** biti ništa od:

```
id, code, status, priority, vehicleId, taskTypeId, createdById, assigneeUserId, claimedAt,
completedAt, completedById, cancelledAt, cancelReason, dueAt, dueDate, durationMinutes,
version, formSchemaId, formSchemaVersionId, formData, createdAt, updatedAt, deletedAt,
password, passwordHash, token, refreshToken, roles, permissions, __proto__, constructor, prototype
```

Provjera se radi pri **snimanju drafta** i pri **objavi**; kršenje → `422 RESERVED_FIELD_KEY`.
Dodatno: ključ mora zadovoljiti `^[a-z][a-zA-Z0-9_]{1,48}$` (bez tačaka i razmaka → sigurno za
JSON putanje i SQL mapiranje).

---

## 6. Izračunata polja — sigurni izrazi (bez JavaScript-a)

### 6.1 Gramatika (BNF)

```
expression  := orExpr
orExpr      := andExpr ( "||" andExpr )*
andExpr     := cmpExpr ( "&&" cmpExpr )*
cmpExpr     := addExpr ( ( "==" | "!=" | ">" | ">=" | "<" | "<=" ) addExpr )?
addExpr     := mulExpr ( ( "+" | "-" ) mulExpr )*
mulExpr     := unary   ( ( "*" | "/" | "%" ) unary )*
unary       := ( "-" | "!" )? primary
primary     := NUMBER | STRING | BOOLEAN | NULL | IDENT | funcCall | "(" expression ")"
funcCall    := IDENT "(" ( expression ( "," expression )* )? ")"
```

### 6.2 Whitelist funkcija

| Kategorija  | Funkcije                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Matematičke | `round(x, p?)`, `floor(x)`, `ceil(x)`, `abs(x)`, `min(a, b, …)`, `max(a, b, …)`, `sum(a, b, …)`, `avg(a, b, …)`, `clamp(x, lo, hi)` |
| Logičke     | `if(cond, a, b)`, `and(a, b)`, `or(a, b)`, `not(a)`, `coalesce(a, b, …)`                                                            |
| Datumske    | `daysBetween(a, b)`, `monthsBetween(a, b)`, `year(d)`, `month(d)`, `day(d)`, `addDays(d, n)`, `today()`*                            |
| Tekst       | `len(s)`, `upper(s)`, `lower(s)`, `concat(a, b, …)`                                                                                 |
| Domen       | `kmDiff(a, b)`, `fenToKm(x)`, `kmToFen(x)`, `l100km(liters, km)`                                                                    |

\* `today()` je **jedina** nedeterministička funkcija i izračunava se **na serveru** (ne na
klijentu), a rezultat se snapshot-uje u `formData` — stari zapis ostaje stabilan.

### 6.3 Limite i sigurnost

| Pravilo                         | Vrijednost                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maksimalna dužina izraza        | 500 znakova                                                                                                                                                      |
| Maksimalna dubina AST-a         | 10                                                                                                                                                               |
| Maksimalan broj čvorova         | 200                                                                                                                                                              |
| Maksimalan broj poziva funkcija | 50                                                                                                                                                               |
| Dozvoljeni tokeni               | samo iz §6.1/§6.2 (lexer odbija sve ostalo)                                                                                                                      |
| Zabranjeno                      | `eval`, `Function`, `import`, `require`, pristup objektima (`a.b` osim preko whitelist polja), indeksi nizova van `coalesce`, assignment, petlje, `;`, komentari |
| Implementacija                  | ručni lexer + Pratt parser → AST → interpreter u TypeScriptu; **nijedan** put ne koristi `eval`/`new Function`                                                   |
| Timeout                         | 10 ms po evaluaciji (prekida se i vraća `COMPUTED_TIMEOUT`)                                                                                                      |
| Determinizam                    | isti ulaz → isti izlaz; bez I/O, bez mreže, bez vremena osim `today()` (server)                                                                                  |
| Tipovi                          | `number`, `string`, `boolean`, `date`, `money`, `null`; miješanje tipova → `TYPE_ERROR` pri objavi (static check)                                                |

**Static check pri objavi:** evaluator prolazi kroz izraz s apstraktnim tipovima i odbija objavu ako
referenca nepostojeće polje, dijeli s nulom bez `if`-zaštite ili vraća tip različit od `resultType`.
Dijeljenje poljem prolazi samo ako ga u `then` grani štiti dokaz da polje nije nula: `x > 0`,
`x >= 1`, `x != 0` (ili obrnuti redoslijed, npr. `0 < x`), uključujući `&&` s drugim uslovima.
Dokaz iz `else` grane ili izvan `if`-a ne važi. Greške pri objavi: `DIVISION_BY_ZERO`,
`UNKNOWN_FIELD`, `WRONG_ARITY`, `UNKNOWN_FUNCTION`, `TYPE_ERROR`, `RESULT_TYPE_MISMATCH`.

### 6.4 Gdje se izračun izvršava

1. **Klijent (web/mobilna)** — live preview tokom unosa (isti `form-engine` paket).
2. **Server** — autoritativni izračun pri create/update; rezultat se upisuje u `formData` i, ako je
   mapiran, u normalizovanu kolonu. Ako se klijentski i serverski rezultat razlikuju → server pobjeđuje
   i piše se `WARN` audit (`COMPUTED_MISMATCH`).

---

## 7. Mapiranje na normalizovane kolone (`normalizedName`)

```jsonc
"normalizedName": [
  { "fieldKey": "odometerKm",  "column": "odometerKm",       "transform": "TO_INT" },
  { "fieldKey": "washCost",    "column": "totalCost",        "transform": "MONEY_TO_FENINZI" },
  { "fieldKey": "dueDate",     "column": "dueDate",          "transform": "TO_DATE" },
  { "fieldKey": "washType",    "column": null,               "transform": null }   // ostaje u JSONB
]
```

Pravilo: **identitet zapisa nije forma.** `internalNo`, `make`, `model` i `fuelType` vozila su strukturirani
dio API-ja, a `normalizedName` popunjava samo kolone iz whitelist-a ispod. API ih spaja u `formData` prije
validacije (P11), pa zapis i dalje nosi pun snapshot forme (implementirano u `VehiclesService`, Faza 3).

Dozvoljene kolone po entitetu (whitelist — ne može se mapirati na proizvoljnu kolonu):

| Entitet                                  | Dozvoljene kolone                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Task`                                   | `odometerKm`, `totalCost`, `fuelLiters`, `fuelAmount`, `dueDate`, `dueAt`, `priority`, `title`, `description`                  |
| `Vehicle`                                | `odometerKm`, `status`, `plateNumber`, `registrationExpiresAt`, `insuranceExpiresAt`, `nextServiceDueDate`, `nextServiceDueKm` |
| `ServiceRecord`                          | `serviceDate`, `odometerKm`, `totalCost`, `nextServiceDueDate`, `nextServiceDueKm`, `workshopName`                             |
| `RegistrationRecord` / `InsuranceRecord` | `validFrom`, `validUntil`, `costAmount`, `registrationNumber`, `policyNumber`, `insuranceCompany`                              |
| `TireInstallation`                       | `mountedAt`, `mountedOdometerKm`, `dismountedAt`, `dismountedOdometerKm`, `kmDriven`, `daysInUse`                              |

Transformacije: `TO_INT`, `TO_DECIMAL`, `TO_DATE`, `TO_DATETIME`, `TO_BOOL`, `TO_TEXT`,
`MONEY_TO_FENINZI`, `FENINZI_TO_MONEY`. Provjera tipa kolone i transformacije se radi pri objavi
(meta-check protiv Prisma šeme) → `422 NORMALIZATION_MISMATCH`.

---

## 8. Životni ciklus verzije

```
            ┌────────────┐   validate/preview   ┌────────────┐
 create ───▶│   DRAFT    │─────────────────────▶│   DRAFT    │ (uređivanje bez limita)
            └─────┬──────┘                      └─────┬──────┘
                  │ publish(changeNote obavezna)      │ delete (samo draft)
                  ▼                                   ▼
            ┌────────────┐                        (obrisan)
            │ PUBLISHED  │  ← aktivna za nove zapise (tačno jedna po FormSchema)
            └─────┬──────┘
                  │ retire (nova verzija postaje aktivna)
                  ▼
            ┌────────────┐
            │  RETIRED   │  ← i dalje se koristi za prikaz/validaciju STARIH zapisa
            └────────────┘
```

**Provjere pri objavi (sve moraju proći, inače `422` s listom):**

1. Meta-shema definicije je validna.
2. Svi `fieldKey` su jedinstveni, u dozvoljenom formatu i nisu rezervisani.
3. Sve reference u `visibleWhen`/`computed` pokazuju na postojeća polja u istoj verziji.
4. Nema ciklusa u uslovnoj vidljivosti ni u izračunima (topološki sort).
5. Svi izrazi prolaze static check (§6.4).
6. `normalizedName` kolone postoje i tipovi se poklapaju.
7. Svi tipovi polja su podržani na mobilnoj (`mobileCompatible=true`), inače se verzija može
   objaviti samo uz eksplicitnu potvrdu (`allowWebOnly=true`) i oznaku.
8. `changeNote` nije prazan (min 5 znakova).
9. Kompatibilnost s postojećim zapisima: ako se uklanja polje koje je mapirano na normalizovanu
   kolonu → zahtijeva se plan migracije (§10) ili eksplicitna potvrda.
10. `contentHash` (SHA-256 nad kanonskim JSON-om) se upisuje → detekcija bilo kakve naknadne izmjene.

**Immutabilnost:** DB trigger na `FormSchemaVersion` odbija `UPDATE` nad redom sa
`status='PUBLISHED'`/`'RETIRED'`, osim kolona `status`, `retiredAt`, `retiredById`. `DELETE` je
zabranjen za sve osim `DRAFT`.

---

## 9. Validacija zapisa prema verziji (P11)

Ulaz: `formSchemaVersionId` + `formValues`. Algoritam (u `@vfm/form-engine`, koristi ga API):

```
1. Učitaj version (keš: vfm:cache:activeform / ETag). Ako ne postoji → 404.
2. Ako version.status !== 'PUBLISHED' i zapis je NOV → 422 FORM_VERSION_NOT_PUBLISHED.
   (Za uređivanje postojećeg zapisa dozvoljen je i RETIRED.)
3. Za svaki ključ u formValues:
     - ako nije u definiciji → 422 UNKNOWN_FIELD (nema tihe prihvatljivosti)
     - ako je polje skriveno (visibleWhen=false) → 422 FIELD_NOT_VISIBLE
4. Za svako polje u definiciji:
     - ako je vidljivo i required, a vrijednost nedostaje/prazna → 422 REQUIRED
     - provjeri tip, min/max, pattern, precision, options, mime/veličinu (za PHOTO/FILE:
       provjeri da attachmentId postoji, pripada korisniku i odgovara ograničenjima)
5. Izračunaj COMPUTED polja na serveru → uporedi s klijentskim (ako je poslan) → mismatch = WARN audit
6. Normalizuj (normalizedName) → popuni kolone entiteta
7. Vrati { values, normalized, computed, errors: [] }
```

Odgovor pri grešci:

```json
{
  "error": {
    "code": "FORM_VALIDATION_FAILED",
    "message": "Podaci ne odgovaraju formi (verzija 3).",
    "details": {
      "formSchemaVersionId": "…",
      "formSchemaVersion": 3,
      "fieldErrors": [
        { "key": "photosAfter", "code": "REQUIRED", "message": "Fotografija je obavezna." },
        { "key": "washCost", "code": "MAX", "message": "Najveći dozvoljeni iznos je 1.000,00 KM." },
        {
          "key": "nepoznato",
          "code": "UNKNOWN_FIELD",
          "message": "Polje ne postoji u ovoj verziji forme."
        }
      ]
    }
  }
}
```

**Zabrana tihe reinterpretacije (§5.6 zadatka):** backend nikad ne „pogađa" vrijednost, ne
konvertuje tipove izuzev eksplicitnih transformacija iz `normalizedName`, i ne primjenjuje novu
verziju forme na stari zapis.

**Implementacija (`validateRecord`, chunk C):**

| Detalj | Ponašanje |
| --- | --- |
| Verzija | `PUBLISHED` za nove zapise; `RETIRED` samo uz `isNew: false`; `DRAFT` nikad → `FORM_VERSION_NOT_PUBLISHED` |
| Nepoznat ključ | `UNKNOWN_FIELD`; `SECTION` u `formValues` → `TYPE`; `COMPUTED` se odbacuje (računa server) |
| Skriveno polje | `FIELD_NOT_VISIBLE` samo kad nosi nepraznu vrijednost |
| Vidljivost | uslovi se evaluiraju nad **trimovanim** unosom (isto čišćenje kao kod validacije teksta) |
| Tekst | `trim` po defaultu (`trim: false` isključuje), `minLength`/`maxLength`/`pattern` |
| Brojevi | `TYPE` bez konverzije, `MIN`/`MAX`/`STEP`, `PRECISION` po `validation.precision` |
| `MONEY` | `{ amount (feninzi, cijeli broj), currency }`; `min`/`max` su u **KM**, `currency` se provjerava |
| Datumi | `DATE` = `YYYY-MM-DD`; `DATETIME` = ISO 8601 sa zonom i normalizuje se u UTC; `minDate`/`maxDate`/`notInFuture`/`notInPast` |
| Prilozi | `minFiles`/`maxFiles`/`mimeTypes`/`maxSizeMb`; uz mapu priloga i `ATTACHMENT_UNKNOWN` |
| Izračunata polja | računaju se samo kad nema grešaka unosa; klijentska vrijednost se odbacuje uz `COMPUTED_MISMATCH` (WARN) |
| Normalizacija | samo za uspješan zapis; nemoguća transformacija → izuzetak (API: `422 NORMALIZATION_MISMATCH`) |

---

## 10. Migracija historijskih zapisa (P12)

Eksplicitan, auditovan, povrativ proces. **Nikad automatski.**

```
1. POST /form-migrations  { formSchemaId, fromVersionId, toVersionId, targetEntityType, filter|entityIds, mode }
     → kreira FormMigrationJob (status=PENDING), traži permisiju `form:migrate_records`
2. POST /form-migrations/:id/preview
     → job prelazi u PREVIEW, za svaki zapis računa { before, after, errors }
     → vraća summary { total, ok, failed, skipped } + uzorak (prvih 50)
3. Super Admin pregleda preview u web UI (diff po polju, crveno = greška)
4. POST /form-migrations/:id/apply   (obavezan changeNote/reason)
     → BEGIN po batch-u (500 zapisa):
         - snapshot `before` u FormMigrationItem
         - validacija prema toVersion (isti engine kao §9)
         - UPDATE formData + formSchemaVersionId + normalizovane kolone
         - INSERT TaskEvent(FORM_MIGRATED) / AuditLog(FORM_MIGRATE)
       COMMIT
     → job = COMPLETED, summary se upisuje
5. POST /form-migrations/:id/rollback
     → vraća `before` iz FormMigrationItem za sve (ili označene) zapise,
       vraća formSchemaVersionId, piše AuditLog(FORM_MIGRATE, rollback=true)
```

**Pravila:** zapisi koji ne prolaze validaciju nove verzije se **preskaču** (`skipped`) i ostaju na
staroj verziji — nikad se ne gube podaci. Job je idempotentan (unique `(jobId, entityId)`).

**Implementacija (`FormMigrationsService`, chunk E):**

| Detalj | Ponašanje |
| --- | --- |
| Ciljevi | whitelist `MIGRATION_TARGET_ENTITIES` (`TASK`, `VEHICLE`, `SERVICE`, `REGISTRATION`, `INSURANCE`, `TIRE_INSTALLATION`, `DRIVER`, `TIRE_SET`) — samo modeli s `formData` i `formSchemaVersionId` |
| Validacija | ista `validateRecord()` kao P11, s `isNew: false` (dozvoljen `RETIRED` izvor); `DRAFT` cilj se odbija |
| Preview | `summary {total, ok, failed, skipped}` + uzorak prvih 50 zapisa (`before`/`after`/`errors`); status `PREVIEW` |
| Izbor zapisa | `entityIds[]` ili filter `{createdFrom, createdTo}`; prazno = svi zapisi na izvornoj verziji |
| Apply | batch 500 u transakciji; `FormMigrationItem` (`before` snapshot, `status=APPLIED/SKIPPED`); upis `formData`, `formSchemaVersionId`, samo whitelistovane normalizovane kolone |
| Rollback | samo `COMPLETED`; vraća `formData` i verziju iz `before`, stavke → `ROLLED_BACK` |
| Idempotentnost | `upsert` po `(jobId, entityId)` — ponovni `apply` ne duplira stavke |

---

## 11. Mobilna kompatibilnost (§5.6 zadatka)

- Mobilna aplikacija preuzima definiciju: `GET /form-schemas/:id/versions/:vid` → odgovor sadrži
  `ETag: "<contentHash>"`; klijent kešira po `contentHash` (nepromjenjivo → keš je siguran).
- Offline: keširana definicija + `formSchemaVersionId` uz lokalni unos; pri sinhronizaciji backend
  **ponovo** validira. Ako je verzija u međuvremenu povučena, backend vraća razumljivu grešku i
  klijent nudi ponovni unos — **bez** automatskog prepakivanja podataka.
- Sve mobilne kontrole moraju imati ekvivalent za svaki tip polja; ako novi tip polja nema mobilnu
  implementaciju, `mobileCompatible=false` i objava je blokirana (§8, tačka 7).

---

## 12. API i UI

### API (detalji u `07-API_SPECIFIKACIJA.md`)

```
GET    /api/v1/form-schemas                       (lista, filter subject/status)
POST   /api/v1/form-schemas                       (kreira formu + prvi DRAFT)
GET    /api/v1/form-schemas/:id                   (detalji + verzije)
POST   /api/v1/form-schemas/:id/versions          (novi DRAFT, opciono kopija postojeće)
GET    /api/v1/form-schemas/:id/versions/:vid     (definicija, ETag = contentHash)
PUT    /api/v1/form-schemas/:id/versions/:vid     (uređuje DRAFT)
DELETE /api/v1/form-schemas/:id/versions/:vid     (briše DRAFT)
POST   /api/v1/form-schemas/:id/versions/:vid/validate
POST   /api/v1/form-schemas/:id/versions/:vid/preview     (render + test podaci)
POST   /api/v1/form-schemas/:id/versions/:vid/publish     { changeNote }
POST   /api/v1/form-schemas/:id/versions/:vid/retire      { changeNote }
GET    /api/v1/form-schemas/active?subject=TASK&taskTypeId=…
GET    /api/v1/form-schemas/:id/diff?from=&to=            (strukturni diff verzija)
```

Permisije: `form:view`, `form:create`, `form:update`, `form:manage_schema`, `form:publish_version`,
`form:retire_version`, `form:migrate_records`.

### Web Form Builder (UX detalji u `06-UX_UI_DIZAJN.md` §7)

- Lijevo: paleta tipova polja (drag & drop). Sredina: canvas s sekcijama (web i „mobilni okvir"
  prekidač). Desno: svojstva odabranog polja + validacije + `visibleWhen` editor (bez pisanja JSON-a,
  ali s „prikaži JSON" za napredne).
- Donja traka: `Provjeri shemu` (10 provjera iz §8, prikaz kao checklist), `Preview`, `Uporedi s
prethodnom verzijom` (diff), `Objavi…` (modal s obaveznom bilješkom i sažetkom promjena).
- Historija verzija s autorom, datumom, bilješkom i brojem zapisa koji koriste tu verziju
  (upozorenje pri povlačenju).

---

## 13. Šta **nije** podržano (scope guard protiv feature creep-a)

| Nije podržano                                                              | Zašto                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Proizvoljan JavaScript / `eval` / korisničke funkcije                      | Sigurnost (B-17)                                                 |
| Petlje, rekurzija, `while`, liste pod-formulara s dinamičkim brojem redova | Kompleksnost; za „stavke" postoje posebne tabele (`ServiceItem`) |
| Server-side pozivi (HTTP, SQL, `QUERY` van whitelist-a)                    | Sigurnost i predvidljivost                                       |
| Promjena `status`-a/`assignee`-a/ostalih sistemskih polja kroz formu       | U-05                                                             |
| Uređivanje objavljene verzije                                              | §8                                                               |
| Validacije koje ovise o drugom korisniku/ulogama                           | Pripada RBAC-u, ne formi                                         |
| Custom widgeti bez implementacije u `form-renderer`                        | Mora postojati paritet web/mobilna                               |
| Višejezične definicije (i18n labela) u v1                                  | UI je `bs`; dodaje se u v2 ako zatreba                           |
| Formule koje upisuju u **druge** entitete                                  | Jedan zapis = jedna forma                                        |

Zahtjev koji prelazi ove granice ide kroz **change request** i procjenu, ne kroz „samo dodaj polje".

---

## 14. Primjeri verzionisanja u praksi

**Scenario:** Super Admin u septembru doda polje `fuelType` u formu registracije.

1. Otvori `registration.core` → „Nova verzija (nacrt)" → kopija verzije 2 kao verzija 3 (DRAFT).
2. Doda polje, postavi `required=false` (da stari zapisi ostanu validni), mapira na
   `RegistrationRecord.fuelType` (ako kolona postoji) ili ostavi u JSONB.
3. `Provjeri shemu` → sve zeleno. `Preview` (web + mobilni okvir).
4. `Objavi` s bilješkom „Dodato polje vrsta goriva radi izvještaja o potrošnji".
5. Verzija 2 → `RETIRED`. Nove registracije koriste verziju 3; septembarske i starije ostaju na
   verziji 2 i prikazuju se po njoj.
6. Ako vlasnik kasnije želi popuniti `fuelType` za stare zapise → kreira **FormMigrationJob** s
   preview-om (§10). Bez toga, stari zapisi jednostavno nemaju to polje.

---

## 15. Status implementacije (živi dokument)

| Dio                                               | Gdje                                                                 | Status              |
| ------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| Meta-shema definicije (§2–§5, §7)                 | `packages/form-engine/src/definition.schema.ts`                      | ✅ Faza 2 (chunk A) |
| Rezervisani ključevi i format `fieldKey` (§5)     | `packages/form-engine/src/reserved-keys.ts`                          | ✅ Faza 2 (chunk A) |
| Katalog tipova i dozvoljenih validacija (§3)      | `packages/form-engine/src/field-types.ts`                            | ✅ Faza 2 (chunk A) |
| Kanonski JSON, `contentHash`, `ETag` (§8.10, §11) | `packages/form-engine/src/canonical.ts`                              | ✅ Faza 2 (chunk A) |
| Sigurni izrazi: lexer + parser + evaluator (§6)   | `packages/form-engine/src/expression/`                               | ✅ Faza 2 (chunk B) |
| Uslovi vidljivosti (§4)                           | `packages/form-engine/src/conditions.ts`                             | ✅ Faza 2 (chunk B) |
| Validacija zapisa prema verziji (§9, P11)         | `packages/form-engine/src/record-validation.ts`                      | ✅ Faza 2 (chunk C) |
| Provjere pri objavi (§8) + strukturni diff (§12)  | `packages/form-engine/src/publish-checks.ts`, `diff.ts`              | ✅ Faza 2 (chunk D) |
| Form Builder API (§12)                            | `apps/api/src/modules/form-schemas/`                                 | ✅ Faza 2 (chunk D) |
| Headless renderer (§11/§12)                       | `packages/form-renderer/`                                            | ✅ Faza 2 (chunk F) |
| Form Builder UI (§12)                             | `apps/web/src/features/forms/`                                       | ✅ Faza 2           |
| Početne forme u seed-u                            | `apps/api/src/tools/seed-forms.ts`                                   | ✅ Faza 2 (chunk G) |
| Migracija zapisa (§10, P12)                       | `apps/api/src/modules/form-migrations/`                              | ✅ Faza 2 (chunk E) |

Napomene uz implementaciju (odstupanja i pojašnjenja):

- **Pregled u Builder-u koristi isti renderer**: tab „Pregled" zove `buildRenderModel` iz
  `@vfm/form-renderer` (isti kod koji će koristiti zapis i mobilna), pa se vidljivost, izračunata
  polja i progres ne mogu razlikovati između pregleda i stvarnog unosa.
- **Primjer iz §2 prolazi meta-shemu bez izmjena** — čuva se kao test fixture
  (`packages/form-engine/test/fixtures/wash.definition.ts`), pa svaka promjena sheme koja razbije
  dokumentovani primjer pada na testu.
- **Shema je zatvorena** (`.strict()` na svakom nivou): nepoznat ključ je greška, ne tiho ignorisanje.
- `fieldKey` je jedinstven na nivou **cijele forme** (ne samo sekcije jer se vrijednosti drže u jednom
  JSONB objektu).
- **`pattern` je ograničen**: lookaround i backreference se odbijaju (ReDoS), uz maksimalnu dužinu 200.
- `visibleWhen` dubina ≤ 3, `all`/`any` po ≤ 10 djece; operatori koji ne nose vrijednost (`IS_EMPTY`)
  odbijaju `value`, a `IN`/`BETWEEN` zahtijevaju listu.
- `COMPUTED` ne može biti `required` (računa se na serveru), a `SECTION` ne nosi vrijednost.
- Kanonizacija odbija `undefined` u nizovima, `__proto__`, `Map`/`Set`/klase i ciklične reference —
  sve što bi dalo lažno isti `contentHash` za različite definicije.
