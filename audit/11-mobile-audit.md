# 11 — Audit mobilne aplikacije

**Datum:** 30.10.2026. 22:20 (re-audit nakon contrast + PHOTO)
**Opseg:** `apps/mobile` (Expo SDK 57, Android `ba.ba101.voznipark`).
**Status:** **kod zatvoren za P1/P2 impl + AA kontrast + PHOTO upload path. Produkcijski release čeka vlasnički UAT na preview APK i Firebase odluku.**

## Dokumenti ovog audita

| Fajl | Sadržaj |
|------|---------|
| ovaj fajl | presuda, granice, šta radi / šta ne |
| [11-mobile-ekrani.md](11-mobile-ekrani.md) | M1–M11, navigacija, auth/RBAC |
| [11-mobile-nalazi.md](11-mobile-nalazi.md) | nalazi i status |
| [11-mobile-verifikacija.md](11-mobile-verifikacija.md) | CI, Maestro, UAT |
| [`.cursor/docs/matrices/mobile-app/MATRIX.md`](../.cursor/docs/matrices/mobile-app/MATRIX.md) | matrica ekran × permisija × dokaz |

## Presuda

Klijent ima `(app)` auth guard, spec Super Admin copy, `href: null` tabove, `FieldControl`, 48 px primitive, 409 claim dijalog, preferences, FCM register/revoke (no-op u Expo Go / bez `google-services.json`). Hex paleta netaknuta; AA je na korištenju (placeholder, badge, disabled). PHOTO: dozvola kamere + galerije, JPEG, FormData blob, akcije nisu vezane za `canSubmit`.

`FIREBASE_ENABLED` na hostu se **ne** pali ovim diffom. Maestro complete-lite ne pokriva kameru. Metro LAN je ugašen ručno.

**„Gotovo” za produkcijski release** tek nakon vlasničkog UAT-a na preview APK (checklist u `apps/mobile/README.md`), uključujući WASH EXTERNAL/FULL fotografiju na uređaju.
