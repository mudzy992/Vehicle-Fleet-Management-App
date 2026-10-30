# Matrica — mobilna aplikacija

**Slug:** `mobile-app`
**Ažurirano:** 30.10.2026.
**Izvor:** `audit/11-mobile-audit.md` + impl `mobile-audit-impl`

## Klijentski ugovor

| Pravilo | Vrijednost |
|---------|------------|
| Platforma | Android only (`ba.ba101.voznipark`) |
| Client type | uvijek `MOBILE_ANDROID` |
| Session | access in-memory; refresh `expo-secure-store` |
| Offline | online-first; banner + write disabled; nema queue/keša |
| Super Admin | server 403; UI spec copy §10 |
| Forme | snapshot + `FieldControl`; PHOTO kamere/galerije nezavisno od canSubmit; HANDOVER/OTHER unsupported copy |
| PHOTO | dozvola kamere + galerije; JPEG upload kroz FormData bez JSON Content-Type |
| Push | klijent register/revoke; no-op bez google-services / dok je `FIREBASE_ENABLED=false` |

## Ekran × permisija × dokaz

| Ekran | Prikaz | Mutacija | Automatski dokaz | Uređaj |
|-------|--------|----------|------------------|--------|
| M1 Prijava | javno | `POST /auth/login` | Maestro P1 + `verify-p4-auth` | UAT |
| M2 Zadaci | `task:view` / `view_all`; slobodni uz `task:claim` | — | P4 + claim YAML | UAT |
| M3 Detalj | API `task:view` | — | claim/complete YAML | UAT |
| M4 Claim | CTA `task:claim` | `POST /tasks/:id/claim` | claim YAML; 409 u kodu | UAT |
| M5 Complete | CTA complete | `POST /tasks/:id/complete` | complete-lite (INTERNAL, bez kamere) | UAT+kamera |
| M6 Create | FAB `task:create` | `POST /tasks` | Maestro P4 + API 403 | UAT |
| M7 Vozila | tab `vehicle:view` | nema | href:null empty | UAT |
| M8 Vozilo RO | API `vehicle:view` | nema | kod | UAT |
| M9 Obavijesti | `notification:view` | mark_read | badge kod | UAT |
| M10 Profil | uvijek; sesije/prefs po permisiji | logout, password, revoke, prefs | logout YAML | UAT |
| M11 Greške | `toUserMessage` | retry / re-login | P1 copy; offline banner | UAT |

## REFERENCE_RECORD

Dozvoljeno: VEHICLE, DRIVER, REGISTRATION, INSURANCE, SERVICE, TIRE_SET, TIRE_INSTALLATION, TASK.

`VEHICLE_HANDOVER` / `OTHER`: poruka „Ovaj tip zapisa nije dostupan u mobilnoj formi.” Nema list API-ja.

`TIRE_SETS_BY_VEHICLE`: postojeći `/tire-sets` + klijentski filter; poruka ako nema `params.vehicleId`.

## E2E mapa

| Acceptance | Stanje |
|------------|--------|
| P4 create + hidden FAB | Maestro YAML + CI job |
| P1 Super Admin poruka | Maestro YAML + auth script 403 |
| Claim / complete-lite | Maestro YAML (nema kamere) |
| Logout | Maestro YAML |
| Offline keš | namjerno nije |
