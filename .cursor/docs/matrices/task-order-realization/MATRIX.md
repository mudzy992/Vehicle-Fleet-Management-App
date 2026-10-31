# Matrica — nalog vs realizacija

**Slug:** `task-order-realization`
**Ažurirano:** 30.10.2026.
**Izvor:** audit zadataka; `docs/03` §3.5–3.6; `docs/07` §7.7–7.9

## Dvije forme po vrsti

Svaka aktivna `TaskType` ima tačno jednu objavljenu **ORDER** (nalog) i jednu **REALIZATION** (realizacija) TASK formu.

| Uloga | Ko popunjava | Kad | Snapshot na Task |
|-------|----------------|-----|------------------|
| `ORDER` | kreator (`task:create`) | `POST /tasks` | `orderFormSchema*` + `orderFormData` |
| `REALIZATION` | izvršilac (`task:complete`) | `POST /tasks/:id/complete` | `realizationFormSchema*` + `realizationFormData` |

`FormSchema.role` je obavezan za `subject=TASK`. Unique: `(subject, taskTypeId, role)` WHERE TASK i `deletedAt` IS NULL.

## Ko šta vidi

| Ekran | ORDER | REALIZATION |
|-------|-------|-------------|
| Wizard create | unos, sva required | sakrivena |
| Detalj (svi) | read-only renderer | sakrivena dok nije complete; zatim read-only |
| Claim | samo prikaz naloga | ne |
| Complete | read-only nalog | unos, sva required |

## Validacija

| Akcija | Pravilo |
|--------|---------|
| create | puna validacija ORDER required; bez REALIZATION tijela |
| claim | bez `formData`; atomski `OPEN → IN_PROGRESS` |
| complete | puna REALIZATION validacija; `orderFormData` se ne mijenja |
| legacy | `realizationFormSchemaVersionId` IS NULL → complete koristi ORDER shemu (P10) |

Novi zadatak zahtijeva obje objavljene forme. Inače `409 FORM_VERSION_NOT_PUBLISHED`.

## Dodjela

| Mod | Ko vidi / preuzima | UI |
|-----|--------------------|----|
| `ASSIGN_DIRECT` | tačno jedan izvršilac | Direktno vozaču |
| `BROADCAST` | svi ACTIVE s `task:claim` u opsegu | Svima (ko prvi preuzme) |
| `OPEN_CLAIM` | `invitedUserIds` (obavezna lista ≥ 1) | Pozvanima |

Prazan `OPEN_CLAIM` se odbija (`400`). Default wizarda za WASH/INTERIOR/CUSTOM/HANDOVER: `BROADCAST`.

## Linked record pri complete

| `TaskType.code` | Evidencija | Rollback |
|-----------------|------------|----------|
| WASH, INTERIOR_CLEANING, CUSTOM, HANDOVER | nema | — |
| FUEL_REFILL | Task kolone `fuelLiters` / `fuelAmount` / `odometerKm` | — |
| SERVICE_VISIT, TECHNICAL_INSPECTION | `ServiceRecord` | da |
| REGISTRATION | `RegistrationRecord` | da |
| TIRE_CHANGE | `TireInstallation` mount/swap | da |

`Task.linkedRecordType` + `linkedRecordId`. Neuspjeh evidencije = cijeli complete rollback.

## Legacy

Stari zadaci: `formSchemaId`/`formData` mapirani na ORDER. Complete ostaje na ORDER shemi dok `realizationFormSchemaVersionId` nije postavljen.
