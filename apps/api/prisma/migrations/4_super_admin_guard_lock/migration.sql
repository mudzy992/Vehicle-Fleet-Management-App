-- =============================================================================
-- Faza 1: serializuje zaštitu posljednjeg aktivnog Super Admina.
--
-- `vfm_guard_last_super_admin` provjerava broj drugih aktivnih Super Admina.
-- Bez zajedničkog locka dvije paralelne transakcije mogle bi obje vidjeti drugu
-- osobu kao preostalu i obje ukloniti svoju SUPER_ADMIN ulogu/deaktivirati nalog.
-- Advisory xact lock se uzima prije postojećeg guard triggera; PostgreSQL izvršava
-- triggere istog tipa po abecednom nazivu (`trg_a_...` prije `trg_guard_...`).
-- Lock se automatski oslobađa pri COMMIT/ROLLBACK i isti DB lock važi za sve API
-- instance. Jedan globalni lock je namjeran: izmjene Super Admin naloga su rijetke.
-- =============================================================================

CREATE OR REPLACE FUNCTION vfm_lock_last_super_admin_guard() RETURNS trigger AS $fn$
BEGIN
  PERFORM pg_advisory_xact_lock(728430120001::bigint);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$fn$ LANGUAGE plpgsql;

-- User status/deletedAt guard.
DROP TRIGGER IF EXISTS trg_a_lock_last_super_admin_update ON "User";
CREATE TRIGGER trg_a_lock_last_super_admin_update
  BEFORE UPDATE OF status, "deletedAt" ON "User"
  FOR EACH ROW
  WHEN (NEW.status <> 'ACTIVE' OR NEW."deletedAt" IS NOT NULL)
  EXECUTE FUNCTION vfm_lock_last_super_admin_guard();

-- Fizički DELETE je podržan samo kao odbrambeni put; servis koristi anonimizaciju.
DROP TRIGGER IF EXISTS trg_a_lock_last_super_admin_delete ON "User";
CREATE TRIGGER trg_a_lock_last_super_admin_delete
  BEFORE DELETE ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION vfm_lock_last_super_admin_guard();

-- Revokacija role (postojeći guard naknadno utvrđuje je li riječ o SUPER_ADMIN-u).
DROP TRIGGER IF EXISTS trg_a_lock_last_super_admin_role ON "UserRole";
CREATE TRIGGER trg_a_lock_last_super_admin_role
  BEFORE UPDATE OF "revokedAt" ON "UserRole"
  FOR EACH ROW
  WHEN (NEW."revokedAt" IS NOT NULL)
  EXECUTE FUNCTION vfm_lock_last_super_admin_guard();
