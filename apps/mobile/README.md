# Mobilna aplikacija (Expo / Android)

**Faza 6 (mobilni audit impl) je u kodu.** Implementirano: prijava `MOBILE_ANDROID`, auth guard u `app/(app)/`, obavezna/ručna lozinka, refresh u SecureStore, Moji/Slobodni zadaci, claim/complete, wizard kreiranja, dinamičke forme, vozila RO, in-app obavijesti, preferences, profil/sesije, FCM klijent (no-op bez native Firebase konfiguracije). Super Admin vidi spec poruku iz `docs/06` §10. P4 Maestro (create + hidden FAB) postoji; dodati su P1 Super Admin, claim/complete-lite i logout YAML-ovi.

## Pokretanje i provjera

Aplikacija ima zaseban pnpm workspace/lockfile i nije član root workspace-a. TypeScript/Metro alias-i čitaju `packages/shared`, `packages/form-engine` i `packages/form-renderer`:

```bash
corepack pnpm install --frozen-lockfile
cd apps/mobile
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm exec expo export --platform android
corepack pnpm check:expo
corepack pnpm start
```

Iz korijena: `node scripts/check-design-tokens.mjs`.

## P4 / P1 Maestro (izolovani CI)

`.github/workflows/mobile-e2e.yml` pokreće Android emulator i Maestro 2.11.0 nad disposable PostgreSQL 17 i Redis 7. Nema produkcijskog API-ja.

Tokovi u `apps/mobile/.maestro/`:

- `task-create-admin.yaml` — administrator kreira WASH zadatak (P4)
- `task-create-no-permission.yaml` — vozač nema FAB
- `super-admin-forbidden.yaml` — P1 spec copy, nema tabova
- `task-claim-complete-lite.yaml` — Slobodni → Preuzmi (INTERNAL, bez kamere) → Završi
- `logout.yaml` — odjava vraća na prijavu

`scripts/verify-p4-api.mjs` i `scripts/verify-p4-auth.mjs` rade samo na `localhost`/`127.0.0.1`. `prepare-claim-task.mjs` seed-uje OPEN WASH zadatak za claim tok.

## Metro na lokalnom računaru

```powershell
cd apps/mobile
corepack pnpm install --frozen-lockfile
$env:EXPO_PUBLIC_API_URL = 'https://api.vehicle.ba101.top/api/v1'
corepack pnpm exec expo start --lan
```

**Expo Go** je dovoljan za login/liste/forme. **FCM push token nije dostupan u Expo Go** — treba EAS preview/dev client nakon lokalnog `google-services.json`.

Refresh token je u `expo-secure-store`, access token samo u memoriji. Nema offline reda. Zahtjevi šalju `X-Client-Type: MOBILE_ANDROID`.

## Firebase / FCM

Android package: **`ba.ba101.voznipark`**. `google-services.json` je u `apps/mobile/` (klijentski Firebase config). `app.config.ts` veže fajl samo ako postoji.

Push radi tek kad su ispunjena sva tri:

1. lokalni `google-services.json` + native/dev build (ne Expo Go)
2. korisnik dozvoli `POST_NOTIFICATIONS`
3. vlasnik uključi `FIREBASE_ENABLED=true` na API hostu (agent to **ne** pali)

Bez toga klijent registruje token no-op (catch, bez crasha). E-mail kanal u preferences je disabled.

Privatni service-account JSON ne ide u `apps/mobile`. Host upute: `docs/08-DOCKER_COOLIFY_DEPLOYMENT.md` §4.4.

## UAT checklist (vlasnik, preview APK)

- [ ] Login vozač/admin; Super Admin vidi tačan spec tekst i ne ulazi u tabove
- [ ] Claim 409 dijalog „Zadatak je preuzeo…” + Nazad/Osvježi
- [ ] Complete + kamera na formi koja zahtijeva fotografiju
- [ ] Sesije: odjava uređaja i odjava svih
- [ ] Tab deep-link zadatak/vozilo; hidden tab uz `href: null` + empty stanje
- [ ] Preferences in-app/push; e-mail disabled
- [ ] Push samo ako Firebase na hostu i native build
- [ ] Offline banner; write CTA disabled; nema keša
- [ ] Safe area, CTA/FAB ≥ 48 px

## EAS Android build

Lokalni APK (`--local`). Profili: `developer` (dev client), `preview`, `production`. Nema AAB.

```bash
cd apps/mobile
corepack pnpm build:developer
corepack pnpm build:preview
corepack pnpm build:production
```

Ne čuvati signing credentials u Git-u.
