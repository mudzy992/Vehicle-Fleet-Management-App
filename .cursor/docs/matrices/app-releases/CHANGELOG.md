# Changelog — app-releases

## 2026-11-02

- Production mobile build prije EAS-a diže `versionCode` i patch `versionName`, committa i pusha `app.json` + `package.json`.
- Zašto: update i upload traže strogo veći `versionCode`; broj mora biti u APK-u i u gitu prije builda, inače sljedeći build ponovi istu verziju.

## 2026-11-01

- Javni download CTA je na `/prijava`, ne na homepage `/`.
- Zašto: naslovna ostaje ulaz u aplikaciju (auth → nadzorna), a APK se nudi uz formu prijave.

## 2026-10-31

- Inicijalna matrica: Super Admin WEB upload, javni latest/file, obavezan mobile update po `versionCode`, rollback preko activate.
- Zašto: APK se ne smije tretirati kao `Attachment` (20 MB, login, JPEG/PDF); katalog je javni binarni kanal.
