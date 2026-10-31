# Matrica — verzionisanje formi

**Slug:** `form-versioning`
**Ažurirano:** 30.10.2026.
**Izvor:** `docs/04-FORM_ENGINE.md` §8/§12, `FormSchemasService`, Form Builder UI

## Statusi verzije

| Status | Uređivanje | Objava | Brisanje | Nova verzija | Povlačenje |
|--------|------------|--------|----------|--------------|------------|
| `DRAFT` | da (`PUT` definicije) | da (`changeNote` ≥ 5) | da | da (kopija nacrta) | ne |
| `PUBLISHED` | ne (`409 FORM_VERSION_IMMUTABLE`) | ne | ne | da (`copyFromVersionId`) | samo ako **nije** aktivna |
| `RETIRED` | ne | ne | ne | da | ne |

Aktivna je tačno jedna `PUBLISHED` verzija po formi. Nova objava: stara `PUBLISHED` → `RETIRED`.
Za `subject=TASK`: unique `(taskTypeId, role)` — po vrsti postoji jedna ORDER i jedna REALIZATION forma.

## Tok izmjene (obavezni redoslijed)

1. `POST /form-schemas/:id/versions` `{ copyFromVersionId }` → `DRAFT` vN+1, definicija = kopija.
2. `PUT .../versions/:vid` `{ definition }` — dodana/uklonjena polja **moraju** biti u tijelu.
3. `POST .../publish` `{ changeNote, confirmNormalizedRemoval? }` čita **sačuvanu** definiciju nacrta.
4. `GET` verzije/`active` vraća novu definiciju; `contentHash` ≠ hash izvora ako se polja razlikuju.

Kopija bez koraka 2, pa objava, **jeste** klon — dozvoljeno. Korak 2 + 3 **ne smije** vratiti klon.

## Scenariji (E2E)

| ID | Akcija | Očekivanje | Spec |
|----|--------|------------|------|
| **FV-P9** | Nova forma → Dizajn validan → Pregled → Objavi bez bilješke → Objavi s bilješkom | 400 `VALIDATION_ERROR`; zatim `PUBLISHED`; nema Sačuvaj nacrt | `apps/web/e2e/form-publish-workflow.spec.ts` |
| **FV-COPY** | Nova verzija → ukloni/dodaj polje → Objavi **bez** Sačuvaj nacrt | PUT tijelo ≠ klon; v2 `PUBLISHED`, v1 `RETIRED` | `apps/web/e2e/form-version-copy.spec.ts` |
| **FV-IMMUTABLE** | Odabir `PUBLISHED` | Nema Sačuvaj/Obriši/Objavi; Naslov disabled; 0 PUT | `apps/web/e2e/form-version-matrix.spec.ts` |
| **FV-DELETE** | Obriši nacrt | Verzija nestaje iz tabele | isti spec |
| **FV-NOTE** | `changeNote` < 5 | 400, nacrt ostaje | isti spec |
| **FV-COMPARE** | Copy → ukloni polje → Sačuvaj → Uporedi | Diff `− polje napomena` | isti spec |
| **FV-XOR** | `POST /versions` bez xor copy/definition | 400 `VALIDATION_ERROR` | stub u copy specu (oba ili nijedno) |
| **FV-NORM** | Ukloni mapirano polje → Objavi bez potvrde → s potvrdom | UI checkbox; bez potvrde nema publish; sa `confirmNormalizedRemoval: true` objava prolazi | `forms-version-workflow.test.tsx` |

## Keš

| Resurs | Keš |
|--------|-----|
| `DRAFT` GET | `Cache-Control: no-store`; bez `304` |
| `PUBLISHED`/`RETIRED`/`active` GET | `ETag` + `private, no-cache` |

## Odbijanja

| Akcija | Uvjet | Kod |
|--------|--------|-----|
| `PUT`/`DELETE` | status ≠ `DRAFT` | `409 FORM_VERSION_IMMUTABLE` |
| `POST /versions` | ni copy ni definition (ili oba) | `400 VALIDATION_ERROR` |
| `publish` | `changeNote` < 5 (Zod) | `400 VALIDATION_ERROR` |
| `publish` | nevalidna definicija / U-16 | `422` |
| `publish` | uklonjeno mapirano polje, bez potvrde | `422 NORMALIZED_FIELD_REMOVED` |
| `publish` | isto, uz checkbox u builderu | UI šalje `confirmNormalizedRemoval: true`; objava prolazi |
| `retire` aktivne bez zamjene | nema druge `PUBLISHED` | `422` |

## Permisije

| Ruta | Permisija |
|------|-----------|
| lista / detalj / active / diff / GET verzije | `form:view` |
| `POST /form-schemas` | `form:create` |
| `POST /:id/versions` | `form:update` |
| `PUT`/`DELETE` verzije | `form:manage_schema` |
| publish | `form:publish_version` |
| retire | `form:retire_version` |

## Dokaz

| Sloj | Fajl |
|------|------|
| E2E P9 | `apps/web/e2e/form-publish-workflow.spec.ts` |
| E2E copy≠klon | `apps/web/e2e/form-version-copy.spec.ts` |
| E2E matrica akcija | `apps/web/e2e/form-version-matrix.spec.ts` |
