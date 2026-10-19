-- ============================================================================
--  VFM — PostgreSQL init skripta (pokreće se samo pri PRVOM kreiranju baze,
--  kroz /docker-entrypoint-initdb.d u lokalnom dev compose-u).
--
--  U PRODUKCIJI (Coolify PostgreSQL resurs) ekstenzije se dodaju migracijom:
--     CREATE EXTENSION IF NOT EXISTS ...;
--  jer Coolify ne izvršava initdb skripte za postojeću bazu.
--
--  Napomena: `CREATE EXTENSION` zahtijeva superuser ili vlasnika baze s
--  odgovarajućim pravima. Ako korisnik `vfm` nema prava, izvršiti ručno kao
--  postgres superuser prije prvog deploya.
-- ============================================================================

-- UUID / hash funkcije (idempotency ključevi, fingerprinti)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- GiST indeksi za `daterange` exclusion constrainte (sprečava preklapanje
-- perioda registracije/osiguranja po istom vozilu)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Case-insensitive email (jedinstvenost korisničkih naloga)
CREATE EXTENSION IF NOT EXISTS citext;

-- Nepromjenjive tabele (audit log, task events) — PostgreSQL 17+
-- ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;  (vidi migracije)

-- Potvrda
DO $$
BEGIN
    RAISE NOTICE 'VFM init: pgcrypto=%, btree_gist=%, citext=%',
        (SELECT count(*) FROM pg_extension WHERE extname = 'pgcrypto'),
        (SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist'),
        (SELECT count(*) FROM pg_extension WHERE extname = 'citext');
END $$;
