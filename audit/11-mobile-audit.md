# 11 — Audit mobilne aplikacije

**Datum:** 30.10.2026. (impl. update isti dan)
**Opseg:** `apps/mobile` (Expo SDK 57, Android `ba.ba101.voznipark`).
**Status:** **kod zatvoren za nalaze M-01…M-07/M-09/M-10/M-15 i UX usklađivanje; uređajski UAT i produkcijski FCM ostaju na vlasniku.**

## Dokumenti ovog audita

| Fajl | Sadržaj |
|------|---------|
| ovaj fajl | presuda, granice, šta radi / šta ne |
| [11-mobile-ekrani.md](11-mobile-ekrani.md) | M1–M11, navigacija, auth/RBAC |
| [11-mobile-nalazi.md](11-mobile-nalazi.md) | nalazi i status nakon impl |
| [11-mobile-verifikacija.md](11-mobile-verifikacija.md) | CI, Maestro, UAT |
| [`.cursor/docs/matrices/mobile-app/MATRIX.md`](../.cursor/docs/matrices/mobile-app/MATRIX.md) | matrica ekran × permisija × dokaz |

## Presuda

Klijent sada ima `(app)` auth guard, spec Super Admin copy, `href: null` tabove, jedinstveni `FieldControl`, 48 px primitive, 409 claim dijalog, preferences i FCM register/revoke (no-op bez `google-services.json`). `FIREBASE_ENABLED` na hostu se **ne** pali ovim diffom.

**„Gotovo” za produkcijski release** tek nakon vlasničkog UAT-a na preview APK (checklist u `apps/mobile/README.md`).
