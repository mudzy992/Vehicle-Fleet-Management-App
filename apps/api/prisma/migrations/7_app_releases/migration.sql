-- Katalog Android APK izdanja: javni download zadnje verzije, Super Admin upload.
-- Partial unique index drži tačno jedan isLatest=true red.

CREATE TABLE IF NOT EXISTS "AppRelease" (
  "id" UUID NOT NULL,
  "versionCode" INTEGER NOT NULL,
  "versionName" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "releaseNotes" TEXT,
  "isLatest" BOOLEAN NOT NULL DEFAULT false,
  "publishedById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "retiredAt" TIMESTAMPTZ(6),
  CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AppRelease"
    ADD CONSTRAINT "AppRelease_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AppRelease_versionCode_key" ON "AppRelease"("versionCode");
CREATE UNIQUE INDEX IF NOT EXISTS "AppRelease_storageKey_key" ON "AppRelease"("storageKey");
CREATE INDEX IF NOT EXISTS "AppRelease_isLatest_idx" ON "AppRelease"("isLatest");
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_release_latest
  ON "AppRelease"("isLatest")
  WHERE "isLatest" = true;
