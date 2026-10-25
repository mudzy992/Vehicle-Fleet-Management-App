# Mobilna aplikacija (Expo / Android)

**Faza 6 je u toku.** Implementirano je: prijava za `MOBILE_ANDROID`, obavezna i ručna promjena lozinke, refresh token u SecureStore, Moji/Slobodni zadaci i detalj, trokorakni wizard za kreiranje, dinamičke forme sa LIST/QUERY i podržanim REFERENCE lookup-ima, upload priloga, vozila (lista/profil), profil, odjava i permission-gated upravljanje aktivnim sesijama. API greške imaju ujednačene poruke; neuspjelo osvježavanje sesije vraća korisnika na prijavu. CI sada radi mobilni typecheck i Android JS export; Maestro/UI E2E i uređajski UAT još nisu izvršeni, pa je P4 i dalje otvoren. Preostaju postavke obavijesti, `REFERENCE_RECORD` za `VEHICLE_HANDOVER`/`OTHER` i EAS distribucija. In-app lista, unread count i označavanje pročitane su implementirani; FCM nije aktivan.

## Pokretanje i provjera

Aplikacija ima zaseban pnpm workspace/lockfile i nije član root workspace-a, monorepo gate-a niti Docker builda. Ipak, TypeScript/Metro alias-i čitaju izvorne `packages/shared`, `packages/form-engine` i `packages/form-renderer`, pa se prvo instaliraju root paketi, zatim mobilne zavisnosti:

```bash
# iz korijena repozitorija
corepack pnpm install --frozen-lockfile
cd apps/mobile
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm exec expo export --platform android
corepack pnpm check:expo
corepack pnpm start
```

`check:expo` koristi `expo-doctor` preko `corepack pnpm dlx`, bez instaliranja EAS CLI-ja u aplikacijske zavisnosti. Provjere koje zovu Expo/RN Directory API zahtijevaju pristup tim eksternim servisima.

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

Firebase Android aplikaciju registruj s package name **`ba.ba101.voznipark`**. Preuzeti klijentski `google-services.json` stavi lokalno u `apps/mobile/google-services.json`; `.gitignore` ga isključuje iz Gita. `app.config.ts` postavlja `android.googleServicesFile` samo kada taj lokalni fajl postoji; bez njega Android export ne referencira nepostojeću konfiguraciju. Trenutno Firebase nije integrisan u mobilni build i nema FCM/API registracije tokena; ne uključuj `FIREBASE_ENABLED` još.

Privatni **service-account JSON** je drugi fajl: nikad ga ne stavljati u `apps/mobile`, Git ili Expo bundle. Na produkcijskom hostu ide u `/etc/vfm/secrets/firebase-service-account.json`, montiran read-only u API/worker na `/run/secrets/vfm/firebase-service-account.json`; `FIREBASE_SERVICE_ACCOUNT_HOST_DIR=/etc/vfm/secrets`. Coolify ENV koristi `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_PATH` i tek nakon završene FCM integracije `FIREBASE_ENABLED=true`. Upute za host mount: `docs/08-DOCKER_COOLIFY_DEPLOYMENT.md` §4.4.

## EAS Android build

`eas.json` definiše `preview` (interni APK za uređajski UAT) i `production` (Android App Bundle). Oba profila koriste javni HTTPS API URL; nijedan ne koristi `localhost`. Expo projekat još treba povezati s vlasnikovim Expo nalogom — ne dodavati izmišljeni `projectId` ili nalog u repozitorij.

Iz `apps/mobile` nakon prijave u Expo:

```bash
corepack pnpm dlx eas-cli@latest login
corepack pnpm dlx eas-cli@latest init
corepack pnpm dlx eas-cli@latest build --platform android --profile preview
```

Za Play Store paket koristi profil `production`. EAS signing credentials konfigurišu se kroz Expo/EAS; ne čuvati ih u repozitoriju. Google Play submit još nije podešen.

## Planirani nastavak

- Podržani su `LIST` šifarnici, `REFERENCE_VEHICLE`/`REFERENCE_DRIVER`, `REFERENCE_RECORD` za VEHICLE, DRIVER, REGISTRATION, INSURANCE, SERVICE, TIRE_SET, TIRE_INSTALLATION i TASK, te svi whitelist QUERY izvori. `WORKSHOPS` koristi šifarnik `WORKSHOP`; `TIRE_SETS_BY_VEHICLE` filtrira prema `params.vehicleId` i traži `tire:view`. VEHICLE_HANDOVER/OTHER reference i test na fizičkom uređaju ostaju otvoreni.
- Obavijesti, FCM token registracija i API slanje push poruka.
- Expo/EAS Android development build i test na fizičkom uređaju.
