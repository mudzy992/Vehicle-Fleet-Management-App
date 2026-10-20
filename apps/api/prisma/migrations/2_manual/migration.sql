-- =============================================================================
--  VFM — migracija `2_manual`: sve što Prisma ne može izraziti u schema.prisma
-- =============================================================================
--  Izvori (nijedan dio nije izmišljen):
--    * 19 `// SQL:` markera u apps/api/prisma/schema.prisma,
--    * docs/03-MODEL_PODATAKA.md (CHECK / UQ partial / EXCLUDE po modelu),
--    * apps/api/prisma/sql/0000_bootstrap_extensions.sql (vezivanje triggera).
--
--  Sve je IDEMPOTENTNO: indeksi preko DROP INDEX IF EXISTS + CREATE … IF NOT
--  EXISTS, ograničenja preko DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT,
--  funkcije preko CREATE OR REPLACE, triggeri preko DROP TRIGGER IF EXISTS.
--
--  🔴 Prisma ne podržava partial unique (`@@unique` bez WHERE), pa se Prisma-ini
--     puni unique indeksi BRIŠU i zamjenjuju partial verzijama:
--       "User_email_key"         → ux_user_email_active
--       "Vehicle_internalNo_key" → ux_vehicle_internal_no_active
--       "TireSet_code_key"       → ux_tire_set_code_active
--     Posljedica: `prisma migrate dev` može predložiti da ih vrati. Takvu
--     migraciju NE primjenjivati — puni unique bi značio da soft-deletovan
--     korisnik/vozilo/gume zauvijek blokiraju svoj e-mail odnosno šifru
--     (docs/03 §3.1, §3.2, §3.4).
-- =============================================================================

-- -----------------------------------------------------------------------------
--  1) AuditLog.id: BIGSERIAL → GENERATED ALWAYS AS IDENTITY
--     (Prisma `@default(autoincrement())` na BigInt daje bigserial; docs/03 §3.9
--      traži SQL-standard IDENTITY — sprječava ručno podmetanje id-a u audit.)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  seq_name text;
  max_id   bigint;
BEGIN
  -- attidentity = '' znači da kolona još NIJE identity (običan bigserial).
  IF EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'AuditLog'
       AND a.attname = 'id'
       AND a.attidentity = ''
  ) THEN
    seq_name := pg_get_serial_sequence('"AuditLog"', 'id');

    ALTER TABLE "AuditLog" ALTER COLUMN "id" DROP DEFAULT;
    IF seq_name IS NOT NULL THEN
      EXECUTE format('ALTER SEQUENCE %s OWNED BY NONE', seq_name);
      EXECUTE format('DROP SEQUENCE IF EXISTS %s', seq_name);
    END IF;
    ALTER TABLE "AuditLog" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY;

    EXECUTE 'SELECT COALESCE(MAX(id), 0) FROM "AuditLog"' INTO max_id;
    PERFORM setval(pg_get_serial_sequence('"AuditLog"', 'id'), max_id + 1, false);
    RAISE NOTICE 'AuditLog.id → GENERATED ALWAYS AS IDENTITY (sljedeći id: %)', max_id + 1;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
--  2) Partial unique indeksi (Prisma ne podržava WHERE u @@unique)
-- -----------------------------------------------------------------------------

-- User.email (citext): jedinstven samo među NEobrisanim korisnicima.
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_email_active
  ON "User"(email) WHERE "deletedAt" IS NULL;

-- Vehicle.internalNo: jedinstven među aktivnim vozilima.
DROP INDEX IF EXISTS "Vehicle_internalNo_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_vehicle_internal_no_active
  ON "Vehicle"("internalNo") WHERE "deletedAt" IS NULL;

-- Vehicle.vin: jedinstven kad postoji (VIN je opciono kod starijih vozila).
CREATE UNIQUE INDEX IF NOT EXISTS ux_vehicle_vin_active
  ON "Vehicle"(vin) WHERE vin IS NOT NULL AND "deletedAt" IS NULL;

-- TireSet.code: jedinstven među neobrisanim setovima.
DROP INDEX IF EXISTS "TireSet_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_tire_set_code_active
  ON "TireSet"(code) WHERE "deletedAt" IS NULL;

-- Tire: ista pozicija u istom setu samo jednom (docs/03 §3.4).
CREATE UNIQUE INDEX IF NOT EXISTS ux_tire_set_position_active
  ON "Tire"("setId", position) WHERE "setId" IS NOT NULL AND "deletedAt" IS NULL;

-- FormSchema: za subject='TASK' postoji tačno jedna aktivna šema po tipu zadatka.
CREATE UNIQUE INDEX IF NOT EXISTS ux_form_schema_task_active
  ON "FormSchema"(subject, "taskTypeId")
  WHERE subject = 'TASK' AND "deletedAt" IS NULL;

-- Task.idempotencyKey: sprječava duplo kreiranje istog zadatka (§1.4 API spec).
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_idempotency_key
  ON "Task"("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- TaskAssignment: tačno JEDAN izvršilac (ASSIGNEE) po zadatku — drugi pojas za
-- P-04/P-06 (atomski claim), uz Redis lock i transakciju u servisu.
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_assignment_assignee
  ON "TaskAssignment"("taskId") WHERE role = 'ASSIGNEE' AND "revokedAt" IS NULL;

-- TireInstallation: set može biti montiran (aktivan) samo jednom — B-09.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tire_installation_active
  ON "TireInstallation"("setId") WHERE "dismountedAt" IS NULL AND "deletedAt" IS NULL;

-- -----------------------------------------------------------------------------
--  3) CHECK ograničenja
-- -----------------------------------------------------------------------------

-- Vehicle
ALTER TABLE "Vehicle" DROP CONSTRAINT IF EXISTS ck_vehicle_odometer_non_negative;
ALTER TABLE "Vehicle" ADD CONSTRAINT ck_vehicle_odometer_non_negative CHECK ("odometerKm" >= 0);

ALTER TABLE "Vehicle" DROP CONSTRAINT IF EXISTS ck_vehicle_year_range;
ALTER TABLE "Vehicle" ADD CONSTRAINT ck_vehicle_year_range CHECK (year BETWEEN 1950 AND 2100);

ALTER TABLE "Vehicle" DROP CONSTRAINT IF EXISTS ck_vehicle_vin_length;
ALTER TABLE "Vehicle" ADD CONSTRAINT ck_vehicle_vin_length CHECK (vin IS NULL OR length(vin) = 17);

-- OdometerReading (regresija kilometraže se rješava u servisu: 422
-- ODOMETER_REGRESSION, osim isCorrection=true + correctionReason)
ALTER TABLE "OdometerReading" DROP CONSTRAINT IF EXISTS ck_odometer_reading_value_non_negative;
ALTER TABLE "OdometerReading" ADD CONSTRAINT ck_odometer_reading_value_non_negative CHECK ("valueKm" >= 0);

-- RegistrationRecord / InsuranceRecord: period mora biti uređen
ALTER TABLE "RegistrationRecord" DROP CONSTRAINT IF EXISTS ck_registration_period_valid;
ALTER TABLE "RegistrationRecord" ADD CONSTRAINT ck_registration_period_valid CHECK ("validUntil" > "validFrom");

ALTER TABLE "InsuranceRecord" DROP CONSTRAINT IF EXISTS ck_insurance_period_valid;
ALTER TABLE "InsuranceRecord" ADD CONSTRAINT ck_insurance_period_valid CHECK ("validUntil" > "validFrom");

-- ServiceRecord
ALTER TABLE "ServiceRecord" DROP CONSTRAINT IF EXISTS ck_service_record_total_cost_non_negative;
ALTER TABLE "ServiceRecord" ADD CONSTRAINT ck_service_record_total_cost_non_negative CHECK ("totalCost" >= 0);

ALTER TABLE "ServiceRecord" DROP CONSTRAINT IF EXISTS ck_service_record_odometer_non_negative;
ALTER TABLE "ServiceRecord" ADD CONSTRAINT ck_service_record_odometer_non_negative CHECK ("odometerKm" IS NULL OR "odometerKm" >= 0);

-- ServiceItem.kind je TEXT (ne enum) → vrijednosti se čuvaju CHECK-om
ALTER TABLE "ServiceItem" DROP CONSTRAINT IF EXISTS ck_service_item_kind;
ALTER TABLE "ServiceItem" ADD CONSTRAINT ck_service_item_kind CHECK (kind IN ('PART', 'LABOR', 'FLUID', 'OTHER'));

-- TireSet
ALTER TABLE "TireSet" DROP CONSTRAINT IF EXISTS ck_tire_set_tire_count;
ALTER TABLE "TireSet" ADD CONSTRAINT ck_tire_set_tire_count CHECK ("tireCount" BETWEEN 1 AND 8);

-- TireInstallation: demontaža ne može biti prije montaže
ALTER TABLE "TireInstallation" DROP CONSTRAINT IF EXISTS ck_tire_installation_period_valid;
ALTER TABLE "TireInstallation" ADD CONSTRAINT ck_tire_installation_period_valid CHECK ("dismountedAt" IS NULL OR "dismountedAt" >= "mountedAt");

ALTER TABLE "TireInstallation" DROP CONSTRAINT IF EXISTS ck_tire_installation_odometer_valid;
ALTER TABLE "TireInstallation" ADD CONSTRAINT ck_tire_installation_odometer_valid CHECK ("dismountedOdometerKm" IS NULL OR "dismountedOdometerKm" >= "mountedOdometerKm");

-- FormSchemaVersion: verzije počinju od 1
ALTER TABLE "FormSchemaVersion" DROP CONSTRAINT IF EXISTS ck_form_schema_version_positive;
ALTER TABLE "FormSchemaVersion" ADD CONSTRAINT ck_form_schema_version_positive CHECK (version > 0);

-- FormSchema: TASK šema bez tipa zadatka ne može postojati (izvedeno iz istog
-- pravila kao ux_form_schema_task_active — bez taskTypeId partial unique ne radi)
ALTER TABLE "FormSchema" DROP CONSTRAINT IF EXISTS ck_form_schema_task_requires_type;
ALTER TABLE "FormSchema" ADD CONSTRAINT ck_form_schema_task_requires_type CHECK (subject <> 'TASK' OR "taskTypeId" IS NOT NULL);

-- Task: završen zadatak mora imati izvršioca i vrijeme završetka; u toku → izvršilac
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS ck_task_completed_requires_assignee;
ALTER TABLE "Task" ADD CONSTRAINT ck_task_completed_requires_assignee
  CHECK (status <> 'COMPLETED' OR ("assigneeUserId" IS NOT NULL AND "completedAt" IS NOT NULL));

ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS ck_task_in_progress_requires_assignee;
ALTER TABLE "Task" ADD CONSTRAINT ck_task_in_progress_requires_assignee
  CHECK (status <> 'IN_PROGRESS' OR "assigneeUserId" IS NOT NULL);

ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS ck_task_odometer_non_negative;
ALTER TABLE "Task" ADD CONSTRAINT ck_task_odometer_non_negative CHECK ("odometerKm" IS NULL OR "odometerKm" >= 0);

-- NotificationDelivery.channel je TEXT (ne enum) → dozvoljeni kanali CHECK-om
ALTER TABLE "NotificationDelivery" DROP CONSTRAINT IF EXISTS ck_notification_delivery_channel;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT ck_notification_delivery_channel CHECK (channel IN ('FCM', 'SSE', 'EMAIL', 'IN_APP'));

-- -----------------------------------------------------------------------------
--  4) EXCLUDE USING gist — bez preklapanja perioda po vozilu (B-10)
--     Zahtijeva ekstenziju btree_gist (migracija `0_extensions`).
-- -----------------------------------------------------------------------------
ALTER TABLE "RegistrationRecord" DROP CONSTRAINT IF EXISTS ex_registration_period_no_overlap;
ALTER TABLE "RegistrationRecord" ADD CONSTRAINT ex_registration_period_no_overlap
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    daterange("validFrom", "validUntil", '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);

ALTER TABLE "InsuranceRecord" DROP CONSTRAINT IF EXISTS ex_insurance_period_no_overlap;
ALTER TABLE "InsuranceRecord" ADD CONSTRAINT ex_insurance_period_no_overlap
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    daterange("validFrom", "validUntil", '[]') WITH &&
  ) WHERE ("deletedAt" IS NULL);

-- -----------------------------------------------------------------------------
--  5) Partial indeks za outbox worker (obrađeni eventi ne trebaju u indeks)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_outbox_event_active
  ON "OutboxEvent"("availableAt") WHERE "status" IN ('PENDING', 'FAILED');

-- -----------------------------------------------------------------------------
--  6) Trigger FUNKCIJE — verzije otporne na TG_OP
--     `0_extensions` ih kreira, ali obje ovdje dobijaju ispravku:
--       * vfm_guard_last_super_admin: (a) original je čitao NEW.id i pri DELETE
--         (NEW nije dodijeljen → greška "record new is not assigned yet");
--         (b) za trigger na "UserRole" ciljani korisnik je OLD."userId", ne
--         NEW.id; (c) original je blokirao deaktivaciju/brisanje BILO KOJEG
--         korisnika dok sistem nema aktivnog Super Admina (prije bootstrap-a) —
--         sada zaštita važi samo ako je ciljani korisnik aktivan Super Admin.
--       * vfm_guard_published_form_version: original nije obrađivao DELETE
--         objavljene verzije (P-10 traži i zabranu brisanja).
--     CREATE OR REPLACE je bezopasan ako funkcije još nisu kreirane.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vfm_guard_last_super_admin() RETURNS trigger AS $fn$
DECLARE
  target_id    uuid;
  is_super     boolean;
  active_count int;
BEGIN
  -- 1) Ko je ciljani korisnik? Funkcija dijeli tri triggera:
  --    "User" UPDATE/DELETE (target = NEW/OLD.id) i "UserRole" UPDATE
  --    (target = userId te revokacije, NE id UserRole reda).
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.id;
  ELSIF TG_TABLE_NAME = 'UserRole' THEN
    target_id := COALESCE(NEW."userId", OLD."userId");
  ELSE
    target_id := NEW.id;
  END IF;

  -- 2) Zaštita važi SAMO ako je ciljani korisnik trenutno AKTIVAN Super Admin.
  --    Bez ove provjere bi deaktivacija/brisanje BILO KOJEG korisnika bila
  --    blokirana u sistemu koji još nema Super Admina (npr. prije bootstrap-a,
  --    `scripts/bootstrap-super-admin.mjs`) — jer bi broj "ostalih" bio 0.
  SELECT EXISTS (
    SELECT 1
      FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId" AND r.code = 'SUPER_ADMIN'
      JOIN "User" u ON u.id = ur."userId"
     WHERE ur."userId" = target_id
       AND ur."revokedAt" IS NULL
       AND u.status = 'ACTIVE'
       AND u."deletedAt" IS NULL
  ) INTO is_super;

  IF NOT is_super THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- 3) Nakon izmjene mora ostati barem JEDAN DRUGI aktivan Super Admin (P-03).
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

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION vfm_guard_published_form_version() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION
        'FORM_VERSION_IMMUTABLE: objavljena verzija forme se ne može obrisati'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

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

-- -----------------------------------------------------------------------------
--  7) Vezivanje triggera na tabele (P-03 zaštita posljednjeg Super Admina,
--     P-10 immutabilnost audita/historije/objavljene verzije forme)
-- -----------------------------------------------------------------------------

-- User: deaktivacija, suspenzija ili soft delete posljednjeg Super Admina
DROP TRIGGER IF EXISTS trg_guard_last_super_admin_update ON "User";
CREATE TRIGGER trg_guard_last_super_admin_update
  BEFORE UPDATE OF status, "deletedAt" ON "User"
  FOR EACH ROW
  WHEN (NEW.status <> 'ACTIVE' OR NEW."deletedAt" IS NOT NULL)
  EXECUTE FUNCTION vfm_guard_last_super_admin();

DROP TRIGGER IF EXISTS trg_guard_last_super_admin_delete ON "User";
CREATE TRIGGER trg_guard_last_super_admin_delete
  BEFORE DELETE ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION vfm_guard_last_super_admin();

-- UserRole: revokacija SUPER_ADMIN role posljednjem aktivnom Super Adminu
DROP TRIGGER IF EXISTS trg_guard_last_super_admin_role ON "UserRole";
CREATE TRIGGER trg_guard_last_super_admin_role
  BEFORE UPDATE OF "revokedAt" ON "UserRole"
  FOR EACH ROW
  WHEN (NEW."revokedAt" IS NOT NULL)
  EXECUTE FUNCTION vfm_guard_last_super_admin();

-- AuditLog i TaskEvent: append-only (P-10 / P-14)
DROP TRIGGER IF EXISTS trg_audit_immutable ON "AuditLog";
CREATE TRIGGER trg_audit_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION vfm_reject_write();

DROP TRIGGER IF EXISTS trg_task_event_immutable ON "TaskEvent";
CREATE TRIGGER trg_task_event_immutable
  BEFORE UPDATE OR DELETE ON "TaskEvent"
  FOR EACH ROW
  EXECUTE FUNCTION vfm_reject_write();

-- FormSchemaVersion: objavljena verzija je immutable (P-10)
DROP TRIGGER IF EXISTS trg_form_version_immutable ON "FormSchemaVersion";
CREATE TRIGGER trg_form_version_immutable
  BEFORE UPDATE OR DELETE ON "FormSchemaVersion"
  FOR EACH ROW
  EXECUTE FUNCTION vfm_guard_published_form_version();
