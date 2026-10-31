-- Nalog vs realizacija: role na FormSchema, dual snapshot na Task, unique po (taskType, role).

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

UPDATE "FormSchema"
   SET role = 'ORDER'
 WHERE subject = 'TASK' AND role IS NULL AND "deletedAt" IS NULL;

ALTER TABLE "TaskType" ADD COLUMN IF NOT EXISTS "realizationFormSchemaId" UUID;

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "realizationFormSchemaId" UUID,
  ADD COLUMN IF NOT EXISTS "realizationFormSchemaVersionId" UUID,
  ADD COLUMN IF NOT EXISTS "realizationFormData" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "linkedRecordType" "LinkedRecordType",
  ADD COLUMN IF NOT EXISTS "linkedRecordId" UUID;

DROP INDEX IF EXISTS ux_form_schema_task_active;
CREATE UNIQUE INDEX IF NOT EXISTS ux_form_schema_task_role_active
  ON "FormSchema"(subject, "taskTypeId", role)
  WHERE subject = 'TASK' AND "deletedAt" IS NULL;

ALTER TABLE "FormSchema" DROP CONSTRAINT IF EXISTS ck_form_schema_task_requires_type;
ALTER TABLE "FormSchema" ADD CONSTRAINT ck_form_schema_task_requires_type
  CHECK (subject <> 'TASK' OR ("taskTypeId" IS NOT NULL AND role IS NOT NULL));

ALTER TABLE "FormSchema" DROP CONSTRAINT IF EXISTS ck_form_schema_role_only_task;
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
