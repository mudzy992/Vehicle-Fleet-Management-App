# Changelog — form-versioning

## 2026-10-31

- MIME više nije polje na formi. PHOTO = JPEG/PNG/WebP/AVIF, FILE = PDF/DOCX/XLS/XLSX.
- Razlog: mobilni upload padao je na form-level `mimeTypes` (npr. GIF) i HEIC/AVIF s telefona, a API allowlista je bila drugačija.

## 2026-10-30

- TASK unique `(taskTypeId, role)` — ORDER i REALIZATION po vrsti.

## 2026-10-30

- Builder: checkbox „Potvrđujem uklanjanje mapiranih polja“ i `confirmNormalizedRemoval` na objavi (FV-NORM).
- Razlog: objava v7 pranja (samo fotografija, bez `washCost` → `totalCost`) padala je na `NORMALIZED_FIELD_REMOVED` jer UI nije slao potvrdu.
- E2E scenariji FV-P9, FV-COPY, FV-IMMUTABLE, FV-DELETE, FV-NOTE, FV-COMPARE, FV-XOR mapirani na Playwright specove.
- Inicijalna matrica: statusi, tok copy → PUT → publish, keš nacrta, odbijanja, permisije.
- Razlog: objava kopirane verzije vraćala identičan klon i kad su polja mijenjana u builderu.
