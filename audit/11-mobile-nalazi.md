# 11b — Nalazi mobilne aplikacije

Status na 30.10.2026. nakon `mobile-audit-impl`.

## Zatvoreno u kodu

| ID | Nalaz | Fix |
|----|--------|-----|
| M-01 | Super Admin copy | `toUserMessage` mapira `MOBILE_ACCESS_FORBIDDEN` / `MOBILE_SCOPE_NOT_ALLOWED` na spec §10; Maestro P1 |
| M-02 | Stack bez auth | `app/(app)/_layout.tsx` Redirect |
| M-03 | Create bez `task:create` | rani return u `CreateTaskScreen` |
| M-04 | Tabovi izostavljeni | uvijek `Tabs.Screen` + `href: null` |
| M-05 | HANDOVER/OTHER | eksplicitna poruka; nema izmišljenog CRUD-a |
| M-06 | FCM mrtva zavisnost | `push-registration.ts`; plugin; `googleServicesFile` samo ako fajl postoji |
| M-07 | Preferences | `PreferencesCard`; e-mail disabled |
| M-09 | Maestro samo P4 | P1, claim/complete-lite, logout YAML |
| M-10 | Fajlovi >200 | split api/form/profile/create |
| M-15 | Lookup gutao greške | `toUserMessage` na polju |
| M-12 | Status labele | `StatusBadge` iz `@vfm/shared` |
| M-14 | 48 px / SafeArea | primitive + Screen |
| M-17 | README stale P4 | ažuriran |
| M-18 | i18n | `src/lib/i18n.ts` BS default + EN mapa (novi stringovi) |

## Otvoreno / vlasnik

| ID | Stanje |
|----|--------|
| M-08 | uređajski vizuelni UAT (preview APK) |
| M-13 | „Prikaži još” hint; nema infinite scroll (namjerno) |
| M-16 | `TIRE_SETS_BY_VEHICLE` i dalje klijentski filter + poruka bez `vehicleId`; API se ne širi |
| M-11 | native form-renderer paket nije uveden |
| M-19 | nema RN unit testova; dokaz typecheck + Maestro YAML |

## By design

Online-first bez keša (M-E6). GPS nije u klijentu. Android-only. `FIREBASE_ENABLED` ostaje host odluka.
