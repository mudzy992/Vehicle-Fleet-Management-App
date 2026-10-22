# Mobilna aplikacija (Expo / Android)

**Faza 6 je u toku.** Aplikacija uključuje Expo Router, prijavu s `MOBILE_ANDROID`, obaveznu promjenu privremene lozinke, refresh token u SecureStore, moje i slobodne zadatke, detalj, dinamičku formu prema snapshotu pri preuzimanju/završetku i kreiranju zadatka, upload fotografija/fajlova, listu i read-only profil vozila, korisnički profil i odjavu. Obavijesti/FCM, novi zadatak, sesije/promjena lozinke i EAS distribucija još nisu završeni.

## Pokretanje i provjera

Aplikacija je namjerno zasebna pnpm radna cjelina (`pnpm-workspace.yaml`) i nije uključena u root monorepo gate ili Docker build. Iz `apps/mobile`:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm exec expo export --platform android
corepack pnpm start
```

Za stvarni uređaj postaviti `EXPO_PUBLIC_API_URL` na HTTPS API bazu, podrazumijevano `https://api.vehicle.ba101.top/api/v1`. Android application ID je `ba.ba101.voznipark`; isti ID unijeti pri registraciji Android aplikacije u Firebase konzoli. Ne mijenjati ga nakon objave u Google Play. Super Admin zabrana se i dalje provjerava na serveru (`MOBILE_ACCESS_FORBIDDEN`).

Refresh token se čuva u `expo-secure-store`, access token samo u memoriji. Nema offline reda ni lokalne izmjene zapisa. Prijava i API zahtjevi šalju `X-Client-Type: MOBILE_ANDROID`.

## Metro na lokalnom računaru

Iz PowerShella u Windowsu:

```powershell
cd apps/mobile
corepack pnpm install --frozen-lockfile
$env:EXPO_PUBLIC_API_URL = 'https://api.vehicle.ba101.top/api/v1'
corepack pnpm exec expo start --lan
```

macOS/Linux:

```bash
cd apps/mobile
corepack pnpm install --frozen-lockfile
EXPO_PUBLIC_API_URL=https://api.vehicle.ba101.top/api/v1 corepack pnpm exec expo start --lan
```

Instaliraj **Expo Go** na Androidu, poveži telefon i računar na istu Wi-Fi mrežu i skeniraj QR iz Metro terminala. Telefon mora moći otvoriti HTTPS API adresu iznad. Nemoj koristiti `localhost` kao API adresu. Ako Expo Go ne odgovara SDK verziji projekta, treba Android development build.

## Firebase / FCM

Firebase Android aplikaciju registruj s package name **`ba.ba101.voznipark`**. Preuzeti klijentski `google-services.json` stavi lokalno u `apps/mobile/google-services.json`; `.gitignore` ga isključuje iz Gita. Nakon što fajl postoji, Expo konfiguracija Androida treba pokazivati na `./google-services.json` (`android.googleServicesFile`). Trenutno Firebase nije integrisan u mobilni build i nema FCM/API registracije tokena; ne uključuj `FIREBASE_ENABLED` još.

Privatni **service-account JSON** je drugi fajl: nikad ga ne stavljati u `apps/mobile`, Git ili Expo bundle. Na produkcijskom hostu ide u `/etc/vfm/secrets/firebase-service-account.json`, montiran read-only u API/worker na `/run/secrets/vfm/firebase-service-account.json`; `FIREBASE_SERVICE_ACCOUNT_HOST_DIR=/etc/vfm/secrets`. Coolify ENV koristi `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_PATH` i tek nakon završene FCM integracije `FIREBASE_ENABLED=true`. Upute za host mount: `docs/08-DOCKER_COOLIFY_DEPLOYMENT.md` §4.4.

## Planirani nastavak

- U wizardu dodati `LIST`/`QUERY` i `REFERENCE` lookup polja.
- Obavijesti, FCM token registracija i API slanje push poruka.
- Expo/EAS Android development build i test na fizičkom uređaju.
