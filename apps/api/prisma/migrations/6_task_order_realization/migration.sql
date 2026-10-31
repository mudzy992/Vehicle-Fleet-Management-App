-- Nalog vs realizacija: role na FormSchema, dual snapshot na Task, unique po (taskType, role).
--
-- PRODUKCIJSKA NAPOMENA (2026-10-31): ova migracija je prvo padala na Coolify
-- deploy-u nad bazom koja je radila prije nje. Dva historijska stanja je ruše ako
-- se ne normalizuju PRIJE ograničenja:
--   1) soft-deleted TASK šeme — kolona `role` tek nastaje, pa je NULL, a stari
--      UPDATE je mijenjao samo aktivne redove → CHECK je padao na historiji;
--   2) (defanzivno) više aktivnih TASK šema za isti (tip, uloga) u bazama koje
--      nisu imale `ux_form_schema_task_active`.
-- Zato: prvo normalizujemo podatke, pa dodajemo ograničenja, a CHECK ide kao
-- NOT VALID uz najbolju moguću validaciju — migracija ne smije pasti zbog
-- redova koji više nisu aktivni. Fresh baza (CI/dev) prolazi identično.

DO $$ BEGIN
  CREATE TYPE "TaskFormRole" AS ENUM ('ORDER', 'REALIZATION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LinkedRecordType" AS ENUM ('SERVICE', 'REGISTRATION', 'TIRE_INSTALLATION');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "FormSchema" ADD COLUMN IF NOT EXISTS role "TaskFormRole";

-- Stari CHECK iz 2_manual se sklanja PRIJE normalizacije podataka: ako baza ima
-- legacy TASK red bez `taskTypeId`, svaki UPDATE tog reda bi ga ponovo provjerio
-- i pao. Novi CHECK (sa `role`) se dodaje niže, nakon podataka.
ALTER TABLE "FormSchema" DROP CONSTRAINT IF EXISTS ck_form_schema_task_requires_type;
ALTER TABLE "FormSchema" DROP CONSTRAINT IF EXISTS ck_form_schema_role_only_task;

-- Sve postojeće TASK šeme su bile "nalozi" (realizacija nije postojala).
-- Uključeni su i soft-deleted redovi: CHECK traži `role` na svakom TASK redu,
-- a ti redovi ostaju u tabeli (deletedAt) i FK-ovi pokazuju na njih.
UPDATE "FormSchema"
   SET role = 'ORDER'
 WHERE subject = 'TASK' AND role IS NULL;

ALTER TABLE "TaskType" ADD COLUMN IF NOT EXISTS "realizationFormSchemaId" UUID;

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "realizationFormSchemaId" UUID,
  ADD COLUMN IF NOT EXISTS "realizationFormSchemaVersionId" UUID,
  ADD COLUMN IF NOT EXISTS "realizationFormData" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "linkedRecordType" "LinkedRecordType",
  ADD COLUMN IF NOT EXISTS "linkedRecordId" UUID;

DROP INDEX IF EXISTS ux_form_schema_task_active;

-- Defanzivno: u bazi bez starog `ux_form_schema_task_active` ista (tip, uloga)
-- kombinacija može imati više aktivnih šema. Zadržavamo najnoviju, ostale
-- soft-deletujemo (red ostaje → FK-ovi i historija zadataka ostaju ispravni).
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY subject, "taskTypeId", role
           ORDER BY "updatedAt" DESC NULLS LAST, "id" ASC
         ) AS rn
    FROM "FormSchema"
   WHERE subject = 'TASK'
     AND "deletedAt" IS NULL
     AND "taskTypeId" IS NOT NULL
     AND role IS NOT NULL
)
UPDATE "FormSchema" AS f
   SET "deletedAt" = now()
  FROM ranked AS r
 WHERE f."id" = r."id" AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_form_schema_task_role_active
  ON "FormSchema"(subject, "taskTypeId", role)
  WHERE subject = 'TASK' AND "deletedAt" IS NULL;

-- Ograničenje važi za AKTIVNE TASK šeme; soft-deleted redovi su historija i ne
-- smiju rušiti migraciju. `NOT VALID` + validacija ispod: ako je baza čista
-- (tipično), ograničenje se odmah validira; ako nije, ostaje NOT VALID i važi za
-- sve nove izmjene, uz upozorenje u logu deploya.
ALTER TABLE "FormSchema" ADD CONSTRAINT ck_form_schema_task_requires_type
  CHECK (subject <> 'TASK' OR "deletedAt" IS NOT NULL OR ("taskTypeId" IS NOT NULL AND role IS NOT NULL))
  NOT VALID;

DO $$
BEGIN
  ALTER TABLE "FormSchema" VALIDATE CONSTRAINT ck_form_schema_task_requires_type;
EXCEPTION
  WHEN check_violation THEN
    RAISE WARNING
      'ck_form_schema_task_requires_type ostaje NOT VALID: postoje aktivne TASK šeme bez taskTypeId/role (legacy podaci). Ograničenje važi za nove redove; provjeri SELECT id, key FROM "FormSchema" WHERE subject = ''TASK'' AND "deletedAt" IS NULL AND ("taskTypeId" IS NULL OR role IS NULL);';
END $$;

ALTER TABLE "FormSchema" ADD CONSTRAINT ck_form_schema_role_only_task
  CHECK (subject = 'TASK' OR role IS NULL);

DO $$ BEGIN
  ALTER TABLE "TaskType"
    ADD CONSTRAINT "TaskType_realizationFormSchemaId_fkey"
    FOREIGN KEY ("realizationFormSchemaId") REFERENCES "FormSchema"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Task"
    ADD CONSTRAINT "Task_realizationFormSchemaId_fkey"
    FOREIGN KEY ("realizationFormSchemaId") REFERENCES "FormSchema"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Task"
    ADD CONSTRAINT "Task_realizationFormSchemaVersionId_fkey"
    FOREIGN KEY ("realizationFormSchemaVersionId") REFERENCES "FormSchemaVersion"("id")
    ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AppSetting" (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  "valueType" TEXT NOT NULL,
  scope TEXT NOT NULL,
  description TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
