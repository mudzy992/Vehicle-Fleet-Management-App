# 07 — GPS privatnost i acceptance guardrails

## Ograničenje proizvoda

Lokacija je vezana isključivo za **konkretnog dodijeljenog vozača i konkretan zadatak**. Uređaj šalje lokaciju tek nakon što vozač dobije task i eksplicitno ga pokrene. Nema praćenja vozila, fleet-wide GPS mape, telematike, lokacije van zadatka ili prikrivenog background streama.

## Pravila koja moraju biti ispunjena prije razvoja

1. **Explicit opt-in po zadatku:** bez dodijeljenog taska i jasnog Start action-a nema permission prompta, watcher-a ni API eventa.
2. **Vidljivost rada:** jasan tekst i trajna OS-kompatibilna foreground indikacija dok dijeljenje traje; native permission prompt dodatno objašnjava purpose.
3. **Stop je deterministički:** complete, cancel, release/unassign, task stop ili driver sign-out zaustavlja device watcher i server ingest; lifecycle race/retry ne smije ga ponovo pokrenuti bez novog explicit starta.
4. **Samo nužna preciznost/frekvencija:** zabilježiti poslovni razlog i najnižu potrebnu frekvenciju; ne skupljati historiju rute „za svaki slučaj“.
5. **Minimalni pristup:** driver vidi svoj aktivni task; administrativni pregled samo za odobrene role i task scope, svaki pristup auditovati. Nema pristupa drugim driverima po defaultu.
6. **Kratko čuvanje:** retention rok i automatsko brisanje moraju biti dogovoreni prije launch-a; ne ostavljati raw coordinates u običnim logovima, analytics eventima ili crash reportu.
7. **Graceful denial:** permission denied, approximate location, no GPS, battery saver i offline ne smiju prisiljavati vozača; task flow treba imati jasno objašnjenje šta funkcionalno nije dostupno.
8. **Security:** TLS, server-side authz/assignment validation, rate/size validation, audit access, no public unauthenticated read endpoint, no vehicle/fleet query.
9. **Platform policy:** provjeriti Android foreground/background permission policy i store disclosure prije EAS release-a. Ne tražiti background permission ako je foreground toka dovoljan.

## Minimalni state model (prijedlog za review)

`NOT_ELIGIBLE → READY (assigned, not started) → SHARING (explicit start + consent + permission) → STOPPED (complete/cancel/unassign/manual stop/error)`.

- `SHARING` se ne može doseći iz `NOT_ELIGIBLE` ili `READY` bez driver action-a.
- Ponovno pokretanje nakon `STOPPED` je nova eksplicitna akcija i vezana je za validno aktivan task.
- Server ingester odbija coordinate zapis ako task nije dodijeljen tom useru ili nije u stanju koje dozvoljava sharing.
- Lokacijski event mora nositi task id i server timestamp; raw GPS ne smije biti sporedni field u opštem vehicle update-u.

## Release acceptance test

- [ ] Nema geolocation permission prompta prije Start.
- [ ] Nema location eventa prije assignment + Start.
- [ ] Indikacija rada je vidljiva; privacy/retention policy je dostupna vozaču.
- [ ] Complete/cancel/release/manual stop zatvara watcher i zaustavlja nove server writes.
- [ ] Drugi driver i neodobrena rola ne mogu dohvatiti koordinate promjenom task ID-a.
- [ ] API bez validnog assignment/state vrati denial; testiran race sa stopom i in-flight eventom.
- [ ] Retention job briše podatke po odobrenom roku; dokaz brisanja u testu.
- [ ] Logs/analytics/crash report ne sadrže precizne koordinate.
- [ ] Android approximate/denied/offline/battery saver testiran na uređaju/emulatoru.
- [ ] Privacy/security owner je odobrio scope i user-facing notice.
