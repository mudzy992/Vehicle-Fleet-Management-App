# Changelog — matrica mobilne aplikacije

## 2026-10-30 (contrast + PHOTO)

- WCAG AA na mobilnim površinama: placeholder, badge/pill ink, disabled bez opacity, input `surfaceMuted`.
- PHOTO: media-library dozvola, JPEG normalizacija, FormData blob upload; kamere/galerije nisu vezane za canSubmit.
- Zašto: obavezna fotografija se nije mogla dodati; kontrast placeholder/disabled/badge nije zadovoljavao AA.

## 2026-10-30 (impl)

- Zatvoreni klijentski nalazi M-01…M-07, M-09, M-10, M-15, M-12, M-14, M-17, M-18 u kodu.
- Auth ide kroz `(app)` grupu; tabovi `href: null`; FCM no-op; preferences UI.
- Maestro: P1, claim/complete-lite, logout. `FIREBASE_ENABLED` na hostu netaknut.
- Zašto: plan `mobile-audit-impl` — uskladiti native UX i zatvoriti P1/P2 rupe bez ZIP redizajna.

## 2026-10-30

- Inicijalna matrica iz prvog kompletnog audita `apps/mobile`.
