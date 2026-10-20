-- =============================================================================
--  VFM — dijagnostika stanja baze i oporavak od P3005
-- =============================================================================
--  Kada se koristi:
--    * `prisma migrate deploy` javi **P3005** ("The database schema is not
--      empty"), a `_prisma_migrations` nema redova — tipično nakon ručnog
--      `DROP TABLE _prisma_migrations` dok su objekti migracija ostali u bazi;
--    * deploy padne pa treba utvrditi ŠTA je stvarno primijenjeno;
--    * prije postavljanja `MIGRATIONS_BASELINE` u Coolify (README §E).
--
--  Kako: otvori u pgAdmin-u na bazi `vehicle` i izvrši **sekciju A** (samo čita,
--  ništa ne mijenja). Sekcija B je namjerno zakomentarisana — pokreće se samo
--  svjesnim copy/paste-om.
--
--  Očekivane vrijednosti nakon `0_extensions` + `1_init` + `2_manual`
--  (provjereno na PostgreSQL 16 s `scripts/db-verify/`, 95/95 asertacija):
-- =============================================================================

-- -----------------------------------------------------------------------------
--  A) DIJAGNOSTIKA (read-only)
-- -----------------------------------------------------------------------------

-- A1) Historija migracija. `finished_at IS NULL` = pao pokušaj → treba
--     MIGRATIONS_ROLLED_BACK=<migration_name>. Prazan rezultat + objekti u bazi
--     = P3005 → treba MIGRATIONS_BASELINE (vidi A2–A8 da potvrdiš šta postoji).
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
  FROM _prisma_migrations
 ORDER BY started_at;

-- A2) Ekstenzije (migracija 0_extensions). Očekivano: pgcrypto, citext,
--     btree_gist (+ pg_stat_statements ako je dostupna na serveru).
SELECT extname FROM pg_extension ORDER BY extname;

-- A3) Tabele. Očekivano: 45 (1_init).
SELECT count(*) AS tabela
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- A4) Partial unique indeksi (2_manual). Očekivano: 9.
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public' AND indexname LIKE 'ux\_%'
 ORDER BY indexname;

-- A5) CHECK ograničenja (2_manual). Očekivano: 18.
SELECT conname FROM pg_constraint
 WHERE connamespace = 'public'::regnamespace AND contype = 'c' AND conname LIKE 'ck\_%'
 ORDER BY conname;

-- A6) EXCLUDE ograničenja (2_manual, zahtijeva btree_gist). Očekivano: 2
--     (ex_registration_period_no_overlap, ex_insurance_period_no_overlap).
SELECT conname FROM pg_constraint
 WHERE connamespace = 'public'::regnamespace AND contype = 'x'
 ORDER BY conname;

-- A7) Triggeri (2_manual). Očekivano: 6
--     trg_audit_immutable, trg_task_event_immutable, trg_form_version_immutable,
--     trg_guard_last_super_admin_update|delete|role.
SELECT tgname, tgrelid::regclass::text AS tabela
  FROM pg_trigger
 WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'pg\_%'
 ORDER BY tgname;

-- A8) AuditLog.id mora biti GENERATED ALWAYS AS IDENTITY (2_manual §1).
--     Očekivano: 'a'. Prazan rezultat = tabela AuditLog ne postoji.
SELECT attidentity AS auditlog_identity
  FROM pg_attribute
 WHERE attrelid = 'public."AuditLog"'::regclass AND attname = 'id';

-- A9) FK-ovi s NEUSKLAĐENIM tipovima. Očekivano: 0 redova (upravo ova greška je
--     srušila prvi deploy: Attachment.uploadedById TEXT → User.id UUID).
SELECT con.conname,
       rel.relname                                        AS tabela,
       format_type(a.atttypid, a.atttypmod)               AS tip_izvorne_kolone,
       frel.relname                                       AS ciljna_tabela,
       format_type(b.atttypid, b.atttypmod)               AS tip_ciljne_kolone
  FROM pg_constraint con
  JOIN pg_class  rel  ON rel.oid  = con.conrelid
  JOIN pg_class  frel ON frel.oid = con.confrelid
  JOIN pg_attribute a ON a.attrelid = rel.oid  AND a.attnum = con.conkey[1]
  JOIN pg_attribute b ON b.attrelid = frel.oid AND b.attnum = con.confkey[1]
 WHERE con.contype = 'f'
   AND rel.relnamespace = 'public'::regnamespace
   AND format_type(a.atttypid, a.atttypmod) IS DISTINCT FROM format_type(b.atttypid, b.atttypmod);

-- A10) Ukupan broj FK-ova. Očekivano: 76.
SELECT count(*) AS fk_ova
  FROM pg_constraint
 WHERE connamespace = 'public'::regnamespace AND contype = 'f';

-- -----------------------------------------------------------------------------
--  B) ČIŠĆENJE OSTATAKA — samo ako A3..A8 pokažu da šema NIJE kompletna,
--     a baza ne sadrži nikakve poslovne podatke (Faza 0/1: nema podataka).
--
--     Briše tabele, view-ove, sekvence i funkcije u šemi `public`, ALI NE i
--     objekte koje posjeduju ekstenzije (pg_depend.deptype = 'e') — npr.
--     `gen_random_uuid()` iz pgcrypto ili tip `citext`. Ekstenzije ostaju, pa
--     0_extensions na sljedećem deployu prolazi kao no-op (IF NOT EXISTS).
--
--     ⚠️ NEIZVRŠIVO u produkciji s podacima. Prije pokretanja obavezno:
--        SELECT count(*) FROM "User";   -- mora biti 0 ili podaci moraju biti bezvrijedni
--     ⚠️ Nakon čišćenja: MIGRATIONS_BASELINE ostavi PRAZNO i redeployaj.
-- -----------------------------------------------------------------------------
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT tablename AS name FROM pg_tables
--             WHERE schemaname = 'public'
--               AND tablename <> '_prisma_migrations' LOOP
--     EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.name);
--   END LOOP;
--
--   FOR r IN SELECT viewname AS name FROM pg_views WHERE schemaname = 'public' LOOP
--     EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.name);
--   END LOOP;
--
--   FOR r IN SELECT sequencename AS name FROM pg_sequences WHERE schemaname = 'public' LOOP
--     EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.name);
--   END LOOP;
--
--   FOR r IN SELECT p.proname AS name,
--                   pg_get_function_identity_arguments(p.oid) AS args
--              FROM pg_proc p
--              JOIN pg_namespace n ON n.oid = p.pronamespace
--             WHERE n.nspname = 'public'
--               AND p.oid NOT IN (SELECT objid FROM pg_depend WHERE deptype = 'e') LOOP
--     EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.name, r.args);
--   END LOOP;
--
--   DROP TABLE IF EXISTS public._prisma_migrations;
-- END $$;
