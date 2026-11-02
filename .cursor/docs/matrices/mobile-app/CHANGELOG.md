# Changelog — matrica mobilne aplikacije

## 2026-11-02 (vozački inbox + safe area)

- Tab bar/header/login koriste `useSafeAreaInsets` (gesture i 3-button).
- Moji default: `activeOnly=true` (OPEN + IN_PROGRESS); chip Svi ide na API bez tog filtera.
- Tab Vozila samo za `task:create`; vozač ne vidi tab.
- Zašto: vozač treba inbox u radu, a sistemska navigacija ne smije prekriti tabove.

## 2026-10-31 (PHOTO content + toast)

- Prikaz fotografije nakon restarta: `GET /attachments/:id/content` sa Bearer, magic-byte provjera, keš JPEG-a. Envelope interceptor ne smije omotati StreamableFile.
- Toast: success/danger/warning/info na web i mobile; mutacije auto-toast na HTTP grešku.
- Zašto: nakon Expo Go restarta thumbnail je bio „Slika se nije učitala“ jer je API vraćao JSON umjesto bajtova slike.

## 2026-10-30 (re-audit)

- Re-audit koda nakon AA kontrasta i PHOTO fikseva. P1/P2 impl ostaju zatvoreni u kodu. Otvoreno: M-08 UAT, M-11/13/16/19, FCM host.
- Zašto: Canvas i audit dokumenti su bili na stanju prije polish/kamera.

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
