# Mobilni audit — implementacija

**Slug:** `mobile-audit-impl`  
**Datum:** 30.10.2026.  
**Cilj:** zatvoriti nalaze `audit/11-mobile-*.md` i uskladiti native UX s VFM tokenima (§5/§8), bez ZIP redizajna i bez paljenja produkcijskog `FIREBASE_ENABLED`.

## Faze

1. Temelj: tokeni, primitive, i18n, P1 copy, `(app)` auth guard, split fajlova
2. UX po ekranu: SafeArea, 48 px, badge/pill, skeleton, 409 claim, datumi
3. Forme: jedan FieldControl, lookup greške, HANDOVER/OTHER copy
4. Obavijesti: preferences, FCM no-op, badge, deep-link
5. Maestro + dokumentacija
6. Typecheck / token check + UAT checklist za vlasnika

## Van opsega

iOS, GPS, offline queue, ZIP replika, handover CRUD, `FIREBASE_ENABLED=true` na hostu.
