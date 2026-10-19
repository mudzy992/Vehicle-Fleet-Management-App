/**
 * Ruter (react-router v8).
 *
 * Struktura ekrana je iz `docs/06-UX_UI_DIZAJN.md` §5.5 (W01…W28). U Fazi 0
 * postoji **kostur navigacije** s placeholder stranicama + `/dizajn-sistem`
 * (pregled dizajn tokena i komponenti) i `/zdravlje` (API status).
 *
 * Od Faze 1: `loader`/`action` po ruti + guard za permisije (server je
 * autoritet — UI samo sakriva akcije radi iskustva).
 */
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './shell.js';
import { PlaceholderPage } from '../features/placeholder-page.js';
import { DesignSystemPage } from '../features/design-system/design-system-page.js';
import { HealthPage } from '../features/system/health-page.js';
import { NAV_ITEMS } from './nav.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/nadzorna-tabla" replace /> },
      {
        path: 'nadzorna-tabla',
        element: (
          <PlaceholderPage
            title="Nadzorna tabla"
            code="W02"
            phase="Faza 3"
            description="Ključni brojevi, rokovi koji ističu i zadaci koji čekaju preuzimanje."
          />
        ),
      },
      {
        path: 'vozila',
        element: (
          <PlaceholderPage
            title="Vozila"
            code="W05"
            phase="Faza 3"
            description="Registar vozila s filterima, kilometražom i statusima."
          />
        ),
      },
      {
        path: 'vozila/:vehicleId',
        element: (
          <PlaceholderPage
            title="Detalji vozila"
            code="W06"
            phase="Faza 3"
            description="Historija registracija, osiguranja, servisa i guma za jedno vozilo."
          />
        ),
      },
      {
        path: 'zadaci',
        element: (
          <PlaceholderPage
            title="Zadaci"
            code="W09"
            phase="Faza 5"
            description="Kanban i lista zadataka s preuzimanjem (atomski claim)."
          />
        ),
      },
      {
        path: 'gume',
        element: (
          <PlaceholderPage
            title="Gume"
            code="W14"
            phase="Faza 4"
            description="Kompleti guma, ciklusi montaže i kilometraža po setu."
          />
        ),
      },
      {
        path: 'forme',
        element: (
          <PlaceholderPage
            title="Forme"
            code="W17"
            phase="Faza 2"
            description="Builder dinamičkih formi s verzijama (nacrt/objavljeno/povučeno)."
          />
        ),
      },
      {
        path: 'izvjestaji',
        element: (
          <PlaceholderPage
            title="Izvještaji"
            code="W22"
            phase="Faza 7"
            description="Izvještaji nad SQL view-ovima s izvozom u PDF i Excel."
          />
        ),
      },
      {
        path: 'obavijesti',
        element: (
          <PlaceholderPage
            title="Obavijesti"
            code="W25"
            phase="Faza 5"
            description="In-app obavijesti, prijenos uživo (SSE) i postavke kanala."
          />
        ),
      },
      {
        path: 'administracija/korisnici',
        element: (
          <PlaceholderPage
            title="Korisnici"
            code="W26"
            phase="Faza 1"
            description="Upravljanje nalozima, ulogama i statusima."
          />
        ),
      },
      {
        path: 'administracija/prava',
        element: (
          <PlaceholderPage
            title="Matrica prava"
            code="W27"
            phase="Faza 1"
            description="Konfiguracija prava po ulogama (P-01, P-02) — samo Super Admin."
          />
        ),
      },
      {
        path: 'profil',
        element: (
          <PlaceholderPage
            title="Profil"
            code="W28"
            phase="Faza 1"
            description="Podaci o nalogu, aktivne sesije i promjena lozinke."
          />
        ),
      },
      { path: 'dizajn-sistem', element: <DesignSystemPage /> },
      { path: 'zdravlje', element: <HealthPage /> },
      { path: '*', element: <PlaceholderPage title="Nepostojeća stranica" code="404" phase="—" /> },
    ],
  },
]);

/** Ruta → naslov (za breadcrumb i naslov dokumenta). */
export const ROUTE_TITLES: Readonly<Record<string, string>> = NAV_ITEMS.reduce(
  (accumulator, item) => ({ ...accumulator, [item.to]: item.label }),
  { '/dizajn-sistem': 'Dizajn sistem', '/zdravlje': 'Zdravlje sistema' },
);
