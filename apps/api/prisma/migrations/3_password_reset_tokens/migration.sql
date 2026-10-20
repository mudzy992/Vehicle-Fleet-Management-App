-- Faza 1 (chunk J): jednokratni tokeni za reset lozinke.
--
-- Zašto nova tabela, a ne kolone na "User": reset može biti zatražen više puta
-- (novi zahtjev invalidira stare), a historija zahtjeva je forenzički podatak.
-- Token se čuva samo kao SHA-256 hash (nikad čist), važi 30 minuta i koristi se
-- jednom ("usedAt"). FK na "User" je CASCADE (brisanje korisnika briše tokene),
-- a "createdById" je SET NULL (administrator može biti obrisan, token ostaje).

CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" INET,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

ALTER TABLE "PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
