# 11a — Mobilni ekrani i klijentski RBAC

Izvor mape: `docs/06-UX_UI_DIZAJN.md` §9.2, usklađen s kodom 30.10.2026. 22:20.

## Navigacija

Root `app/_layout.tsx`: `AuthProvider` + Stack `index` / `(auth)` / `(app)`.

`(app)/_layout.tsx` radi `Redirect` na login ili change-password. Unutra: `(tabs)`, `task/create`, `task/[id]`, `vehicle/[id]`.

Tabovi se uvijek registruju; bez permisije `href: null` + empty/403 u ekranu. Obavijesti imaju `tabBarBadge` iz unread count.

## Matrica M1–M11

| ID | Ekran | Fajl | Permisija (UI) | Status |
|----|--------|------|----------------|--------|
| M1 | Prijava | `app/(auth)/login.tsx` | javno | spec Super Admin copy (kod + helper) |
| M2 | Zadaci | `app/(app)/(tabs)/tasks.tsx` | `task:view` / `claim` | FAB 56, segmenti 48, skeleton, pagination hint |
| M3 | Detalj | `app/(app)/task/[id].tsx` | API `task:view` | StatusBadge + prioritet labele |
| M4 | Preuzimanje | `dynamic-task-form.tsx` | `task:claim` | sticky 56 CTA; 409 Alert Nazad/Osvježi |
| M5 | Završetak | isti | `task:complete` | PHOTO 48 px CTA; galerija + JPEG FormData; WASH photos samo EXTERNAL/FULL |
| M6 | Wizard | `create-task-screen.tsx` | `task:create` rani return | rok `dd.MM.yyyy` |
| M7 | Vozila | `app/(app)/(tabs)/vehicles.tsx` | `vehicle:view` | DuePill; empty bez prava |
| M8 | Vozilo RO | `app/(app)/vehicle/[id].tsx` | API `vehicle:view` | VIN RO, DuePill |
| M9 | Obavijesti | `app/(app)/(tabs)/notifications.tsx` | `notification:view` | badge, deep-link, mark-all |
| M10 | Profil | `app/(app)/(tabs)/profile.tsx` | sesije / preferences | PreferencesCard + sessions panel |
| M11 | Sistem | `toUserMessage` | — | offline banner; write disabled; nema keša |
