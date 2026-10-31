# Changelog — app-releases

## 2026-11-01

- Javni download CTA je na `/prijava`, ne na homepage `/`.
- Zašto: naslovna ostaje ulaz u aplikaciju (auth → nadzorna), a APK se nudi uz formu prijave.

## 2026-10-31

- Inicijalna matrica: Super Admin WEB upload, javni latest/file, obavezan mobile update po `versionCode`, rollback preko activate.
- Zašto: APK se ne smije tretirati kao `Attachment` (20 MB, login, JPEG/PDF); katalog je javni binarni kanal.
