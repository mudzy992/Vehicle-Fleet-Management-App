-- =============================================================================
--  VFM — bootstrap ekstenzija i šeme (PostgreSQL 17)
-- =============================================================================
--  Namjena: priprema GLOBALNOG PostgreSQL-a (na mreži `db_net`) prije prve
--           Prisma migracije. Idempotentno — može se izvršiti više puta.
--
--  Pokretanje (jednom, kao superuser/DBA ako korisnik `vfm` nema pravo
--  CREATE EXTENSION — pitanje R-02b iz docs/01-KONCEPT_UNAPREDJENJA.md §E):
--
--    psql "$DATABASE_URL_AS_SUPERUSER" -v ON_ERROR_STOP=1 \
--         -f apps/api/prisma/sql/0000_bootstrap_extensions.sql
--
--  Ili kroz Docker (lokalni dev iz docker-compose.dev.yml):
--
--    docker exec -i vfm-postgres psql -U vfm -d vfm -v ON_ERROR_STOP=1 \
--      < apps/api/prisma/sql/0000_bootstrap_extensions.sql
--
--  Ako aplikacija ima pravo kreiranja ekstenzija, `DATABASE_CREATE_EXTENSIONS=true`
--  i Prisma migracija će ih kreirati sama (vidi apps/api/prisma/README.md).
-- =============================================================================

BEGIN;

-- 1) Ekstenzije --------------------------------------------------------------
-- pgcrypto   : gen_random_uuid() — fallback za UUID ako ne koristimo v7 u aplikaciji
-- citext     : e-mail bez osjetljivosti na velika/mala slova (docs/03 §3.1)
-- btree_gist : EXCLUDE USING gist za preklapanje perioda registracije/osiguranja (B-10)
-- pg_stat_statements : dijagnostika sporih upita (opciono; ako nije dostupno, preskoči)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- pg_stat_statements zahtijeva shared_preload_libraries → ne forsiraj:
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements nije kreirana (nije u shared_preload_libraries) — preskačem.';
END $$;

-- 2) Postavke sesije (provjera, ne mijenja globalnu konfiguraciju) -----------
-- Aplikacija čuva isključivo UTC; prikaz je Europe/Sarajevo (docs/02 §7).
DO $$
BEGIN
  IF current_setting('timezone', true) IS DISTINCT FROM 'UTC' THEN
    RAISE NOTICE 'Postgres "timezone" je "%" — preporuka je UTC za VFM bazu.',
      current_setting('timezone', true);
  END IF;
END $$;

-- 3) Provjera prava na šemi --------------------------------------------------
-- `public` šema je mjesto gdje Prisma kreira tabele.
GRANT ALL ON SCHEMA public TO CURRENT_USER;

-- 4) Zaštita posljednjeg Super Admina (P-03, docs/03 §3.2) -------------------
-- Trigger funkcija se kreira ovdje jer je neovisna o Prisma migracijama i
-- mora postojati prije prvog unosa korisnika.
CREATE OR REPLACE FUNCTION vfm_guard_last_super_admin() RETURNS trigger AS $fn$
DECLARE
  active_count int;
  target_id    uuid;
BEGIN
  target_id := COALESCE(NEW.id, OLD.id);

  SELECT count(*) INTO active_count
    FROM "User" u
    JOIN "UserRole" ur ON ur."userId" = u.id AND ur."revokedAt" IS NULL
    JOIN "Role" r      ON r.id = ur."roleId" AND r.code = 'SUPER_ADMIN'
   WHERE u.status = 'ACTIVE'
     AND u."deletedAt" IS NULL
     AND u.id <> target_id;

  IF active_count = 0 THEN
    RAISE EXCEPTION
      'LAST_SUPER_ADMIN_PROTECTED: sistem mora imati barem jednog aktivnog super administratora'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$fn$ LANGUAGE plpgsql;

-- 5) Immutabilnost audit loga i historije zadataka (P-14) --------------------
CREATE OR REPLACE FUNCTION vfm_reject_write() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % je zaštićen od izmjena', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
  RETURN NULL;
END
$fn$ LANGUAGE plpgsql;

-- 6) Immutabilnost objavljene verzije forme (P-10) ---------------------------
CREATE OR REPLACE FUNCTION vfm_guard_published_form_version() RETURNS trigger AS $fn$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    -- Dozvoljen je samo prelaz PUBLISHED → RETIRED (uz retiredById).
    IF NEW.status = 'RETIRED' AND NEW."retiredById" IS NOT NULL THEN
      IF NEW.definition <> OLD.definition OR NEW.version <> OLD.version THEN
        RAISE EXCEPTION
          'FORM_VERSION_IMMUTABLE: definicija i broj objavljene verzije se ne mogu mijenjati'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'FORM_VERSION_IMMUTABLE: objavljena verzija forme se ne može mijenjati niti obrisati'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

COMMIT;

-- =============================================================================
--  NAPOMENA: triggeri se VEZUJU na tabele tek nakon što ih Prisma migracija
--  kreira (tabele "User", "UserRole", "AuditLog", "TaskEvent",
--  "FormSchemaVersion" ne postoje prije `prisma migrate deploy`).
--
--  SQL za vezivanje (dodati u prvu Prisma migraciju, idempotentno):
--
--    DROP TRIGGER IF EXISTS trg_guard_last_super_admin_update ON "User";
--    CREATE TRIGGER trg_guard_last_super_admin_update
--      BEFORE UPDATE OF status, "deletedAt" ON "User"
--      FOR EACH ROW
--      WHEN (NEW.status <> 'ACTIVE' OR NEW."deletedAt" IS NOT NULL)
--      EXECUTE FUNCTION vfm_guard_last_super_admin();
--
--    DROP TRIGGER IF EXISTS trg_guard_last_super_admin_delete ON "User";
--    CREATE TRIGGER trg_guard_last_super_admin_delete
--      BEFORE DELETE ON "User" FOR EACH ROW
--      EXECUTE FUNCTION vfm_guard_last_super_admin();
--
--    DROP TRIGGER IF EXISTS trg_guard_last_super_admin_role ON "UserRole";
--    CREATE TRIGGER trg_guard_last_super_admin_role
--      BEFORE UPDATE OF "revokedAt" ON "UserRole" FOR EACH ROW
--      WHEN (NEW."revokedAt" IS NOT NULL)
--      EXECUTE FUNCTION vfm_guard_last_super_admin();
--
--    DROP TRIGGER IF EXISTS trg_audit_immutable ON "AuditLog";
--    CREATE TRIGGER trg_audit_immutable
--      BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW
--      EXECUTE FUNCTION vfm_reject_write();
--
--    DROP TRIGGER IF EXISTS trg_task_event_immutable ON "TaskEvent";
--    CREATE TRIGGER trg_task_event_immutable
--      BEFORE UPDATE OR DELETE ON "TaskEvent" FOR EACH ROW
--      EXECUTE FUNCTION vfm_reject_write();
--
--    DROP TRIGGER IF EXISTS trg_form_version_immutable ON "FormSchemaVersion";
--    CREATE TRIGGER trg_form_version_immutable
--      BEFORE UPDATE ON "FormSchemaVersion" FOR EACH ROW
--      EXECUTE FUNCTION vfm_guard_published_form_version();
-- =============================================================================
