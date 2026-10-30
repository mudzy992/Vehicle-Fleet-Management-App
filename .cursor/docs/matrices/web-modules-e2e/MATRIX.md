# Matrica — web moduli (E2E)

**Slug:** `web-modules-e2e`
**Ažurirano:** 30.10.2026.
**Izvor:** `apps/web/src/app/nav.ts`, `apps/web/src/app/router.tsx`

## Moduli

| Modul | Rute | Spec | Scenariji |
|-------|------|------|-----------|
| Auth | `/prijava` | `e2e/modules/auth.spec.ts` | AUTH-GUARD, AUTH-LOGIN, AUTH-FAIL, AUTH-LOGOUT, AUTH-DENY |
| Nadzorna tabla | `/nadzorna-tabla` | `e2e/modules/dashboard.spec.ts` | DASH-EMPTY |
| Rokovi | `/rokovi` | `e2e/modules/reminders.spec.ts` | REM-EMPTY, REM-ACTIONS, REM-DENY |
| Zadaci | `/zadaci`, `/zadaci/novi`, `/zadaci/:id` | `e2e/modules/tasks.spec.ts` | TASK-EMPTY, TASK-CLAIM, TASK-CREATE, TASK-DENY |
| Obavijesti | `/obavijesti` | `e2e/modules/notifications.spec.ts` | NOTIF-EMPTY, NOTIF-READ, NOTIF-DENY |
| Vozila | `/vozila`, `/novo`, `/:id`, `/izmjena` | `e2e/modules/vehicles.spec.ts` | VEH-EMPTY, VEH-LIST, VEH-CREATE, VEH-DENY |
| Vozači | `/vozaci`, `/novi`, `/:id` | `e2e/modules/drivers.spec.ts` | DRV-EMPTY, DRV-LIST, DRV-CREATE, DRV-DENY |
| Registracije | `/registracije` | `e2e/modules/registrations.spec.ts` | REG-EMPTY, REG-LIST, REG-DENY |
| Osiguranja | `/osiguranja` | `e2e/modules/insurance.spec.ts` | INS-EMPTY, INS-LIST, INS-DENY |
| Gume | `/gume` | `e2e/modules/tires.spec.ts` | TIRE-EMPTY, TIRE-LIST, TIRE-DENY |
| Izvještaji | `/izvjestaji` | `e2e/modules/reports.spec.ts` | REP-EMPTY, REP-EXPORT, REP-DENY |
| Vrste zadataka | `/vrste-zadataka` | `e2e/modules/task-types.spec.ts` | TT-EMPTY, TT-ARCHIVE, TT-DENY |
| Forme | `/forme` | `e2e/modules/forms.spec.ts` + `e2e/form-*.spec.ts` | FORM-EMPTY, FORM-DENY, FV-* |
| Korisnici | `/administracija/korisnici` | `e2e/modules/users.spec.ts` | USER-EMPTY, USER-CRUD, USER-DENY |
| Matrica prava | `/administracija/prava` | `e2e/modules/roles.spec.ts` | ROLE-READ, ROLE-SAVE, ROLE-DENY |
| Audit log | `/audit-log` | `e2e/modules/audit.spec.ts` | AUDIT-EMPTY, AUDIT-DETAIL, AUDIT-DENY |
| Profil | `/profil` | `e2e/modules/profile.spec.ts` | PROF-VIEW, PROF-PASSWORD, PROF-LOGOUT-ALL |
| Zdravlje | `/zdravlje` | `e2e/modules/health.spec.ts` | HEALTH-OK, HEALTH-DOWN, HEALTH-DENY |
| Dizajn sistem | `/dizajn-sistem` | `e2e/modules/design-system.spec.ts` | DS-VIEW |

## Pravila

- Playwright mockuje `/api/v1/**` (CI `web-e2e`); nema živog backend-a.
- Svaki modul: prazan/lista tok + primarna akcija + `Nemate pristup` gdje ruta ima `RequirePermission`.
- Forme: detaljan lifecycle ostaje u `form-versioning` matrici.
