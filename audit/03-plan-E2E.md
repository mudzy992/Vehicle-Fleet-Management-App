# 03 — E2E plan: scenariji preko cijelog sistema

## 1. Cilj i preporučeni slojevi

E2E treba potvrditi stvarne granice između UI-a, API-a i baze, bez oslanjanja na demo backend ili ručno pripremljenu produkcijsku bazu.

- **Web:** Playwright, sa stvarnim web UI-jem i API backendom u CI; seed izolovan test tenant/datoteka.
- **API integration:** Vitest/Nest test app + PostgreSQL/Redis servisni kontejneri, migracije i seed iz fixture-a; nema mockovanja Prisma sloja za kritične transakcije.
- **Mobile:** Maestro (Expo/Android) za black-box smoke na emulatoru, API test serverom; device UAT zasebno. Toolchain konačno odobriti nakon provjere CI/Expo kompatibilnosti.
- **Contract:** zod/DTO testovi i generated API response fixtures; ne praviti duplu logiku u testu.

CI treba objaviti test report/artifact, resetovati stanje nakon testa, koristiti determinističke podatke i failovati na test failure. Testove sa eksternim credentials/FCM/GPS providером odvojiti od svakodnevnog CI-a.

## 2. Testni podaci / actor-i

| Actor        | Očekivani pristup                                                                    |
| ------------ | ------------------------------------------------------------------------------------ |
| `admin_all`  | Administrativni pregled; `vehicle:view` sa potvrđenim scopeom `ALL` ostaje dozvoljen |
| `dispatcher` | Kreiranje/dodjela taskova i board akcije prema permission matrix                     |
| `driver_a`   | Vidi samo dodijeljene taskove/vozila; može pokrenuti/završiti svoj zadatak           |
| `driver_b`   | Ne može čitati niti mijenjati task koji nije njemu dodijeljen                        |
| `readonly`   | Samo dozvoljeni read API; write zahtjev mora dobiti 403                              |

Testni grantovi moraju biti eksplicitno navedeni u fixture-u; ne pretpostavljati da rola automatski podrazumijeva permission. Scope se provjerava u API-u i UI-u.

## 3. Prioritetni end-to-end scenariji

### E2E-01 — Prijava, refresh i odjava (P0)

1. Otvoriti web/mobile login sa validnim fixture accountom.
2. Prijaviti se; potvrditi user/session stanje, početni ekran i API status.
3. Obnoviti access token kroz refresh; ponoviti navigaciju/zaštićeni API poziv.
4. Odjaviti se; refresh token više ne radi, zaštićeni ekran vraća login i osjetljivi lokalni token nije dostupan.
5. Ponoviti sa expired/revoked tokenom; UI prikazuje kratku akciju re-login, bez beskonačne retry petlje.

**Pass:** nijedan protected podatak ne ostaje vidljiv nakon logout/revoke; status poruka je jasna.

### E2E-02 — Promjena obavezne i rutinske lozinke (P0)

1. Konto sa `mustChangePassword=true` se prijavi.
2. Login vodi na promjenu lozinke i blokira protected rute dok je ne završi.
3. Stara lozinka nakon promjene ne prolazi; nova prolazi; session rotacija odgovara auth policy-u.
4. Rutinska promjena zahtijeva trenutnu lozinku, odbija slabu/istu lozinku i invalidira/re-validira postojeće sesije po dogovorenoj politici.

**Pass:** UI i API saglasni; audit event postoji bez logovanja lozinke/tokena.

### E2E-03 — Permission + scope enforcement (P0)

1. `admin_all` zatraži vozila: dozvoljen je pregled svih prema potvrđenom `vehicle:view:ALL`.
2. `driver_a` pozove listu i detalj taska za svoj dodijeljeni task.
3. Isti actor mijenja URL/ID na task `driver_b`; API vrati 403/404 prema dogovorenoj anti-enumeration politici, bez payload curenja.
4. `readonly` pokuša mutaciju; API odbije i ne promijeni bazu.
5. UI ne prikazuje nevažeću akciju, ali test pokaže da ručni API zahtjev i dalje biva odbijen.

**Pass:** scope se provodi serverski; nema razlike između list filtera i detail/mutation checka.

### E2E-04 — Task kreiranje, assignment, claim i audit (P0)

1. Dispatcher kreira validan task za konkretno vozilo i po potrebi vozača; API validira status, rok, ownership i obavezna polja.
2. Driver otvori svoj task i vidi tačne podatke; drugi driver ga ne vidi.
3. Dva drivera pokušaju claim istog dostupnog taska paralelno (API integration concurrency test).
4. Tačno jedan pobijedi; drugi dobije predvidiv 409/konflikt; u bazi postoji jedan assignee i jedan konačan audit zapis.
5. Ponovi isti idempotency key nakon timeout/retry; ne nastaje dupli task ili dupli status event.

**Pass:** database invariant potvrđen sa dvije konkurentne transakcije; UI osvježi/poravna stanje.

### E2E-05 — Start, checklist i završetak taska (P0)

1. Dodijeljeni vozač otvori task i eksplicitno izabere „Pokreni“.
2. Status/time transition je validan, dugme se deaktivira dok zahtjev traje; dupli tap ne stvara duple događaje.
3. Popuniti obavezne checklist stavke; opcionalne ostaviti prazne i potvrditi da ih backend ne tretira kao obavezne.
4. Završiti task; provjeriti završni status, vrijeme, audit i board ažuriranje.
5. Pokušati završetak prije starta ili sa obaveznim checklistom nedovršenim; API odbije s razumljivom validacijom.

**Pass:** nema nemogućeg status skoka; prikaz u adminu i driveru eventualno konzistentan u dokumentovanom SLA.

### E2E-06 — Upload fotografije i error/retry (P1)

1. Otvoriti upload na završnom tasku; odbiti camera/photos permission pa provjeriti ručni fallback i uputu.
2. Dodati validan image; server validira MIME, veličinu, filename i access scope.
3. Poslati oversize/nepodržan file; server odbije bez persistiranja.
4. Simulirati prekid mreže, retry iste operacije i timeout; ne stvoriti dupli attachment.
5. Driver bez pristupa ne može dohvatiti URL/datoteku drugog taska.

**Pass:** file permission je vezan za task/actor; nema public URL ili credential u response/logu.

### E2E-07 — Vehicle QR scan (P1; nakon implementacije)

1. Dozvoliti kameru; skenirati QR koji mapira na vozilo kroz API-validated identifier.
2. Potvrditi vozilo prije akcije; QR ne smije direktno izvršiti task mutaciju.
3. Odbiti kameru, skenirati nepoznat/stari QR ili izgubiti mrežu; ručni search/fallback radi.
4. Driver bez `vehicle:view` odgovarajućeg scope-a ne dobija zaštićeni vehicle payload.

**Pass:** QR je identifikator, ne autentikacija i ne prečica oko RBAC-a.

### E2E-08 — Task templates + admin board + matrice (P1; nakon implementacije)

1. Dispatcher iz šablona kreira task; sačuva se snapshot template vrijednosti i validira izmijenjena polja.
2. Board prikazuje dostupni/u toku/završeni; filteri driver/vehicle/status/rok su međusobno kombinabilni.
3. Admin matrica vozilo/zadatak/status/driver i driver workload prikazuju iste podatke kao API; empty/loading/error state su korisni.
4. Paginacija/sort ne duplira ni ne preskače zapise; permission scope ostaje primijenjen na filtere/export.
5. Rok/čekanje/report totals provjeriti sa determinističkim UTC/timezone testnim datumima.

**Pass:** zbirni izvještaji se porede sa direktnim DB fixture count-om i imaju zabilježen timezone.

### E2E-09 — Offline, retry i server error (P1)

1. Pokrenuti list/detail pa prekinuti mrežu; UI pokaže stale/offline stanje uz jasno razlikovanje od praznog rezultata.
2. Mutacija bez potvrde ne označava task kao uspješno promijenjen; retry koristi idempotency i ponovo validira role/scope.
3. Oporavak mreže osvježi query bez duplog POST-a.
4. 401/403/404/409/422/429/5xx prikazuju različite očekivane radnje; request-id ide u diagnostic log, ne u korisnički tekst.

**Pass:** nema tihog gubitka ili lažne potvrde uspjeha.

### E2E-10 — GPS privacy (P1 prije implementacije lokacije)

1. Bez dodijeljenog taska, lokacija se ne traži niti šalje.
2. Task dodijeljen, ali nije eksplicitno pokrenut: nema lokacijskog streama.
3. Driver pritisne Start; dobije jasnu obavijest/indikator i tek tada se traži OS permission i šalje task-scoped lokacija.
4. Permission denied / approximate location / background denied ne blokira sigurno obavljanje taska; nema tihe fallback telemetrije.
5. Complete/cancel/release/stop tracking prekida watcher i server ingest; ponovni start traži novu eksplicitnu potvrdu prema privacy policy-u.
6. Drugi vozač nema pristup podacima; admin pristup je ograničen i auditovan; retention purge briše podatke po definisanom roku.

**Pass:** nakon stop-a nema nove koordinate; ne postoji endpoint za vehicle/fleet tracking.

### E2E-11 — Web/mobile responsive, accessibility i build (P1)

1. Web smoke na desktop, tablet, narrow mobile viewport; nema horizontal overflow ni izgubljenih primary akcija.
2. Tastatura: tab/focus/escape/dialog; screen reader labels za task status, controls i QR permission.
3. Native emulator: portrait, safe-area, keyboard, app background/resume i rotation policy.
4. Large text/reduced motion/contrast; status nikad nije prikazan samo bojom.
5. Test dati screenshot artifact na ključnim ekranima; snapshot update traži review.

## 4. Release gate

- P0 testovi prolaze u CI uz DB/Redis; nijedan flaky test se ne maskira retry-jem bez ownera i issue-a.
- Nema E2E skip-a za obavezne featuree; opcionalni skip ima eksplicitan razlog.
- Test data izolovan i očišćen; produkcijski secret/FCM project se ne koriste.
- P1 testovi task templates, QR, matrices i GPS pokreću se tek nakon implementacije; ne prikazivati ih kao postojeći feature.
- Ručni mobile UAT na Android uređaju/emulatoru je odvojen od E2E pass-a.
