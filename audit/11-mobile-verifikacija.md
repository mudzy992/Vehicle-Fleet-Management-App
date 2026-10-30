# 11c — Mobilna verifikacija (CI, E2E, UAT)

## Automatski gateovi

| Gate | Gdje | Šta dokazuje |
|------|------|----------------|
| Typecheck | CI `mobile` + lokalno `pnpm typecheck` | TS |
| Android JS export | isti job | Metro bundle |
| Design tokens | `scripts/check-design-tokens.mjs` | web/mobile hex parovi |
| Maestro | `.github/workflows/mobile-e2e.yml` | P4 create/FAB, P1 Super Admin, claim/complete-lite, logout |
| Auth/API script | `verify-p4-auth.mjs`, `verify-p4-api.mjs` | localhost only; Super Admin 403 |

Maestro YAML-ovi: `apps/mobile/.maestro/*.yaml`. Claim seed: `prepare-claim-task.mjs` (WASH INTERNAL, bez kamere).

M-E3 concurrent claim ostaje na API stress testovima. M-E4 kamera i pravi FCM nisu CI (emulator/kamera/Firebase). M-E6 offline keš namjerno nije.

## Ručni UAT (vlasnik)

Vidi checklist u `apps/mobile/README.md`. Agent ne deploja i ne pali `FIREBASE_ENABLED`.
