#!/usr/bin/env python3
"""Primijeni Prisma migracije na PRAZNOM PostgreSQL-u i provjeri katalog.

Zašto ovo postoji: `prisma migrate diff` NE provjerava tipove kolona pri
generisanju SQL-a — FK između `TEXT` i `UUID` kolone prođe generisanje, a padne
tek pri primjeni (`foreign key constraint cannot be implemented`). Zbog toga se
svaka nova migracija prvo provjeri ovdje, na stvarnom serveru.

Upotreba:
    python3 scripts/db-verify/apply_migrations.py [DSN]

DSN default: postgresql://vfm:vfm_dev_only@127.0.0.1:5433/vfm_verify
(baza iz `docker-compose.dev.yml`; naziv baze se prije pokretanja dropa i
ponovo kreira, tako da je provjera uvijek na čistom).

Zahtijeva: Python 3.9+ i `pip install "psycopg[binary]"`.
"""
import re
import sys
from pathlib import Path

import psycopg

DSN = sys.argv[1] if len(sys.argv) > 1 else (
    "postgresql://vfm:vfm_dev_only@127.0.0.1:5433/vfm_verify"
)
ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "apps" / "api" / "prisma" / "migrations"

# Iz DSN-a (URI ili keyword oblik) → admin veza na `postgres` bazu, jer
# DROP/CREATE DATABASE ne može ići unutar veze na bazu koja se dropa.
from psycopg.conninfo import conninfo_to_dict, make_conninfo

_params = conninfo_to_dict(DSN)
dbname = _params.get("dbname") or "vfm_verify"
admin_dsn = make_conninfo(**{**_params, "dbname": "postgres"})


def connect(dsn, autocommit=True):
    return psycopg.connect(dsn, autocommit=autocommit)


def main() -> int:
    failures: list[str] = []

    # 1) Čista baza
    with connect(admin_dsn) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')
        c.execute(f'CREATE DATABASE "{dbname}" ENCODING \'UTF8\'')
    print(f"baza '{dbname}' kreirana iznova")

    with connect(DSN, autocommit=False) as c:
        cur = c.cursor()

        def run(label: str, path: Path, ignore_errors: bool = False) -> bool:
            sql = path.read_text(encoding="utf-8")
            cur.execute("SAVEPOINT sp")
            try:
                cur.execute(sql)
                cur.execute("RELEASE SAVEPOINT sp")
                print(f"  ✅ {label}: primijenjeno ({len(sql.splitlines())} linija)")
                return True
            except Exception as e:  # noqa: BLE001
                cur.execute("ROLLBACK TO SAVEPOINT sp")
                if ignore_errors:
                    print(f"  ℹ️  {label}: {str(e).strip().splitlines()[0]}")
                    return False
                failures.append(f"{label}: {e}")
                print(f"  ❌ {label}: {str(e).strip().splitlines()[0]}")
                return False

        # 0_extensions: `CREATE EXTENSION` traži superusera. Na pravom serveru
        # ih je vlasnik već kreirao (prisma/sql/0000_bootstrap_extensions.sql) i
        # IF NOT EXISTS prolazi; u ograničenom okruženju (npr. embedded wheel bez
        # citext/btree_gist) svaka ekstenzija se pokuša posebno, a za `citext`
        # postoji domain-fallback. Ako nešto ne prođe, fajl se primijeni bez
        # CREATE EXTENSION linija i nedostatak se ispiše kao upozorenje.
        dostupne: set[str] = set()
        for ext in ("pgcrypto", "citext", "btree_gist", "pg_stat_statements"):
            cur.execute("SAVEPOINT sp_ext")
            try:
                cur.execute(f"CREATE EXTENSION IF NOT EXISTS {ext}")
                cur.execute("RELEASE SAVEPOINT sp_ext")
                dostupne.add(ext)
            except Exception as e:  # noqa: BLE001
                cur.execute("ROLLBACK TO SAVEPOINT sp_ext")
                if ext == "citext":
                    cur.execute("CREATE DOMAIN citext AS text")
                    dostupne.add(ext)
                    print("  ℹ️  citext nije dostupan → domain fallback;")
                    print("     case-insensitive poređenje e-maila OVDJE NIJE PROVJERENO")
                else:
                    print(f"  ⚠️  ekstenzija '{ext}' nije dostupna: "
                          f"{str(e).strip().splitlines()[0]}")
                    if ext == "btree_gist":
                        print("     → EXCLUDE s (\"vehicleId\" WITH =) neće se moći "
                              "kreirati; provjeri to na pravom serveru")

        ext_path = MIGRATIONS / "0_extensions" / "migration.sql"
        if not run("0_extensions", ext_path, ignore_errors=True):
            stripped = re.sub(r"(?m)^CREATE EXTENSION.*$", "", ext_path.read_text(encoding="utf-8"))
            tmp = Path("/tmp/0_extensions.stripped.sql")
            tmp.write_text(stripped, encoding="utf-8")
            run("0_extensions (bez CREATE EXTENSION linija)", tmp)
        run("1_init", MIGRATIONS / "1_init" / "migration.sql")
        manual_path = MIGRATIONS / "2_manual" / "migration.sql"
        if "btree_gist" not in dostupne:
            # GiST za uuid jednakost dolazi iz btree_gist. Bez njega se
            # EXCLUDE može kreirati samo nad daterange dijelom — preklapanje
            # perioda se i dalje provjerava, ali NE i "po istom vozilu".
            patched = manual_path.read_text(encoding="utf-8").replace(
                '    "vehicleId" WITH =,\n', "")
            manual_path = Path("/tmp/2_manual.bez_btree_gist.sql")
            manual_path.write_text(patched, encoding="utf-8")
            print('  ⚠️  2_manual se primjenjuje BEZ `"vehicleId" WITH =` u EXCLUDE')
            print("     ograničenjima (btree_gist nedostaje) — taj dio provjeri na serveru")

        run("2_manual", manual_path)
        # Idempotentnost: 2_manual se mora moći primijeniti dvaput bez greške.
        run("2_manual (2. put — idempotentnost)", manual_path)
        c.commit()

        # 2) Katalog
        def scalar(sql: str):
            cur.execute(sql)
            return cur.fetchone()[0]

        print()
        print("  tabela:", scalar(
            "SELECT count(*) FROM information_schema.tables "
            "WHERE table_schema='public' AND table_type='BASE TABLE'"))
        print("  ux_ indeksi:", scalar(
            "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'ux_%'"))
        print("  ck_ ograničenja:", scalar(
            "SELECT count(*) FROM pg_constraint "
            "WHERE connamespace='public'::regnamespace AND contype='c' AND conname LIKE 'ck_%'"))
        print("  EXCLUDE ograničenja:", scalar(
            "SELECT count(*) FROM pg_constraint "
            "WHERE connamespace='public'::regnamespace AND contype='x'"))
        print("  FOREIGN KEY ograničenja:", scalar(
            "SELECT count(*) FROM pg_constraint "
            "WHERE connamespace='public'::regnamespace AND contype='f'"))
        cur.execute("""
          SELECT tgname, tgrelid::regclass::text FROM pg_trigger
           WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'pg_%'
           ORDER BY tgname
        """)
        print("  triggeri:", cur.fetchall())
        cur.execute("""
          SELECT attidentity FROM pg_attribute
           WHERE attrelid='public."AuditLog"'::regclass AND attname='id'
        """)
        print("  AuditLog.id identity:", repr(cur.fetchone()[0]), "(a = GENERATED ALWAYS)")

        # 3) FK tipovi moraju biti usklađeni (upravo ova provjera je nedostajala)
        cur.execute("""
          SELECT con.conname,
                 format_type(a.atttypid, a.atttypmod) AS izvorni_tip,
                 format_type(b.atttypid, b.atttypmod) AS ciljni_tip
            FROM pg_constraint con
            JOIN pg_class rel      ON rel.oid = con.conrelid
            JOIN pg_class frel     ON frel.oid = con.confrelid
            JOIN pg_attribute a    ON a.attrelid = rel.oid
                                   AND a.attnum = con.conkey[1]
            JOIN pg_attribute b    ON b.attrelid = frel.oid
                                   AND b.attnum = con.confkey[1]
           WHERE con.contype = 'f'
             AND rel.relnamespace = 'public'::regnamespace
             AND format_type(a.atttypid, a.atttypmod)
                 IS DISTINCT FROM format_type(b.atttypid, b.atttypmod)
        """)
        mismatch = cur.fetchall()
        if mismatch:
            failures.append(f"FK tipovi nisu usklađeni: {mismatch}")
            print("  ❌ FK s neusklađenim tipovima:", mismatch)
        else:
            print("  ✅ svih FK-ova ima usklađene tipove kolona")

    print()
    if failures:
        print(f"REZULTAT: {len(failures)} GREŠAKA")
        for f in failures:
            print(" -", str(f).splitlines()[0])
        return 1
    print("REZULTAT: SVE PROŠLO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
