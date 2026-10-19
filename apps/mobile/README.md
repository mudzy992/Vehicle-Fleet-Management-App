# `apps/mobile` — Expo (Android)

> **Status: Faza 0 — skeleton, nije instaliran.** Aplikacija se implementira u
> **Fazi 6** (`docs/PLAN_IMPLEMENTACIJE.md`). Ovaj folder namjerno **nije** član
> pnpm workspace-a (`pnpm-workspace.yaml`) — vidi objašnjenje ispod.

---

## Zašto nije u workspace-u

| Razlog | Detalj |
|---|---|
| Veličina | Expo + React Native + Gradle ≈ 1 GB dependencija; ne treba za API/web build |
| Build lanac | Android build ide kroz **EAS** (ili lokalni Gradle), ne kroz Docker/Coolify |
| CI | `pnpm turbo lint typecheck test build` u ovom repozitoriju ne dira mobilnu app |
| Nezavisnost | Mobilna app se razvija i izdaje odvojeno od web/API deploya |

Kada Faza 6 počne, dovoljno je dodati `- "apps/mobile"` u `pnpm-workspace.yaml`
i `cd apps/mobile && pnpm install`. Time se ništa ne mijenja u Docker stacku.

---

## Šta je planirano (Faza 6)

- **Expo SDK 57** (React Native), TypeScript, `expo-router`.
- **Online-first** (odluka vlasnika): nema offline sync-a u v1; svaki zahtjev
  ide na API. Svi ekrani imaju jasno stanje „nema mreže“ i ponovni pokušaj.
- **Super Admin se ne može prijaviti na mobilnoj aplikaciji** — server vraća
  `403 MOBILE_ACCESS_FORBIDDEN` (N-05, `docs/05` §6). UI to ne nudi.
- **FCM push** (`FIREBASE_ENABLED`): vlasnik ručno kreira Firebase projekat i
  `google-services.json` (R-04). Do tada obavijesti rade samo in-app (SSE).
- Ekrani: prijava, moji zadaci (preuzimanje/završetak), detalji zadatka s
  dinamičkom formom (`@vfm/form-renderer`), obavijesti, profil.
- Kamera za fotografije priloga (`expo-camera`), kompresija prije uploada.

## Konfiguracija

Sve varijable su već u `.env.example` §13:

| Varijabla | Namjena |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://api.vehicle.ba101.top/api/v1` |
| `EXPO_PUBLIC_APP_ENV` | `production` / `staging` / `local` |
| `EAS_PROJECT_ID` | EAS projekat (build/submit) |
| `ANDROID_PACKAGE` | `ba.example.voznipark` — mora odgovarati `FCM_ANDROID_PACKAGE` |
| `ANDROID_VERSION_CODE` / `ANDROID_VERSION_NAME` | verzionisanje APK/AAB |
| `GOOGLE_SERVICES_JSON_PATH` | putanja do FCM klijentskog fajla (ne ide u Git) |

## Aktivacija (kada dođe Faza 6)

```bash
cd apps/mobile
pnpm dlx create-expo-app@latest . --template blank-typescript
pnpm add expo-router @vfm/shared @vfm/form-renderer
pnpm install
```

> ⚠️ `@vfm/shared` je namijenjen i mobilnoj aplikaciji (statusi, permisije,
> formatiranje). **Ne** uvoziti `@vfm/shared/env` — to je server-only ulaz
> (Node `process.env`), pa ne pripada React Native bundle-u.
