# Mobilna aplikacija (Expo / Android)

**Faza 6 je započeta.** Trenutni obim je početni online-first temelj: Expo Router, sigurno čuvanje refresh tokena, prijava s `MOBILE_ANDROID`, lista slobodnih zadataka, detalj/preuzimanje zadatka i profil/odjava. Dinamička forma, završetak zadatka, obavijesti/FCM, testovi na uređaju i EAS distribucija još nisu završeni.

## Pokretanje i provjera

Aplikacija je namjerno zasebna pnpm radna cjelina (`pnpm-workspace.yaml`) i nije uključena u root monorepo gate ili Docker build. Iz `apps/mobile`:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm exec expo export --platform android
corepack pnpm start
```

Za stvarni uređaj postaviti `EXPO_PUBLIC_API_URL` na HTTPS API bazu, podrazumijevano `https://api.vehicle.ba101.top/api/v1`. Android identifikator je privremeno `ba.example.voznipark`; vlasnik ga treba potvrditi prije EAS/Play Store izdanja. Super Admin zabrana se i dalje provjerava na serveru (`MOBILE_ACCESS_FORBIDDEN`).

Refresh token se čuva u `expo-secure-store`, access token samo u memoriji. Nema offline reda ni lokalne izmjene zapisa. Prijava i API zahtjevi šalju `X-Client-Type: MOBILE_ANDROID`.

## Planirani nastavak

- Koristiti zajednički `@vfm/form-renderer` za formu prema snapshotovanoj verziji pri preuzimanju/završetku.
- Upload fotografija iz kamere/galerije uz kompresiju i server-side provjere.
- Obavijesti (API modul/route trenutno nije dostupan u API-ju), FCM registracija tek nakon Firebase konfiguracije vlasnika.
- Integracijski testovi API-ja i provjera APK-a na pravom Android uređaju.
