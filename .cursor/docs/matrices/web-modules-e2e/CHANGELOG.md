# Changelog — web-modules-e2e

## 2026-11-02

- HTTP 400/409/422/401 se ne toastaju; ostaju inline da Playwright `getByText` / `getByRole('status')` ne vidi duplikat.
- Task cancel/complete 409 se prikazuje kao form `alert` (CI 41436449097).
- Razlog: CI 41429349856, 7 Playwright padova zbog toaster + field error.

## 2026-10-30

- Inicijalna matrica: 19 web modula mapiranih na Playwright specove (`apps/web/e2e/modules/`).
- Razlog: E2E pokrivenost po modulu (lista, akcija, deny), ne samo auth-access monolit.
