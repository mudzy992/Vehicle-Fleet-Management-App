# 11b — Nalazi mobilne aplikacije

Status na 30.10.2026. 22:20 (re-audit).

## Zatvoreno u kodu

| ID | Nalaz | Fix |
|----|--------|-----|
| M-01 | Super Admin copy | `toUserMessage` mapira `MOBILE_ACCESS_FORBIDDEN` |
| M-02 | Stack bez auth | `app/(app)/_layout.tsx` Redirect |
| M-03 | Create bez `task:create` | rani return u `CreateTaskScreen` |
| M-04 | Tabovi izostavljeni | `Tabs.Screen` + `href: null` |
| M-05 | HANDOVER/OTHER | eksplicitna poruka |
| M-06 | FCM mrtva zavisnost | lazy `expo-notifications`; no-op u Expo Go |
| M-07 | Preferences | `PreferencesCard`; e-mail disabled |
| M-09 | Maestro samo P4 | P1, claim/complete-lite, logout YAML |
| M-10 | Fajlovi >200 | split; create-task-screen 189, field-control 182 |
| M-12 | Status labele | `StatusBadge` iz `@vfm/shared` |
| M-14 | 48 px / SafeArea | primitive + `Screen` |
| M-15 | Lookup gutao greške | `toUserMessage` na polju |
| M-17 | README stale P4 | ažuriran |
| M-18 | i18n | `src/lib/i18n.ts` |
| M-20 | Kontrast AA | placeholder `muted`, badge ink, disabled bez opacity |
| M-21 | PHOTO/kamera | media-library, JPEG, FormData blob, unlock od `canSubmit` |

## Otvoreno / vlasnik

| ID | Stanje |
|----|--------|
| M-08 | uređajski UAT na preview APK (login, claim, kamera EXTERNAL/FULL, sesije, 403, Super Admin) |
| M-11 | native form-renderer paket nije uveden (namjerno `FieldControl`) |
| M-13 | „Prikaži još” hint; nema infinite scroll |
| M-16 | `TIRE_SETS_BY_VEHICLE` klijentski filter |
| M-19 | nema RN unit testova; dokaz typecheck + Maestro YAML |

## By design

Online-first bez keša. GPS nije u klijentu. Android-only. `FIREBASE_ENABLED` ostaje host odluka. WASH `photosAfter` samo za EXTERNAL/FULL.
