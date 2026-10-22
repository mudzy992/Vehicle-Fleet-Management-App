# 06 — UX/UI dizajn

**Verzija:** 1.0.0 · **Platforme:** web (Vite + React + Tailwind 4 + shadcn/ui), mobilna (Expo/React Native)
**Jezik:** bosanski (`bs`) · **Pristupačnost:** WCAG 2.2 AA

---

## 1. Principi dizajna

| # | Princip | Šta znači u praksi |
|---|---|---|
| 1 | **Terenski, ne kancelarijski** | Mobilna aplikacija se koristi pored vozila, na suncu, ponekad u rukavicama → veliki targeti (≥ 48 px), visok kontrast, minimalno kucanja |
| 2 | **Rokovi su glavni junak** | Svaki ekran koji ima rok (registracija, osiguranje, servis, dozvola) pokazuje boju i „preostalo dana" bez klikanja |
| 3 | **Jedan zadatak = jedna radnja** | Na mobilnoj: „Preuzmi" i „Završi" su najveća dugmad na ekranu; sve ostalo je sekundarno |
| 4 | **Istina je na serveru** | UI prikazuje samo dozvoljene akcije, ali nikad ne pretpostavlja — svaka akcija ima server-side odgovor i jasnu grešku |
| 5 | **Historija se ne skriva** | Svaki zapis ima vidljivu „Historija" (ko, kada, šta, prema kojoj verziji forme) |
| 6 | **Bez iznenađenja** | Destruktivne akcije traže potvrdu s ispisom posljedica; nepovratno = crveno + tekst „trajno" |
| 7 | **Progress umjesto perfekcije** | Draft forme se automatski čuvaju; upload ima progress i retry; offline stanje je vidljivo |
| 8 | **Konzistentnost web/mobilna** | Iste boje, iste statusne riječi, isti redoslijed polja (isti `form-renderer`), isti nazivi akcija |
| 9 | **Manje ekrana, više konteksta** | Detalji vozila su jedan ekran s tabovima, ne 8 odvojenih stranica |
| 10 | **Pristupačnost nije dodatak** | Focus redoslijed, ARIA, kontrast 4.5:1, tastatura, `prefers-reduced-motion` |

---

## 2. Persone i kontekst korištenja

### 2.1 Super Admin — „Amira, 41, administracija/IT"
- **Kontekst:** desktop, kancelarija, 2–3× sedmično po 20 min, povremeno hitno (neko je zaključan).
- **Ciljevi:** dodati korisnika i prava, objaviti novu verziju forme, provjeriti audit, vidjeti troškove.
- **Frustracije:** boji se da će nešto nepovratno pokvariti; treba jasne potvrde i historiju.
- **Dizajn odgovor:** matrica prava s diff pregledom prije snimanja, Form Builder s preview-om i
  checklist-om validacije, audit log s filterima, „posljednji Super Admin" zaštita vidljiva u UI.

### 2.2 Administrator — „Damir, 34, referent za vozni park"
- **Kontekst:** 80 % mobilna (na parkingu/terenu), 20 % web (izvještaji).
- **Ciljevi:** brzo kreirati zadatak, dodijeliti ga, vidjeti ko je šta završio, reagovati na rokove.
- **Frustracije:** sporo kucanje na terenu, ne zna ko je slobodan, dupli poslovi.
- **Dizajn odgovor:** wizard „Novi zadatak" u 3 koraka s defaultima, lista pozvanih korisnika s
  avatarima, rokovi na dashboardu, push odmah po preuzimanju/završetku.

### 2.3 Obični korisnik — „Emina, 27, izvršilac"
- **Kontekst:** isključivo mobilna, često u pokretu, lošija mreža.
- **Ciljevi:** vidjeti slobodne zadatke, preuzeti, završiti uz fotografiju, dobiti potvrdu.
- **Frustracije:** zadatak joj „nestane" ispred nosa; ne zna šta se traži u formi.
- **Dizajn odgovor:** jasna oznaka „Slobodno/Preuzeo X", optimistic UI s trenutnim feedback-om,
  poruka pri `409` koja kaže ko je preuzeo, forma s help tekstom i primjerom, velika dugmad.

### 2.4 Operater (vlasnik servera)
- **Kontekst:** Coolify UI, terminal.
- **Ciljevi:** deploy, backup, vidjeti zašto worker ne radi.
- **Dizajn odgovor:** `system:view_health`/`view_queue` ekran + dokumentacija (`08-…`, `10-…`).

---

## 3. Ključni korisnički tokovi

### T1 — Administrator kreira zadatak, dva korisnika ga vide, jedan preuzme (P4, P5, P6)
```
[mobilna] Zadaci → FAB „+" → 1) Vozilo i vrsta → 2) Opis/prioritet/rok/pozvani → 3) Forma → Potvrdi
          → ekran zadatka, status „Slobodan", badge „2 pozvana"
[push]    Emina i Adnan: „Novi zadatak: Pranje vozila V-003"
[mobilna] Emina: Zadatak → „Preuzmi" → spinner (200 ms) → „Tvoj zadatak" (status IN_PROGRESS)
[mobilna] Adnan: „Preuzmi" → poruka: „Zadatak je preuzeo Emina H. prije 12 s" → dugme „Nazad na listu"
[push]    Damir: „Emina je preuzela zadatak"
```
**Kritični detalji:** poruka o zauzetom zadatku **nije** error toast — to je puni ekran/dijalog s
imenom izvršioca i vremenom (ako korisnik ima pravo da vidi ime). Optimistic UI se **vraća** ako
server vrati `409`.

### T2 — Završetak zadatka (P7)
```
[mobilna] Zadatak (IN_PROGRESS) → „Završi" → dinamička forma (verzija vezana za zadatak)
          → obavezna fotografija „nakon" → kamera → kompresija → upload progress
          → kilometraža (ako vrsta zadatka traži) → komentar → „Potvrdi završetak"
          → success ekran: „Završeno u 14:32 · trajanje 2 h 10 min" + push Damiru
```

### T3 — Registracija ističe za 5 dana (P13)
```
[06:00]  worker skenira → ScheduledReminder (dedupe) → outbox → Notification + push
[web]    Dashboard: crvena kartica „Registracija ističe za 3 dana · V-004" → klik → vozilo → tab Registracije
         → „Dodaj obnovu" → forma (aktivna verzija) → prilog (prometna) → snimi
[mobilna] Obavijest → deep link na vozilo → read-only + „Označi kao riješeno"
```

### T4 — Super Admin objavljuje novu verziju forme (P9)
```
[web] Forme → „Zadatak: Pranje vozila" → „Nova verzija (nacrt)" → paleta polja → drag&drop
      → svojstva (labela, obavezno, opcije) → „Provjeri shemu" (10 provjera, zeleno)
      → „Preview" (web / mobilni okvir prekidač) → „Uporedi s v2" (diff)
      → „Objavi…" → modal: bilješka o promjeni (obavezna) → sažetak: „3 nova polja, 1 uklonjeno"
      → objavljeno; v2 = „Povučena"; postojeći zapisi i dalje na v2 (vidljivo u historiji)
```

### T5 — Zamjena guma (B-09, U-14)
```
[web] Vozilo V-002 → Gume → „Zamijeni komplet" → wizard:
      1) trenutno montirano: Ljetne Michelin (od 12.04.2026, 14.320 km)
      2) novi komplet: Zimske Continental (slobodno, skladište „Regala 3")
      3) kilometraža: 22.140 km (validacija: ≥ posljednjeg očitanja)
      → „Potvrdi zamjenu" → jedna transakcija: demontaža + montaža + km + audit + izvještaj ciklusa
      → ako je komplet već montiran negdje → 409 + jasna poruka na kom vozilu
```

---

## 4. Informacijska arhitektura

### 4.1 Web (desktop ≥ 1024 px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Vozni park     [Pretraga ⌘K]                    🔔 3   🌙   Amira ▾          │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ Nadzorna      │  Breadcrumbs: Vozila / V-003 / Registracije                  │
│ ploča         │                                                              │
│               │                                                              │
│ VOZNI PARK    │                                                              │
│  Vozila       │                                                              │
│  Vozači       │                                                              │
│  Gume         │                                                              │
│               │                                                              │
│ OPERATIVA     │                                                              │
│  Zadaci       │                                                              │
│  Servisi      │                                                              │
│  Rokovi       │                                                              │
│  Izvještaji   │                                                              │
│               │                                                              │
│ ADMINISTRACIJA│                                                              │
│  Korisnici    │                                                              │
│  Role i prava │                                                              │
│  Forme        │                                                              │
│  Postavke     │                                                              │
│  Audit log    │                                                              │
│  Sistem       │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

Navigacijske grupe: **Nadzorna ploča · Vozni park · Operativa · Administracija** (grupe se
prikazuju samo ako korisnik ima barem jedno pravo u njima). Sidebar je sklopiv (ikone + tooltip).

### 4.2 Mobilna (bottom tabs)

```
[ Zadaci ]  [ Vozila ]  [ ＋ ]  [ Obavijesti ]  [ Profil ]
   ●2          ●1        FAB       ●3
```
- **Zadaci** je default tab i prvi ekran nakon prijave (najčešća radnja).
- FAB je kontekstualan: ako korisnik ima `task:create` → „Novi zadatak"; inače nije prikazan.
- Badge brojači se ažuriraju kroz FCM + SSE/pull-to-refresh.

### 4.3 Ruta mapa (web)

| Ruta | Ekran | Potrebna permisija |
|---|---|---|
| `/login` | Prijava | javno |
| `/` | Nadzorna ploča | `auth:login` |
| `/vozila` · `/vozila/:id` · `/vozila/:id/:tab` | Lista · Detalj (tabovi: Pregled, Registracije, Osiguranje, Servisi, Gume, Zadaci, Kilometraža, Prilozi, Historija) | `vehicle:view` |
| `/vozila/novo` · `/vozila/:id/uredi` | Forma vozila | `vehicle:create` / `vehicle:update` |
| `/vozaci` · `/vozaci/:id` | Vozači | `driver:view` |
| `/zadaci` · `/zadaci/:id` | Lista/kanban · Detalj zadatka | `task:view` |
| `/zadaci/novi` | Wizard | `task:create` |
| `/servisi` · `/gume` · `/rokovi` | Liste | odgovarajuće |
| `/izvjestaji` · `/izvjestaji/:code` | Izvještaji · Download centar | `report:view` |
| `/forme` (`?forma=&verzija=`) | Form Builder: katalog + verzije + editor | `form:view` / `manage_schema` |
| `/korisnici` · `/korisnici/:id` | Korisnici | `user:view` |
| `/prava` | Matrica prava | `role:view` |
| `/postavke` · `/postavke/sifarnici` | Postavke | `settings:view` |
| `/audit` | Audit log | `audit:view` |
| `/sistem` | Zdravlje, queue, metrike | `system:view_health` |
| `/obavijesti` | Centar obavijesti | `notification:view` |
| `/profil` | Profil, sesije, lozinka (bez 2FA — R-05) | `auth:login` |
| `*` | 404 | — |

---

## 5. Dizajn sistem

### 5.1 Boje (CSS varijable, light/dark)

| Token | Light | Dark | Upotreba |
|---|---|---|---|
| `--primary` | `#2563EB` | `#60A5FA` | Glavne akcije, linkovi, fokus |
| `--primary-fg` | `#FFFFFF` | `#0B1220` | Tekst na primary |
| `--bg` | `#F8FAFC` | `#0B1220` | Pozadina aplikacije |
| `--surface` | `#FFFFFF` | `#111A2E` | Kartice, paneli |
| `--surface-2` | `#F1F5F9` | `#182338` | Hover, tabele header |
| `--border` | `#E2E8F0` | `#24304A` | Obrubi |
| `--fg` | `#0F172A` | `#E6EDF7` | Primarni tekst |
| `--fg-muted` | `#64748B` | `#94A3B8` | Sekundarni tekst |
| `--success` | `#16A34A` | `#4ADE80` | Završeno, važeće, „Aktivno" |
| `--info` | `#0EA5E9` | `#38BDF8` | U toku, informativno |
| `--warning` | `#D97706` | `#FBBF24` | Rok ≤ 7 dana, upozorenje |
| `--danger` | `#DC2626` | `#F87171` | Isteklo, greška, destrukcija |
| `--neutral` | `#64748B` | `#94A3B8` | Otkazano, arhivirano |

**Semantika rokova (ključno za domenu):**

| Stanje | Boja | Badge |
|---|---|---|
| Važeće, > 30 dana | `--success` | „Važeće" |
| 30–8 dana | `--info` | „Još {n} dana" |
| 7–1 dan | `--warning` | „Ističe za {n} dana" |
| Danas / prekoračeno ≤ 0 | `--danger` | **„Isteklo"** + ikona upozorenja |
| Nepoznato / nema zapisa | `--neutral` | „Nema podataka" |

Pragove (30/7) definiše Super Admin u Postavkama — UI ih čita, ne hardkodira.

### 5.2 Tipografija

- **Font:** Inter (latinica, uklj. `š č ć ž đ`), fallback sistemski; `font-feature-settings: "cv05","ss01"`.
- **Brojevi:** `tabular-nums` za kilometražu, iznose, datume (poravnanje u tabelama).
- Skala: `xs 12/16` · `sm 13/20` · `base 14/20` · `md 16/24` · `lg 18/28` · `xl 20/28` ·
  `2xl 24/32` · `3xl 30/36`. Težine: 400, 500, 600, 700.
- Mobilna: `base 16/24` (sprječava iOS zoom na input focus), dugmad 16/600.

### 5.3 Prostor, oblici, sjene

- Grid: 4 px; razmaci `4/8/12/16/24/32/48`; padding kartice 16 (mobilna 12/16).
- Radius: `sm 6` · `md 8` · `lg 12` · `xl 16` · `full 9999`.
- Sjene: `xs` (kartice), `sm` (dropdown), `md` (modal), `lg` (drawer). U dark temi sjene
  zamjenjuje `--border` + blagi `ring`.
- Breakpointi: `<640` mobilna · `640–1023` tablet (sidebar sklopljen) · `≥1024` desktop ·
  `≥1440` široki (tabela s više kolona).

### 5.4 Komponente (shadcn/ui + naše)

| Naša komponenta | Opis |
|---|---|
| `<StatusBadge status="IN_PROGRESS"/>` | Boja + tekst na bosanskom iz zajedničkog mapiranja |
| `<DuePill date="2026-11-02" kind="registration"/>` | Rok s bojom i „preostalo dana" |
| `<DataTable>` | Server-side paging/sort/filter, sticky header, column visibility, bulk select, skeleton loading, empty state |
| `<FilterBar>` | Čipovi aktivnih filtera + „Očisti sve" + sačuvani prikazi |
| `<EntityTabs>` | Tabovi profila vozila s brojačima (`Registracije (4)`) |
| `<Timeline>` | Historija zapisa / `TaskEvent` tok |
| `<StatCard>` | KPI (vrijednost, delta, sparkline) |
| `<DeadlineList>` | Lista rokova s akcijom |
| `<PermissionMatrix>` | Redovi = modul/akcija, kolone = role, ćelije = dozvoljeno + scope; diff prije snimanja |
| `<FormBuilderCanvas>` / `<FieldPalette>` / `<FieldInspector>` | Form Builder |
| `<DynamicForm>` | Renderer iz `@vfm/form-renderer` (isti na web i mobilnoj) |
| `<UploadDropzone>` / `<PhotoCaptureSheet>` | Upload s progress-om, retry, preview, validacijom |
| `<ConfirmDialog variant="danger">` | Potvrda s ispisom posljedica |
| `<EmptyState>` | Ilustracija + poruka + primarna akcija |
| `<ErrorState>` | `requestId`, poruka na bosanskom, „Pokušaj ponovo" |
| `<NotificationBell>` / `<CommandPalette>` | Badge + lista; `⌘K` pretraga |

### 5.5 Statusi → boje i tekst (jedinstveno web/mobilna)

| Entitet | Status | Tekst | Boja |
|---|---|---|---|
| Zadatak | `OPEN` | Slobodan | info |
| | `IN_PROGRESS` | U toku | warning |
| | `COMPLETED` | Završen | success |
| | `CANCELLED` | Otkazan | neutral |
| Vozilo | `ACTIVE` | Aktivno | success |
| | `IN_SERVICE` | U servisu | warning |
| | `INACTIVE` | Neaktivno | neutral |
| | `DAMAGED` | Oštećeno | danger |
| | `ARCHIVED` | Arhivirano | neutral |
| Zapis (reg./osig.) | `ACTIVE` | Važeće | success |
| | `EXPIRED` | Isteklo | danger |
| | `DRAFT` | Nacrt | neutral |
| Forma | `DRAFT` | Nacrt | neutral |
| | `PUBLISHED` | Objavljena | success |
| | `RETIRED` | Povučena | neutral |
| Gume | `MOUNTED` | Montirano | success |
| | `IN_STOCK` | Na skladištu | info |
| | `RETIRED` | Izvan upotrebe | neutral |

Lista zadataka (W09) koristi ove iste `taskStatus`/`taskPriority` oznake iz `@vfm/shared`; stanje dugmeta „Preuzmi" mijenja se tek nakon uspješnog serverskog claim-a.

### 5.6 Ikone

Lucide, 16/20/24 px, `stroke-width 1.75`. Ikona uvijek **uz** tekst (nikad sama bez `aria-label`).
Domen-ikone: vozilo `car`, zadatak `clipboard-list`, guma `circle-dot`, servis `wrench`,
registracija `file-badge`, osiguranje `shield-check`, gorivo `fuel`, rok `calendar-clock`,
obavijest `bell`, prava `key-round`, forma `layout-template`, audit `history`.

---

## 6. Pristupačnost i lokalizacija

- Kontrast teksta ≥ 4.5:1 (AA), veliki tekst ≥ 3:1; statusne boje **nikad** kao jedini indikator
  (uvijek + tekst/ikona).
- Tastatura: potpun focus redoslijed, vidljiv `:focus-visible` ring (2 px `--primary`), skip link,
  `Esc` zatvara modal/drawer, `⌘K` otvara paletu.
- ARIA: `aria-live="polite"` za toast/obavijesti, `role="status"` za async akcije, `aria-invalid` +
  `aria-describedby` za greške polja, tabele s `scope`/`caption`.
- Forme: labela iznad polja, `helpText` ispod, greška ispod help teksta (crveno + ikona), sažetak
  grešaka na vrhu forme s linkovima na polja.
- `prefers-reduced-motion`: bez animacija prelaza; skeleton umjesto spinnera gdje je moguće.
- Mobilna: touch ≥ 44×44 (primarno 48), razmak između dugmadi ≥ 8 px, `TextInput` s odgovarajućim
  `keyboardType` (numeric za km, decimal za iznose), podrška za sistemski font scale do 1.3×.
- **Lokalizacija:** `dd.MM.yyyy`, `dd.MM.yyyy HH:mm` (24 h, `Europe/Sarajevo`), `1.234,56 KM`,
  relativno vrijeme („prije 12 min", „za 3 dana"), pluralizacija po bosanskoj gramatici
  (`1 dan / 2 dana / 5 dana`), UTF-8 (`š č ć ž đ`).

---

## 7. Wireframe-ovi — web

### 7.1 Prijava

```
┌───────────────────────────────┬───────────────────────────────────────┐
│                               │                                       │
│   🚗  Vozni park              │      Prijavi se                       │
│   Sistem za upravljanje       │      ┌─────────────────────────────┐  │
│   službenim voznim parkom     │      │ E-mail                      │  │
│                               │      │ amira@example.ba            │  │
│   • 10 vozila                 │      └─────────────────────────────┘  │
│   • rokovi pod kontrolom      │      ┌─────────────────────────────┐  │
│   • zadaci i izvršioci        │      │ Lozinka            👁        │  │
│                               │      └─────────────────────────────┘  │
│                               │      ☐ Zapamti ovaj uređaj            │
│                               │      [        Prijavi se        ]     │
│                               │      Zaboravili ste lozinku?          │
│                               │                                       │
│                               │      ⚠️ Mobilna aplikacija nije       │
│                               │         dostupna za Super Admin       │
└───────────────────────────────┴───────────────────────────────────────┘
```

### 7.2 Nadzorna ploča

```
┌ Nadzorna ploča                                    Period: [Oktobar 2026 ▾] ┐
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│ │ Aktivna     │ │ Istekli    │ │ Otvoreni   │ │ Troškovi   │               │
│ │ vozila      │ │ rokovi     │ │ zadaci     │ │ (mjesec)   │               │
│ │     9/10    │ │   ▲ 2      │ │     7      │ │ 1.284,50 KM│               │
│ └────────────┘ └────────────┘ └────────────┘ └────────────┘               │
│                                                                             │
│ ⚠ Rokovi (5)                                                   [Svi rokovi]│
│ ┌─────────────────────────────────────────────────────────────────────────┐│
│ │ ● V-004  Registracija            Isteklo prije 2 dana      [Obnovi]     ││
│ │ ● V-007  Osiguranje              Ističe za 3 dana          [Obnovi]     ││
│ │ ● A. Kovačević  Dozvola (C)      Ističe za 21 dan          [Detalji]    ││
│ │ ● V-002  Servis (22.500 km)      Za 320 km                 [Zakaži]     ││
│ └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│ Otvoreni zadaci (7)                                            [Svi zadaci] │
│ ┌──────────────────────────────┬──────────────────────────────────────────┐│
│ │ Slobodni (3)                 │ U toku (4)                               ││
│ │ ▸ Pranje V-003   · 2 pozvana │ ▸ Gorivo V-001 · Emina   · 45 min       ││
│ │ ▸ Gume V-006     · hitno     │ ▸ Servis V-009 · Adnan   · 2 h          ││
│ │ ▸ Tehnički V-010 · danas     │ ▸ Pranje V-002 · Emina   · 10 min       ││
│ └──────────────────────────────┴──────────────────────────────────────────┘│
│ Troškovi po mjesecu ▁▂▃▅▂▇▄▆   │ Zadaci po tipu: pranje 42%, gorivo 23%… │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Lista vozila (DataTable)

```
┌ Vozila                                            [+ Novo vozilo] [Izvoz ▾] ┐
│ [Pretraga: broj, marka, model, tablice…]  Status▾  Gorivo▾  Rok▾  [Više] │
│ Aktivni filteri: ✕ Status: Aktivno  ✕ Gorivo: Dizel        Očisti sve     │
│ ┌────┬────────┬──────────────┬─────────┬──────────┬───────────┬──────────┐│
│ │ ☐  │ Broj   │ Marka/Model  │ Tablica │ Km       │ Registr.  │ ⋯        ││
│ ├────┼────────┼──────────────┼─────────┼──────────┼───────────┼──────────┤│
│ │ ☐  │ V-003  │ Škoda Octavia│ A12-K-45│ 148.230  │ ●Još 214 d│ ⋯        ││
│ │ ☐  │ V-004  │ VW Passat    │ E23-M-18│ 210.880  │ ●Isteklo  │ ⋯        ││
│ │ ☐  │ V-007  │ Ford Transit │ T07-S-02│  96.410  │ ●Za 3 d   │ ⋯        ││
│ └────┴────────┴──────────────┴─────────┴──────────┴───────────┴──────────┘│
│ 3 odabrana  [Arhiviraj] [Dodijeli vozača] [Izvezi odabrano]                │
│                                                    ◀ 1 2 3 ▶  20 po strani │
└─────────────────────────────────────────────────────────────────────────────┘
```
`⋯` meni: Detalji, Uredi, Dodaj registraciju, Dodaj servis, Gume, Historija, Arhiviraj (samo s
pravom; nedozvoljene stavke se **ne prikazuju**).

### 7.4 Profil vozila

```
┌ Vozila / V-003                                                             ┐
│ Škoda Octavia 2.0 TDI · 2019 · Dizel · A12-K-45          Status: Aktivno ▾ │
│ VIN: TMBAG…  Interni broj: V-003  Km: 148.230 (12.10.2026)                 │
│ Registracija: ●Još 214 dana   Osiguranje: ●Još 96 dana   Servis: za 1.770 km│
│ [Uredi] [+ Registracija] [+ Servis] [Gume] [Zadaci] [⋯]                    │
├────────────────────────────────────────────────────────────────────────────┤
│ Pregled | Registracije (4) | Osiguranje (3) | Servisi (7) | Gume (2) |     │
│ Zadaci (23) | Kilometraža (148) | Prilozi (12) | Historija                 │
├────────────────────────────────────────────────────────────────────────────┤
│ ▸ Registracije                                                             │
│   ┌─────────────┬────────────┬────────────┬───────────┬────────┬─────────┐ │
│   │ Tablica     │ Vrijedi od │ Vrijedi do │ Trošak    │ Status │ Forma   │ │
│   │ A12-K-45    │ 15.05.2026 │ 15.05.2027 │ 412,00 KM │ Važeće │ v3      │ │
│   │ A12-K-45    │ 14.05.2025 │ 14.05.2026 │ 398,50 KM │ Isteklo│ v2      │ │
│   └─────────────┴────────────┴────────────┴───────────┴────────┴─────────┘ │
│   ⓘ Svaki zapis prikazuje verziju forme kojom je nastao (klik = detalji)   │
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.5 Lista i detalj zadatka

```
┌ Zadaci                                        [+ Novi zadatak] [Izvoz ▾]   ┐
│ [Svi ▾: Slobodni · U toku · Završeni · Otkazani]  Vozilo▾ Tip▾ Izvršilac▾ │
│ ┌────────────┬────────┬───────────┬──────────┬──────────┬────────┬───────┐│
│ │ Kod        │ Vozilo │ Tip       │ Izvršilac│ Rok      │ Status │ ⋯     ││
│ │ Z-2026-118 │ V-003  │ Pranje    │ —        │ danas    │Slobodan│ ⋯     ││
│ │ Z-2026-117 │ V-001  │ Gorivo    │ Emina H. │ —        │ U toku │ ⋯     ││
│ │ Z-2026-116 │ V-009  │ Servis    │ Adnan K. │ 21.10.   │ U toku │ ⋯     ││
│ └────────────┴────────┴───────────┴──────────┴──────────┴────────┴───────┘│
└───────────────────────────────────────────────────────────────────────────┘

┌ Zadaci / Z-2026-118                                                        ┐
│ Pranje vozila · V-003 Škoda Octavia          Prioritet: Normalno ▾         │
│ Status: Slobodan   Kreirao: Damir M. 19.10.2026 08:12   Rok: danas 18:00  │
│ Pozvani: (Emina H.) (Adnan K.)    Izvršilac: —                             │
│ [Preuzmi zadatak]   [Dodijeli ▾]   [Uredi]   [Otkaži]                      │
├────────────────────────────────────────────────────────────────────────────┤
│ Detalji | Forma (v3) | Prilozi (0) | Komentari (2) | Historija (5)         │
│ ── Historija ──────────────────────────────────────────────────────────── │
│  08:12  Kreiran                       Damir M.       (mobilna)            │
│  08:12  Pozvani: Emina H., Adnan K.   Damir M.                             │
│  08:12  Obavijest poslana (2/2)       sistem                               │
│  09:03  Komentar: „Treba i felge"     Adnan K.                             │
└───────────────────────────────────────────────────────────────────────────┘
```

### 7.6 Matrica prava (Role i prava)

```
┌ Role i prava                              [+ Nova rola] [Uvoz/Izvoz matrice]┐
│ Uređuje se: ● ADMINISTRATOR   (Sistem role: SUPER_ADMIN 🔒)                │
│ [Pretraga permisija…]   Moduli: ☑ svi  ☐ samo bez prava                   │
│ ┌───────────────────────────────┬──────┬──────┬──────┬──────┬─────────────┐│
│ │ Modul / akcija                │ SA   │ ADMIN│ KORIS│ Vozač│ Opseg       ││
│ ├───────────────────────────────┼──────┼──────┼──────┼──────┼─────────────┤│
│ │ Vozila · pregled              │  ✓   │  ✓   │  ✓   │  ✓   │ Svi / Svi ▾ ││
│ │ Vozila · kreiranje            │  ✓   │  ✓   │  —   │  —   │             ││
│ │ Vozila · uređivanje           │  ✓   │  ✓   │  —   │  —   │             ││
│ │ Vozila · brisanje             │  ✓   │  —   │  —   │  —   │             ││
│ │ Zadaci · preuzimanje          │  ✓   │  —   │  ✓   │  ✓   │ Svi         ││
│ │ Zadaci · završetak (override) │  ✓   │  —   │  —   │  —   │  ⚠ osjetljivo││
│ │ Vozači · lični podaci         │  ✓   │  —   │  —   │  —   │  ⚠ PII      ││
│ └───────────────────────────────┴──────┴──────┴──────┴──────┴─────────────┘│
│ Izmjene (3):  + Vozači·kreiranje (ADMIN)  − Zadaci·otkazivanje (ADMIN) …   │
│                        [Odustani]   [Sačuvaj izmjene]  ← diff prije snimanja│
└─────────────────────────────────────────────────────────────────────────────┘
```
Snimanje traži potvrdu i upisuje audit diff; banner: „Promjena prava primjenjuje se u roku od
nekoliko sekundi — aktivne sesije će dobiti nova prava bez ponovne prijave."

### 7.7 Form Builder

```
┌ Forme / Zadatak: Pranje vozila / Verzija 3 (nacrt)     [Preview] [Objavi…] ┐
│ ┌ Paleta polja ┐ ┌ Canvas (Web ▾ / Mobilni) ─────┐ ┌ Svojstva ───────────┐│
│ │ Tekst        │ │ ▣ Sekcija: Osnovni podaci     │ │ Ključ: washType     ││
│ │ Dugi tekst   │ │   ◉ Vrsta pranja *            │ │ Tip: Jedan izbor    ││
│ │ Cijeli broj  │ │   ▭ Trajanje (min)            │ │ Labela: Vrsta pranja││
│ │ Decimalni    │ │   ▭ Trošak pranja             │ │ Obavezno: ☑         ││
│ │ Datum        │ │   📷 Fotografije nakon *      │ │ Opcije (STATIC):    ││
│ │ Datum/vrijeme│ │ ▣ Sekcija: Obračun            │ │  EXTERNAL Vanjsko   ││
│ │ Da/Ne        │ │   ƒ Cijena po minuti (auto)   │ │  INTERNAL Unutrašnje││
│ │ Jedan izbor  │ │                               │ │  FULL Kompletno     ││
│ │ Više izbora  │ │ ⠿ povuci za promjenu reda    │ │ Vidljivo kada:      ││
│ │ Padajuća     │ │                               │ │  washType ∈ {EXT,   ││
│ │ Novčani iznos│ │                               │ │  FULL}   [Uredi…]   ││
│ │ Fotografija  │ │                               │ │ Pomoćni tekst: …    ││
│ │ Prilog       │ │                               │ │ ── Validacije ──    ││
│ │ Referenca    │ │                               │ │ min/max, pattern    ││
│ │ Sekcija      │ │                               │ │ Normalizacija:      ││
│ │ Izračun      │ │                               │ │  → totalCost (KM)   ││
│ └──────────────┘ └───────────────────────────────┘ └─────────────────────┘│
│ Provjera sheme: ✔ 10/10   ⚠ 0   ✖ 0        [Prikaži JSON] [Uporedi s v2] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.8 Audit log

```
┌ Audit log                                                    [Izvoz]       ┐
│ Od [01.10.2026] Do [19.10.2026]  Akcija▾ Korisnik▾ Entitet▾ Ozbiljnost▾   │
│ ┌──────────┬──────────────┬────────────┬───────────────┬──────────────────┐│
│ │ Vrijeme  │ Korisnik     │ Akcija     │ Entitet       │ Promjene         ││
│ │ 09:41:22 │ Damir M.     │ CLAIM      │ Z-2026-118    │ → detalj/diff    ││
│ │ 09:12:03 │ Amira A.     │ PERM_CHANGE│ Rola ADMIN    │ 3 izmjene        ││
│ │ 08:58:44 │ sistem       │ LOGIN_FAILED│ —            │ ⚠ SECURITY       ││
│ └──────────┴──────────────┴────────────┴───────────────┴──────────────────┘│
│ Detalj: before/after diff po polju, requestId, IP, UA, clientType          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.9 Izvještaji

```
┌ Izvještaji                                                                 ┐
│ [Po vozilu ▾]  Vozilo: V-003 ▾  Period: 01.01.–19.10.2026  Kategorije: ☑…  │
│ [Prikaži]                                            [PDF] [Excel] [Sačuvaj]│
│ ┌──────────────────────────────────────────────────────────────────────────┐│
│ │ Ukupni troškovi: 2.431,80 KM   ·  Servisi 1.812,00  ·  Registracija 812  ││
│ │ Registracije: 4 perioda │ Osiguranje: 3 │ Servisi: 7 │ Gume: 2 ciklusa    ││
│ │ Zadaci: 23 (pranje 12, gorivo 8, servis 3) │ Km: 148.230 (+12.400)       ││
│ └──────────────────────────────────────────────────────────────────────────┘│
│ ⓘ Izvoz iznad 5.000 redova ide u pozadini → „Download centar" (traje 7 dana)│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.10 Stanja ekrana (obavezno dizajnirati, ne preskočiti)

| Stanje | Web | Mobilna |
|---|---|---|
| Učitavanje | Skeleton (oblik tabele/kartice), ne spinner | Skeleton liste |
| Prazno | Ilustracija + tekst + akcija („Još nema vozila → Dodaj prvo vozilo") | Isto, compact |
| Bez prava | „Nemate pristup ovom dijelu." + „Zatraži pristup" (e-mail adminu) | Isto |
| Greška 500 | Poruka + `requestId` + „Pokušaj ponovo" | Isto + offline provjera |
| 403 | „Nemate pravo za ovu akciju." + koja permisija nedostaje (za admine) | Isto |
| 409 (claim) | — | Dijalog: „Zadatak je preuzeo {ime} {vrijeme}" |
| Offline | Banner „Nema veze — podaci mogu biti zastarjeli" | Banner + onemogućene akcije pisanja, keširano čitanje |
| Istekla sesija | Modal „Sesija je istekla — Prijavi se ponovo" (čuva trenutnu rutu) | Auto-refresh ili login |

---

## 8. Wireframe-ovi — mobilna (360×800)

### 8.1 Lista zadataka (default tab)

```
┌──────────────────────────────┐
│ ☰  Zadaci            🔔 3   │
│ ────────────────────────────│
│ (Slobodni 3)(Moji 2)(Svi 12)│   ← segmentirana kontrola
│ ────────────────────────────│
│ ┌──────────────────────────┐ │
│ │ Pranje vozila        ●Slobodno│
│ │ V-003 Škoda Octavia      │ │
│ │ 📍 Danas 18:00 · 👥 2    │ │
│ │ [        Preuzmi       ] │ │   ← 48 px, primary
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Dopuna goriva   ●Preuzeo │ │
│ │ V-001 Golf · Emina H.    │ │
│ │ prije 12 min             │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Servis          ●U toku  │ │
│ │ V-009 · Tvoj zadatak     │ │
│ │ [      Nastavi →       ] │ │
│ └──────────────────────────┘ │
│                              │
│                     ( ＋ )   │   ← FAB: Novi zadatak (ako ima pravo)
│ ────────────────────────────│
│ Zadaci · Vozila · ＋ · 🔔 · 👤│
└──────────────────────────────┘
```

### 8.2 Detalj zadatka

```
┌──────────────────────────────┐
│ ←  Z-2026-118          ⋯    │
│ Pranje vozila                │
│ ● Slobodan · Prioritet: norm.│
│ ────────────────────────────│
│ 🚗 V-003 Škoda Octavia       │
│    A12-K-45 · 148.230 km     │
│ 🕒 Rok: danas 18:00          │
│ 👤 Kreirao: Damir M. 08:12   │
│ 👥 Pozvani: Emina H., Adnan  │
│ ────────────────────────────│
│ Opis: Vanjsko i unutrašnje   │
│ pranje, uključujući felge.   │
│ ────────────────────────────│
│ [ Pregledaj vozilo ]         │
│ ┌──────────────────────────┐ │
│ │      PREUZMI ZADATAK     │ │   ← sticky, 56 px
│ └──────────────────────────┘ │
└──────────────────────────────┘
```
Nakon `409`: dijalog s porukom „Zadatak je preuzeo **Emina H.** prije 12 min" + dugmad
„Nazad na listu" / „Osvježi".

### 8.3 Završetak zadatka (dinamička forma)

```
┌──────────────────────────────┐
│ ←  Završi zadatak      ⋯    │
│ Pranje vozila · V-003        │
│ Forma: v3                    │
│ ────────────────────────────│
│ Vrsta pranja *               │
│ ( ○ Vanjsko  ● Kompletno )   │
│ ( ○ Unutrašnje )             │
│ ────────────────────────────│
│ Trajanje (min)               │
│ [  45   ]  − +               │
│ ────────────────────────────│
│ Fotografije nakon *          │
│ ┌────┐ ┌────┐ ┌────┐        │
│ │ 📷 │ │ 🖼 │ │ ＋ │        │   ← kamera / galerija
│ └────┘ └────┘ └────┘        │
│ ⓘ Min. 1, max 4 · do 10 MB   │
│ ────────────────────────────│
│ Kilometraža                  │
│ [148230]  (posljednje: 148.230)│
│ ⚠ Mora biti ≥ posljednjeg     │
│ ────────────────────────────│
│ Komentar                     │
│ [________________________]   │
│ ┌──────────────────────────┐ │
│ │      POTVRDI ZAVRŠETAK   │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### 8.4 Novi zadatak (3 koraka, progress bar)

```
┌──────────────────────────────┐
│ ←  Novi zadatak   Korak 2/3  │
│ ●━━━━━━●━━━━━━○                │
│ ────────────────────────────│
│ Vozilo *                     │
│ [🔍 Pretraži vozila        ] │
│  ▸ V-003 Škoda Octavia   ✓   │
│  ▸ V-001 VW Golf             │
│  ▸ V-009 Ford Transit        │
│ ────────────────────────────│
│ Vrsta zadatka *              │
│  (🧼 Pranje)(⛽ Gorivo)      │
│  (🔧 Servis)(🛞 Gume)        │
│  (📋 Tehnički)(➕ Drugo)     │
│ ────────────────────────────│
│ Prioritet / Rok              │
│  (Normalno ▾)  Rok: [danas ▾]│
│ ────────────────────────────│
│ Pozvani korisnici            │
│  ☑ Emina H.   ☑ Adnan K.     │
│  ☐ Selma B.                  │
│ ┌──────────────────────────┐ │
│ │       DALJE: FORMA →     │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### 8.5 Obavijesti i profil vozila

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ ←  Obavijesti      [Sve ✓]  │   │ ←  Vozila            🔍      │
│ ────────────────────────────│   │ ────────────────────────────│
│ ● Novi zadatak               │   │ [🔍 Broj, marka, tablica ]  │
│   Pranje V-003 · 08:12       │   │ ────────────────────────────│
│ ────────────────────────────│   │ ┌──────────────────────────┐ │
│ ● Zadatak preuzet            │   │ │ V-003 Škoda Octavia    │ │
│   Emina preuzela Z-2026-118  │   │ │ ●Aktivno · 148.230 km  │ │
│   09:41                      │   │ │ Reg. ●Još 214 dana     │ │
│ ────────────────────────────│   │ └──────────────────────────┘ │
│ ○ Rok: registracija          │   │ ┌──────────────────────────┐ │
│   V-007 ističe za 3 dana     │   │ │ V-004 VW Passat        │ │
│   (pročitano)                │   │ │ ●Aktivno · 210.880 km  │ │
│                              │   │ │ Reg. ●ISTEKLO          │ │
│                              │   │ └──────────────────────────┘ │
└──────────────────────────────┘   └──────────────────────────────┘
```

---

## 9. Inventar ekrana

### 9.1 Web (28 ekrana)

| # | Ekran | Faza | Permisija |
|---|---|---|---|
| W1 | Prijava | 1 | javno |
| W2 | Zaboravljena lozinka / reset | 1 | javno |
| W3 | Nadzorna ploča | 3, 7 | `auth:login` |
| W4 | Vozila — lista | 3 | `vehicle:view` |
| W5 | Vozilo — profil (9 tabova) | 3–5 | `vehicle:view` |
| W6 | Vozilo — novo/uredi (dinamička forma) | 3 | `vehicle:create/update` |
| W7 | Vozači — lista | 3 | `driver:view` |
| W8 | Vozač — profil (uklj. kategorije dozvole) | 3 | `driver:view` |
| W9 | Registracije — lista/pregled po vozilima | 3 | `registration:view` |
| W10 | Osiguranje — lista | 3 | `insurance:view` |
| W11 | Servisi — lista + detalj (stavke, prilozi) | 4 | `service:view` |
| W12 | Gume — setovi, pojedinačne, instalacije | 4 | `tire:view` |
| W13 | Zamjena guma (wizard) | 4 | `tire:swap` |
| W14 | Rokovi (kalendar + lista) | 3 | `reminder:view` |
| W15 | Zadaci — lista/kanban | 5 | `task:view` |
| W16 | Zadatak — detalj (forma, prilozi, komentari, historija) | 5 | `task:view` |
| W17 | Novi zadatak (wizard) | 5 | `task:create` |
| W18 | Vrste zadataka | 5 | `task_type:view` |
| W19 | Obavijesti — centar | 5 | `notification:view` |
| W20 | Forme — lista | 2 | `form:view` |
| W21 | Form Builder (editor) | 2 | `form:manage_schema` |
| W22 | Verzije forme — historija/diff | 2 | `form:view` |
| W23 | Migracija zapisa — preview/apply/rollback | 2 | `form:migrate_records` |
| W24 | Korisnici — lista/detalj (sesije, role) | 1 | `user:view` |
| W25 | Role i prava — matrica | 1 | `role:view` |
| W26 | Postavke (globalne, šifarnici, podsjetnici, obavijesti) | 1, 3 | `settings:view` |
| W27 | Audit log | 1 | `audit:view` |
| W28 | Izvještaji + Download centar + Sistem (health/queue) | 7, 8 | `report:view`, `system:view_health` |

**Status (Faza 1, implementirano):**

| Ekran | Ruta | Fajl | Napomena |
|---|---|---|---|
| Prijava (W1) | `/prijava` | `features/auth/login-page.tsx` | javno; poruke grešaka po `code` katalogu |
| Korisnici (W24) | `/administracija/korisnici` | `features/users/users-page.tsx` | lista s paginacijom/filterima, kreiranje (privremena lozinka jednom), reset token, force-logout, arhiviranje |
| Matrica prava (W25) | `/administracija/prava` | `features/roles/matrix-page.tsx` | editor opsega (`—`/`ALL`/`OWN`), čuva samo izmijenjene role; `VEHICLE_IDS`/`DRIVER_IDS` dolaze s Faza 3 |
| Audit log (W27) | `/audit-log` | `features/audit/audit-log-page.tsx` | filteri, paginacija, detalj `before/after`; SECURITY redovi uz `audit:view_security` |
| Profil + sesije | `/profil` | `features/profile/profile-page.tsx` | promjena lozinke (revokuje sesije), lista uređaja, „odjavi sve" |

**Status (Faza 2, implementirano):**

| Ekran | Ruta | Fajl | Napomena |
|---|---|---|---|
| Liste formi (W20) + Builder (W21) + verzije/diff (W22) | `/forme` | `features/forms/forms-page.tsx`, `forms-preview.tsx` | jedna ruta, tri panela: katalog → verzije → editor definicije; meta-shema se provjerava u browseru istim kodom kao na serveru (`@vfm/form-engine/definition`); objava/povlačenje traže bilješku ≥ 5 znakova; `PUBLISHED`/`RETIRED` su read-only (server bi vratio `FORM_VERSION_IMMUTABLE`); diff poziva `GET /form-schemas/:id/diff`; tab **Pregled** renderuje formu kroz `@vfm/form-renderer` (`buildRenderModel`) — isti model koji koristi zapis i mobilna, pa pregled nije odvojen „demo" |
| Migracija zapisa (W23) | — | — | ⏳ odgođeno: u Fazi 2 još nema `FormRecord` zapisa za migraciju; API (`/form-migrations`) je gotov (chunk E) |

**Status (Faza 3, implementirano):**

| Ekran | Ruta | Fajl | Napomena |
|---|---|---|---|
| Nadzorna tabla (W03) | `/nadzorna-tabla` | `features/dashboard/dashboard-page.tsx` | brojevi su `total` sa servera (`pageSize=1`, isti filteri kao ekrani), ne ručno brojanje učitanih redova; kartice: vozila, vozači, registracije/osiguranja/dozvole koje ističu u 30 dana, zakazani podsjetnici; widgeti „Rokovi vozila“ i „Dozvole vozača“ traže samo zapise unutar 30 dana (`expiringInDays`), pa je skup mali i tačan; svaka kartica zavisi od permisije (bez prava nema ni upita) |
| Registracije — lista (W09) | `/registracije` | `features/records/records-list-page.tsx` | svi zapisi s rokovima (do sada su se vidjeli samo unutar profila vozila); filteri `q` (broj), vozilo, status, prozor roka 7/30/365 dana; `expiringInDays` na serveru uključuje samo aktivne zapise, pa se ne kombinuje s drugim statusom; naziv vozila se mapira iz liste vozila (`pageSize=100`, uključujući arhivirana), a boja roka se računa iz `validUntil` istim pragovima kao svuda |
| Osiguranja — lista (W10) | `/osiguranja` | `features/records/records-list-page.tsx` (`kind="INSURANCE"`) | isti ekran, druga vrsta zapisa: `q` pretražuje broj police i kuću, kolone polisa/kuća-vrsta/premija |
| Servisi vozila — pregled (Faza 4) | `/vozila/:vehicleId` → Servisi | `features/services/vehicle-services-tab.tsx` | `service:view` skriva tab i sprečava upit bez prava; server paginacija 25, datum, vrsta/radionica/opis, km, trošak u KM, sljedeći rok datum/km, status; zasebna stanja učitavanja/greške/prazne liste; unos i stavke računa slijede odvojeno |
| Rokovi (W14) | `/rokovi` | `features/reminders/reminders-page.tsx` | lista zakazanih podsjetnika s filterima `status`/`kind`; potvrda (`reminder:acknowledge`) i odgađanje +7 dana (`reminder:snooze`); „Pokreni skener“ traži `system:run_maintenance` i prikazuje `candidates`/`created` (skener je idempotentan preko `dedupeKey`); `dueDate` može biti `null` (podsjetnik po kilometraži) — tada se prikazuje `fireAt`, a boja roka se ne izmišlja |
| Vozila — lista (W05) | `/vozila` | `features/vehicles/vehicles-page.tsx` | filteri `q`/`status`/`includeArchived` idu na server, sortiranje (`internalNo`, `odometerKm`, `registrationExpiresAt`, `insuranceExpiresAt`, `updatedAt`), paginacija; „Rokovi" widget iz iste liste (zeleno/žuto/narandžasto/crveno, pragovi 30/7/0 dana); selekcija + arhiviranje (N zahtjeva, prijava djelimičnog uspjeha) |
| Novo vozilo (W07) | `/vozila/novo` | `features/vehicles/vehicle-create-page.tsx` | strukturirane kolone (interni broj, marka, model, godina, gorivo, VIN) + dinamička `VEHICLE` forma kroz `buildRenderModel`; polja forme koja su već statična se ne dupliraju (`hiddenKeys`); greške servera idu uz tačno polje (`details[].path`, `formData.<key>`); bez objavljene forme ekran kaže zašto zapis ne može nastati (P10) |
| Vozilo — detalji (W06) | `/vozila/:vehicleId` | `features/vehicles/vehicle-detail-page.tsx` | tabovi **Osnovno**, **Registracije**, **Osiguranje**, **Kilometraža**, **Prilozi**; tabovi Servisi/Gume/Zadaci/Historija su označeni fazom (4/5) umjesto prazni; kilometraža: unos + korekcija s razlogom (`422 ODOMETER_REGRESSION`), historija bez brisanja; prilozi se preuzimaju kroz potpisani URL (`/attachments/:id/url`) jer `<a href>` ne nosi access token iz memorije; tabovi Registracije/Osiguranje imaju unos kroz dinamičke forme `REGISTRATION`/`INSURANCE` (`record-form.tsx`) s podrazumijevanim periodom od godinu dana i porukom za `409 PERIOD_OVERLAP`; red ima **Uredi** (`record-edit-form.tsx`): `PATCH` nosi `version` (`409 VERSION_CONFLICT`), prazna opciona polja se šalju kao `null` da se mogu obrisati, status se mijenja samo kroz dozvoljene prelaze, brisanje je soft-delete uz potvrdu |
| Izmjena vozila (W06) | `/vozila/:vehicleId/izmjena` | `features/vehicles/vehicle-edit-page.tsx` | iste strukturirane kolone kao unos (`vehicle-form-config.ts`), ali forma se učitava iz **verzije zapisa** (`formSchemaVersionId`), ne iz aktivne verzije (P10); `PATCH /vehicles/:id` nosi `version`, pa paralelna izmjena daje `409 VERSION_CONFLICT` bez gubljenja unosa; prazna godina/VIN se šalju kao `null` |
| Vozači — lista (W07) | `/vozaci` | `features/drivers/drivers-page.tsx` | filteri `q`/`status`/`licenseCategory`/`includeArchived` idu na server (whitelist sortiranja: `lastName`, `firstName`, `employeeNumber`, `status`, `licenseExpiresAt`, `updatedAt`, `createdAt`), paginacija; PII se **ne** prikazuje; „Dozvole ističu" widget računa dane iz `licenseExpiresAt` (ne iz serverskog `licenseDaysLeft`), pa se lista i widget slažu; bulk arhiviranje šalje N zahtjeva i prijavljuje djelimičan uspjeh |
| Vozač — profil (W08) | `/vozaci/:driverId` | `features/drivers/driver-detail-page.tsx` | PII sekcija (telefon, e-mail, adresa, datum rođenja, broj dozvole) označena je kad server vrati `piiRedacted` (nema `driver:view_pii`); rok dozvole i kategorije nisu PII; tab **Kategorije** ima dodavanje i brisanje (kategorija se ne mijenja — briše se i dodaje), uz `PATCH .../license-categories/:id` za datume; arhiviranje/vraćanje traži `driver:archive` |
| Novi vozač (W08) | `/vozaci/novi` | `features/drivers/driver-create-page.tsx` | iste strukturirane kolone kao API (`firstName`, `lastName`, PII, dozvola) + dinamička `DRIVER` forma kroz `buildRenderModel`; greške servera idu uz tačno polje (`formData.<key>`); bez objavljene forme ekran objašnjava zašto zapis ne može nastati (P10) |

**Status (Faza 4, implementirano):**

| Ekran | Ruta | Fajl | Napomena |
|---|---|---|---|
| Kompleti guma (W12) | `/gume` | `features/tires/tire-sets-page.tsx`, `tire-set-create-form.tsx`, `tire-set-edit-form.tsx`, `tire-set-tires-panel.tsx`, `tire-set-usage-panel.tsx` | server filteri `q`/sezona/status/dostupnost, sortiranje i paginacija; unos uz `tire:create` kroz objavljenu `TIRE_SET` formu; **Korištenje** otvara sažetak i cikluse po vozilima, **Pojedinačne** sastav kompleta i dodavanje guma uz `tire:create`; **Uredi** uz `tire:update` i zapisnu formu, **Obriši** uz `tire:delete` i potvrdu; aktivna montaža linkuje na vozilo i zaključava ručni status/brisanje |
| Montaža i zamjena guma (W13) | `/vozila/:vehicleId` → Gume | `features/tires/vehicle-tires-tab.tsx`, `tire-mount-form.tsx`, `tire-dismount-form.tsx` | montaža uz `tire:mount`, zamjena uz `tire:swap`, demontaža uz `tire:dismount`; izbor samo dostupnih kompleta, pozicije i kilometraža; zamjena je jedna transakcijska potvrda, a konflikt verzije/pozicije/kompleta ostavlja formu otvorenom s porukom servera |

**Status (Faza 5 — prva cjelina, implementirano):**

| Ekran | Ruta | Fajl | Napomena |
|---|---|---|---|
| Lista zadataka (W09) | `/zadaci` | `features/tasks/tasks-page.tsx`, `tasks-model.ts` | segmenti Slobodni/Moji/Svi; server paginacija; claim samo u Slobodni uz `task:claim`, mutation invalidira liste i prikazuje grešku/409 poruku. |
| Detalj zadatka (W09) | `/zadaci/:taskId` | `features/tasks/task-detail-page.tsx`, `task-completion-form.tsx`, `task-status-actions.tsx` | detalji i snapshot forme, učesnici, historija i komentari; Claim samo na `OPEN` uz `task:claim`; završna forma na `IN_PROGRESS` uz `task:complete` ili `task:complete_override`, učitava nepromjenjivi snapshot i šalje CAS verziju; PHOTO/FILE polja uploaduju se preko `attachment:upload` i šalju kao ID-jevi za transakcijsko vezivanje pri završetku; otkazivanje uz obavezni razlog, release na `IN_PROGRESS` i reopen na `COMPLETED/CANCELLED` prikazuju se samo uz odgovarajuću permisiju/status, koriste CAS i nakon odgovora osvježavaju detalj/liste. |
| Novi zadatak (W17) | `/zadaci/novi` | `features/tasks/task-create-page.tsx` | trokorak: aktivna vrsta/vozilo, metapodaci/rok/dodjela, snapshotovana TASK forma i potvrda; poštuje `requiresVehicle`, prioritete vrste i efektivnu objavljenu formu; podržava OPEN_CLAIM/BROADCAST/ASSIGN_DIRECT, pozvane i posmatrače uz `user:view`; PHOTO/FILE fajlovi se prvo uploaduju uz `attachment:upload`, a `POST /tasks` ih u istoj transakciji validira i veže sa `ON_CREATE`; nakon kreiranja otvara detalj. |
| Vrste zadataka (W18) | `/vrste-zadataka` | `features/task-types/task-types-page.tsx`, `task-type-form.tsx`, `task-type-requirements-panel.tsx` | server pretraga, filteri aktivne/vozilo, sortiranje i paginacija; **Nova vrsta** uz `task_type:create`, **Uredi** i editor zahtjeva uz `task_type:update`, **Arhiviraj** uz `task_type:archive`; kod je pri izmjeni zaključan, zadana forma se bira među objavljenim generičkim/vlastitim TASK formama; zahtjevi se uređuju kao cijeli skup i, kad je efektivna forma dostupna, biraju iz njenih polja za unos. |

Sve zaštićene rute idu kroz `RequireAuth` + `RequirePermission` (`app/guards.tsx`);
sidebar filtrira stavke prema `/auth/me` (`visibleNavItems`), ali **server ostaje
autoritet** (P14) — ručni unos URL-a bez prava prikazuje ekran „Nemate pristup"
i ne pokreće nijedan upit. Ostali ekrani su placeholderi s oznakom faze.

### 9.2 Mobilna (11 ekrana)

| # | Ekran | Faza | Permisija | Status |
|---|---|---|---|---|
| M1 | Prijava | 6 | javno | ✅ `apps/mobile/app/(auth)/login.tsx`, refresh token u SecureStore; API odbija Super Admina |
| M2 | Zadaci — moji i slobodni | 6 | `task:view`, `task:claim` | ✅ `apps/mobile/app/(tabs)/tasks.tsx`, segmenti filtrirani po permisijama, online-only i pull-to-refresh |
| M3 | Zadatak — detalj | 6 | `task:view` | ✅ `apps/mobile/app/task/[id].tsx`, metapodaci i snapshot verzije |
| M4 | Preuzimanje | 6 | `task:claim` | ✅ `ON_CLAIM` polja, multipart upload fotografije/priloga, server greške i konflikta |
| M5 | Završetak — dinamička forma + kamera | 6 | `task:complete` | ✅ zajednički `@vfm/form-renderer`, kamera/galerija, kompresija i upload; ✅ REFERENCE vozilo/vozač/zapis (vozilo, vozač, registracija, osiguranje, servis, set guma, montaža guma, zadatak), LIST i svi whitelist QUERY izvori; ⏳ REFERENCE_RECORD za VEHICLE_HANDOVER/OTHER i test na uređaju |
| M6 | Novi zadatak (wizard, 3 koraka) | 6 | `task:create` | ✅ vrsta/vozilo, detalji, snapshot forme, OPEN_CLAIM/BROADCAST/direktna dodjela, pozvani i posmatrači; ✅ LIST, REFERENCE vozilo/vozač/zapis (podržani tipovi) i svi whitelist QUERY izvori; ⏳ REFERENCE_RECORD za VEHICLE_HANDOVER/OTHER i test na uređaju |
| M7 | Vozila — lista | 6 | `vehicle:view` | ✅ `apps/mobile/app/(tabs)/vehicles.tsx`, online lista, pull-to-refresh i statusni pregled |
| M8 | Vozilo — profil (read-only) | 6 | `vehicle:view` | ✅ `apps/mobile/app/vehicle/[id].tsx`, osnovni podaci, VIN i rokovi |
| M9 | Obavijesti — lista + read | 6 | `notification:view`, `notification:mark_read` | ✅ API lista, unread count, pojedinačno i masovno označavanje pročitane; mobilni tab (permission-gated), deep-link zadatak/vozilo i refresh; ⏳ preferences/SSE/FCM i uređajski test |
| M10 | Profil — sesije, lozinka, postavke obavijesti, logout | 6 | `auth:login` | ⚠️ osnovni profil, odjava i obavezna promjena privremene lozinke; sesije/postavke obavijesti nisu dodane |
| M11 | Sistem: offline/greška/403 stanja | 6 | — | ⚠️ mrežna greška i retry; nema uređajskog UAT-a |

---

## 10. Microcopy (bosanski)

| Situacija | Tekst |
|---|---|
| Uspješno snimanje | „Sačuvano." (kratko, bez uskličnika) |
| Zadatak preuzet | „Zadatak je tvoj. Vrijeme preuzimanja: 14:32." |
| Zadatak već preuzet | „Zadatak je preuzeo **Emina H.** prije 12 minuta." |
| Zadatak završen | „Završeno u 14:32 · trajanje 2 h 10 min." |
| Nema prava | „Nemate pravo za ovu radnju. Potreban pristup: *Kreiranje vozila*." |
| Mobilni pristup Super Admina | „Prijava u mobilnu aplikaciju nije dostupna za Super Admin nalog. Koristite web portal." |
| Istekla sesija | „Sesija je istekla. Prijavite se ponovo da nastavite." |
| Greška validacije (općenito) | „Provjerite označena polja ({n})." |
| Greška servera | „Nešto nije u redu na našoj strani. Pokušajte ponovo. (ID zahtjeva: 8f3c…)" |
| Offline | „Nema internet veze. Prikazani podaci su od {vrijeme}." |
| Upload u toku | „Šaljem fotografiju 2/3 · 68 %" |
| Destruktivna potvrda | „Ova radnja je **trajna**. Vozilo V-003 i njegova historija biće arhivirani, ali zapisi ostaju vidljivi u izvještajima. Nastaviti?" |
| Obavezan prilog | „Fotografija je obavezna za ovu vrstu zadatka (min. 1, max 4)." |
| Kilometraža regresija | „Unesena kilometraža je manja od posljednje zabilježene (148.230 km). Ako je očitanje ispravno, označite korekciju i navedite razlog." |
| Rok istekao | „Registracija je istekla prije 2 dana. Vozilo ne smije u saobraćaj." |
| Push (novi zadatak) | naslov: „Novi zadatak: Pranje vozila" · tijelo: „V-003 Škoda Octavia · rok danas 18:00" |
| Push (zadatak preuzet) | „Emina H. je preuzela zadatak Pranje vozila (V-003)." |
| Push (rok) | „Registracija za V-007 ističe za 3 dana." |

**Pravila jezika:** obraćanje na „Vi" (formalno), bez anglicizama gdje postoji domaći izraz
(„Sačuvaj", ne „Spremi"/„Save"), brojevi `1.234,56`, datumi `dd.MM.yyyy`, valuta `KM` iza broja,
vremena u 24-h formatu, izbjegavati pasiv („Sistem je odbio zahtjev" → „Zahtjev je odbijen").

---

## 11. Implementacijske smjernice

1. `apps/web/src/styles/tokens.css` — CSS varijable iz §5.1 (light/dark), Tailwind 4 `@theme`
   mapira tokene (`bg-surface`, `text-fg-muted`, `border-border`).
2. `components/ui/` = shadcn/ui komponente (commit-ovane, ne npm paket) → možemo ih mijenjati.
3. Sve statusne boje/tekstovi iz §5.5 idu u `packages/shared/src/status-labels.ts` (koristi ih i
   mobilna) → nema duplog mapiranja.
4. `packages/form-renderer/web` koristi shadcn komponente; `packages/form-renderer/mobile` koristi
   RN ekvivalente; **isti prop interface** (`schema`, `value`, `errors`, `onChange`, `onUpload`).
5. Tabele: `DataTable` s server-side stanjem; URL je izvor istine za filtere (`?status=OPEN&page=2`)
   → dijeljivi linkovi i back dugme rade.
6. Toast-ovi: `sonner`, max 3 istovremeno, `aria-live="polite"`, auto-dismiss 5 s (greške 8 s).
7. Modal/drawer: `radix` (fokus trap), `Esc` zatvara, potvrde za nesačuvane promjene.
8. Komande: `⌘K` paleta (vozila, zadaci, korisnici, akcije), tastaturne skraćenice za najčešće radnje.
9. Mobilna: `expo-router` layouti, `SafeAreaView`, sticky CTA na dnu, skeleton liste,
   `RefreshControl`, optimistic mutations kroz TanStack Query.
10. Testiranje dizajna: Chromatic/Storybook (opciono) + snapshot testovi `DynamicForm` fixture seta
    (isti fixture za web i mobilnu → garantuje paritet).

### Unos servisa — dopuna Faze 4

Profil vozila → Servisi → **Novi servis** uz `service:create`.
`features/services/service-create-form.tsx` prikazuje osnovna polja i dodatna
polja aktivne SERVICE forme kroz form-renderer (bez ponavljanja osnovnih polja).
Trošak se unosi u KM i šalje kao feninge; opcioni km je cijeli nenegativan broj.
Greške se prikazuju bez brisanja unosa. Nakon uspjeha se osvježavaju servisne
liste, vozilo, lista vozila i očitanja. Otkazivanje ne upisuje ništa.
Stavke računa, izmjena i brisanje servisa još nisu implementirani.

### Stavke računa — dopuna Faze 4

Profil vozila → Servisi → **Stavke** otvara
`features/services/service-items-panel.tsx` (isti ekran profila, bez nove rute).
Pregled uz `service:view`; **Uredi stavke** uz `service:update`.
Korisnik dodaje/uklanja stavke, bira Dio/Rad/Tečnost/Ostalo, unosi naziv,
količinu do dvije decimale, cijenu u KM, šifru i napomenu. Server računa zbir.
Potvrda prije snimanja jasno kaže da zbir zamjenjuje prethodni ukupni trošak,
a prazna lista postavlja nulu. Verzijski konflikt ne briše unos; zatvaranje i
ponovno otvaranje učitava novu verziju. Nakon uspjeha osvježavaju se stavke i
servisna lista. Izmjena osnovnih podataka servisa još nije implementirana.

### Prikaz servisnog računa — vizuelna dorada

Stavke su prikazane u tabeli unutar kartice: naziv/šifra/napomena, vrsta,
količina, jedinična cijena i iznos. Brojevi su desno poravnati, cijene imaju
decimalni zarez i dvije decimale, ukupni sačuvani trošak je izdvojen u zaglavlju.
Na uskom ekranu tabela ima horizontalno pomjeranje umjesto prelamanja iznosa.
Forma koristi zasebne blokove po stavci i prilagodljivi raspored 1/2/3 kolone;
količina/cijena otvaraju decimalnu tastaturu. API ugovor se ne mijenja.

### Potpuna izmjena i brisanje servisa — Faza 4

Profil vozila → Servisi → **Uredi servis** uz `service:update` na aktivnom redu.
`features/services/service-edit-form.tsx` uređuje datum, vrstu, radionicu,
opis, kilometražu servisa te datum/km sljedećeg servisa. Model
`service-edit-model.ts` šalje samo stvarne izmjene; prazna opcionalna polja
šalju se kao `null`, a neispravan datum/kilometraža i obrnuti rokovi odbijaju
se prije zahtjeva. Trošak ostaje u stavkama računa. Forma upozorava da manja
km od trenutne kilometraže vozila zahtijeva zasebnu korekciju. Verzijski
konflikt čuva unos u otvorenoj formi; zatvaranje i ponovno otvaranje učitava
novu verziju. Nakon uspjeha izmjene osvježavaju se servisi, stavke, vozilo,
lista vozila i očitanja kilometraže.

Svaki red uz `service:delete` nudi **Obriši** s potvrdom koja navodi da servis
i stavke nestaju iz aktivne evidencije, da se rokovi vozila ponovo računaju i
da historija kilometraže ostaje. Model `service-delete-model.ts` drži tekst
potvrde/uspjeha i paginaciju nakon brisanja jedinog reda na strani. Greška
se prikazuje iznad tabele bez uklanjanja reda; nakon uspjeha osvježavaju se
servisi, stavke obrisanog zapisa, vozilo i lista vozila.

### Gume vozila — pregled (Faza 4)

`/vozila/:vehicleId` → **Gume**, `features/tires/vehicle-tires-tab.tsx`.
Tab se skriva i ne šalje upit bez `tire:view`. Tabela: komplet i sezona,
status/pozicije, montaža i demontaža (datum/km), korištenje (km/dani),
skladište i razlog. Filter „Samo trenutno montirani kompleti“ vraća stranicu
na 1. Paginacija je serverska po 25. Posebna stanja učitavanja, greške i prazne
liste; nepoznati brojači prikazani su crticom. Aktivni red nudi akcije
zamjene i demontaže prema zasebnim permisijama.

### Kompleti, pojedinačne gume i korištenje — evidencija i životni ciklus (Faza 4)

`/gume`, `features/tires/tire-sets-page.tsx`, uz `RequirePermission(tire:view)`;
dugme **Novi komplet** vidi samo korisnik s `tire:create`, a server ponovo
provjerava pravo. Filteri pretražuju kod, proizvođača, model, dimenziju i
lokaciju te filtriraju sezonu, status i dostupnost za montažu. Sortiranje je
ograničeno na kod, proizvođača, nabavku i datum unosa; paginacija je serverska
po 25. Tabela prikazuje sezonu/status, broj guma, datum i cijenu nabavke,
lokaciju ili link na vozilo aktivne montaže te napomenu.

Unos (`tire-set-create-form.tsx`) spaja strukturirane podatke s dodatnim
poljima aktivne objavljene `TIRE_SET` forme i šalje njenu verziju. Nabavna
cijena se iz KM pretvara u feninge; novi komplet uvijek nastaje kao
„Na skladištu“. Ako objavljena forma ne postoji, ekran to jasno kaže i ne
pokušava snimanje. Montaža se radi iz profila vozila.

Akcija **Uredi** prikazuje se samo uz `tire:update`. Panel
(`tire-set-edit-form.tsx`) učitava `GET /tire-sets/:id` i definiciju
**zapisne** verzije forme, ne trenutno aktivnu. Mijenjaju se strukturirani
podaci, dozvoljeni ručni status i dodatna polja zapisne forme. Ekran šalje
samo stvarne izmjene uz obaveznu verziju zapisa; obrisana opcionalna polja
idu kao `null`. Kod `409 VERSION_CONFLICT` forma ostaje otvorena i unos se
ne gubi — korisnik je zatvara i ponovo otvara da učita novu verziju. Ako
zapis nema formu ili definiciju nije moguće učitati, dostupna su samo
strukturirana polja i `formData` se ne šalje.

Za montiran komplet status je zaključan i objašnjen uz link na vozilo, ali
opisne ispravke ostaju dostupne. **Obriši** se prikazuje samo uz
`tire:delete`, za montiran komplet je onemogućeno, a inače prvo traži
potvrdu s objašnjenjem da je brisanje soft-delete kompleta i povezanih
pojedinačnih guma te da historija montaža ostaje. Nakon izmjene/brisanja
osvježavaju se lista kompleta, detalj i historije montaža.

Akcija **Pojedinačne** dostupna je svima s pravom pregleda ekrana i otvara
panel (`tire-set-tires-panel.tsx`) sa sastavom odabranog kompleta: pozicija i
status, serijski broj/DOT, proizvodnja, dubina profila, nabavka i napomena.
Zaglavlje pokazuje koliko je od deklarisanog broja guma evidentirano. Uz
`tire:create` panel nudi dodavanje jedne po jedne gume; zauzete pozicije se ne
nude, dubina profila se unosi u milimetrima s najviše jednom decimalom, a
cijena u KM. Status se ne bira ručno jer ga server izvodi iz kompleta i
aktivne montaže. Kad je deklarisani broj popunjen, forma se ne prikazuje i
panel upućuje na izmjenu kompleta. Serverska greška ostavlja unos u formi.

Akcija **Korištenje** otvara panel (`tire-set-usage-panel.tsx`) sa šest
sažetnih pokazatelja: ciklusi, pređeni km i dani završenih ciklusa, broj
vozila te prva i posljednja montaža. Slijede tabela agregata po vozilima i
tabela svih ciklusa od najnovijeg, s linkovima na profile vozila, pozicijama,
datumima/km montaže i demontaže te razlogom i skladištem. Aktivan ciklus je
označen kao „U toku“, ali njegovi km i dani ostaju crtice dok se demontažom
ne zaključaju; panel to izričito objašnjava, pa se ukupni brojevi ne mogu
pogrešno pročitati kao procjena trenutnog stanja.

### Montaža, demontaža i zamjena kompleta (Faza 4)

Profil vozila → **Gume** nudi **Montiraj komplet** uz `tire:mount`, a na
aktivnom redu **Zamijeni** (`tire:swap`) i **Demontiraj** (`tire:dismount`).
Arhivirano vozilo ne dobija montažu ni zamjenu, ali aktivni komplet se i dalje
može demontirati da se oslobodi iz evidencije vozila.

Forma montaže pretražuje samo komplete na skladištu bez aktivne montaže,
prikazuje dodatna polja objavljene `TIRE_INSTALLATION` forme te datum,
kilometražu i pozicije. Po izboru kompleta pozicije se predlažu prema broju
guma, a pri zamjeni se prvo nude pozicije starog kompleta. Zamjena dodatno
traži razlog i skladište starog kompleta; jedna potvrda zatvara stari ciklus,
otvara novi i upisuje jedno očitanje kilometraže. Ako server vrati
`409 TIRE_ALREADY_MOUNTED`, `409 VERSION_CONFLICT`, `409 PERIOD_OVERLAP` ili
`422 ODOMETER_REGRESSION`, forma ostaje otvorena i prikazuje serversku poruku.

Demontaža prikazuje datum/km montaže, traži završni datum i kilometražu te
opcionalni razlog i skladište. Nakon uspjeha osvježavaju se historija vozila,
evidencija kompleta i kilometraža u zaglavlju profila.
