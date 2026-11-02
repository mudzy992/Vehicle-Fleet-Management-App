# App releases — katalog APK, prijava i obavezan update

Izvor istine za objavu Android APK-a, javni download i blokirajući update u mobilnoj aplikaciji.

## Ko objavljuje

| Akter | Upload | Lista | Activate (rollback) | Javni latest/file |
| --- | --- | --- | --- | --- |
| Super Admin (WEB) | da | da | da | da |
| Administrator | ne (403) | ne (403) | ne (403) | da (javno) |
| Obicni korisnik | ne | ne | ne | da (javno) |
| Gost | ne | ne | ne | da |

- Permisija `app_release:manage` je **sensitive**, u default matrici ADMINISTRATOR/OBICNI = `null`.
- Servis dodatno tvrdi `actor.isSuperAdmin`. Matrica kasnije ne smije otvoriti upload.
- Mutacije su `@AllowedClientTypes('WEB')` (N-05).

## Verzije

- `versionCode` i `versionName` dolaze **samo iz APK AndroidManifest.xml**. Admin ih ne kuca.
- Poređenje update-a je **samo `versionCode`** (cijeli broj). `versionName` je prikaz.
- Novi upload: `versionCode` mora biti **strogo veći** od trenutnog latest.
- `npm run build:production` u `apps/mobile` prije EAS builda diže `versionCode` za +1 i patch `versionName` za +1, usklađuje `package.json`, committa samo ta dva fajla (`chore(mobile): release <versionName> (<versionCode>)`) i pusha trenutnu granu. Build kreće tek nakon pusha. Prljavo stablo prekida komandu bez bumpa. `build:developer` i `build:preview` ne diraju verziju. Za production se ignorišu `ANDROID_VERSION_CODE` i `ANDROID_VERSION_NAME`, da APK odgovara commitovanoj verziji.
- Rollback: `POST /app-releases/:id/activate` prebacuje `isLatest` na postojeći red, bez re-uploada. Stariji `versionCode` smije ponovo biti latest.

## Javni download

- `GET /api/v1/app-releases/latest` — metapodaci ili 404.
- `GET /api/v1/app-releases/latest/file` — sirovi APK (`application/vnd.android.package-archive`), envelope skip.
- Prijava `/prijava`: CTA **Preuzmi APK** samo kad latest postoji. Gost na `/` ide na prijavu; prijavljeni na `/nadzorna-tabla`.

## Force UX (mobile)

- Usporedba: `latest.versionCode > Number(nativeBuildVersion)`.
- Ako je noviji: **blokirajući** overlay (nema Kasnije, nema dismiss).
- Standalone Android: download + SHA-256 + sistemski instalater.
- Expo Go / nije standalone: isti overlay, CTA vodi na `https://vehicle.ba101.top/`.

## Pohrana

- Disk: `{VFM_STORAGE_CONTAINER_PATH}/app-releases/{versionCode}-{sha256}.apk`
- Limit: `APP_RELEASE_MAX_SIZE_MB` (default 150). Prilozi ostaju 20 MB.
- Magic bytes: ZIP (`PK`). Parse manifesta u čistom JS, bez `aapt`.
