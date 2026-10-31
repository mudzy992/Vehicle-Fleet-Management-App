# Changelog — task-order-realization

## 2026-10-31

- Detalj zadatka (web + mobile) prikazuje REALIZATION read-only nakon complete, uključujući PHOTO/FILE.
- Zašto: izvršilac je unosio fotografiju pri realizaciji, a UI je zadržao samo nalog (`orderFormData`).

## 2026-10-30

- Inicijalna matrica: dvije TASK forme po vrsti (ORDER / REALIZATION), dodjela, linked record, legacy complete.
- Razlog: jedna forma je služila i nalogu i realizaciji; OPEN_CLAIM prazna lista nije bila “svi vozači”.
