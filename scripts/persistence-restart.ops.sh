#!/usr/bin/env bash
# P15 local persistence smoke test. Uses a uniquely named, disposable PostgreSQL
# Compose project and temporary attachment directory; never targets Coolify/prod.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for bin in docker corepack python3 sha256sum; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "Nedostaje naredba: $bin" >&2
    exit 2
  }
done
docker compose version >/dev/null

suffix="$(date -u +%Y%m%d%H%M%S)-$$"
project="vfm-p15-${suffix}"
pg_container="${project}-postgres"
pg_volume="${project}-pgdata"
db_network="${project}-db"
redis_network="${project}-redis"
storage_dir="$ROOT/.data/p15/$project"
started=0

# Sve Compose resurse i podatke kreiramo pod jedinstvenim P15 prefiksom.
export VFM_DEV_POSTGRES_CONTAINER="$pg_container"
export VFM_DEV_PG_VOLUME="$pg_volume"
export DB_NETWORK="$db_network"
export REDIS_NETWORK="$redis_network"
export DEV_STORAGE_PATH="$storage_dir"
export DATABASE_NAME="vfm_p15"
export DATABASE_USER="vfm_p15"
export DEV_DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
export DEV_POSTGRES_PORT="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)"
export DATABASE_URL="postgresql://${DATABASE_USER}:${DEV_DB_PASSWORD}@127.0.0.1:${DEV_POSTGRES_PORT}/${DATABASE_NAME}?schema=public"
export REDIS_HOST="vfm-redis"
export REDIS_USER_API="vfm-api"
export REDIS_USER_WORKER="vfm-worker"
export REDIS_USER_READONLY="vfm-readonly"
export DEV_REDIS_PASSWORD_API="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
export DEV_REDIS_PASSWORD_WORKER="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
export DEV_REDIS_PASSWORD_READONLY="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
export REDIS_PASSWORD_API="$DEV_REDIS_PASSWORD_API"
export REDIS_PASSWORD_WORKER="$DEV_REDIS_PASSWORD_WORKER"
export REDIS_PASSWORD_READONLY="$DEV_REDIS_PASSWORD_READONLY"
export JWT_ACCESS_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export JWT_REFRESH_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export FILE_SIGNING_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
export CORS_ORIGINS="http://localhost:5173"

compose() {
  docker compose -p "$project" -f docker-compose.yml -f docker-compose.dev.yml "$@"
}
psql_in_container() {
  compose exec -T -e "PGPASSWORD=$DEV_DB_PASSWORD" vfm-postgres \
    psql -X -v ON_ERROR_STOP=1 -U "$DATABASE_USER" -d "$DATABASE_NAME" "$@"
}
cleanup() {
  local status=$?
  if (( started )); then
    # The generated project/volume names make this teardown local to this test.
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ "$storage_dir" == "$ROOT/.data/p15/$project" ]]; then
    rm -rf -- "$storage_dir"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$storage_dir"
echo "P15 izolovani Compose projekat: $project"
echo "Baza: $DATABASE_NAME @ 127.0.0.1:$DEV_POSTGRES_PORT; volume: $pg_volume"

started=1
compose up -d vfm-postgres
for attempt in {1..60}; do
  if compose exec -T -e "PGPASSWORD=$DEV_DB_PASSWORD" vfm-postgres \
    pg_isready -U "$DATABASE_USER" -d "$DATABASE_NAME" >/dev/null 2>&1; then
    break
  fi
  if (( attempt == 60 )); then
    echo "PostgreSQL se nije spremio u 60 pokušaja." >&2
    exit 1
  fi
  sleep 2
done

# Migracije i konfiguracijski seed idu isključivo na lokalnu vfm_p15 bazu.
corepack pnpm --filter @vfm/shared build
corepack pnpm --filter @vfm/form-engine build
corepack pnpm --filter @vfm/api prisma:generate
ENV_PROFILE=tool NODE_ENV=production corepack pnpm --filter @vfm/api prisma:migrate:deploy
ENV_PROFILE=tool NODE_ENV=production SEED_DEMO_DATA=false corepack pnpm --filter @vfm/api seed

form_ids="$(psql_in_container -At -F '|' -c \
  "SELECT s.\"id\", v.\"id\" FROM \"FormSchema\" s JOIN \"FormSchemaVersion\" v ON v.\"formSchemaId\"=s.\"id\" WHERE s.\"subject\"::text='VEHICLE' AND v.\"status\"::text='PUBLISHED' ORDER BY v.\"version\" DESC LIMIT 1")"
IFS='|' read -r form_schema_id form_version_id <<< "$form_ids"
if [[ -z "${form_schema_id:-}" || -z "${form_version_id:-}" ]]; then
  echo "Seed nije kreirao objavljenu VEHICLE formu." >&2
  exit 1
fi

read -r user_id vehicle_id attachment_id < <(python3 - <<'PY'
import uuid
print(uuid.uuid4(), uuid.uuid4(), uuid.uuid4())
PY
)
probe="P15-${suffix}"
email="${probe}@invalid.example"
storage_key="p15/${attachment_id}.bin"
file_path="$storage_dir/$storage_key"
mkdir -p "$(dirname "$file_path")"
printf 'VFM P15 attachment persistence probe %s\n' "$attachment_id" > "$file_path"
sha256="$(sha256sum "$file_path" | cut -d ' ' -f1)"
size="$(wc -c < "$file_path" | tr -d ' ')"

psql_in_container -v user_id="$user_id" -v email="$email" \
  -v vehicle_id="$vehicle_id" -v internal_no="$probe" \
  -v schema_id="$form_schema_id" -v schema_version_id="$form_version_id" \
  -v attachment_id="$attachment_id" -v storage_key="$storage_key" \
  -v sha256="$sha256" -v size_bytes="$size" <<'SQL'
INSERT INTO "User" ("id", "email", "passwordHash", "firstName", "lastName", "updatedAt")
VALUES (:'user_id'::uuid, :'email', 'p15-probe-not-a-login-hash', 'P15', 'Probe', CURRENT_TIMESTAMP);
INSERT INTO "Vehicle" ("id", "internalNo", "make", "model", "fuelType", "formSchemaId", "formSchemaVersionId", "updatedAt")
VALUES (:'vehicle_id'::uuid, :'internal_no', 'Test', 'P15 Persistence', 'DIESEL', :'schema_id'::uuid, :'schema_version_id'::uuid, CURRENT_TIMESTAMP);
INSERT INTO "Attachment" ("id", "ownerId", "ownerType", "stage", "fileName", "storageKey", "mimeType", "ext", "sizeBytes", "sha256", "uploadedById")
VALUES (:'attachment_id'::uuid, :'vehicle_id'::uuid, 'VEHICLE'::"AttachmentOwnerType", 'GENERAL'::"AttachmentStage", 'p15-probe.bin', :'storage_key', 'application/octet-stream', 'bin', :'size_bytes'::bigint, :'sha256', :'user_id'::uuid);
SQL

# Čuva hash prije gašenja da bi se dokazao identičan sadržaj poslije podizanja.
before_sha="$sha256"
compose down
compose up -d vfm-postgres
started=1
for attempt in {1..60}; do
  if compose exec -T -e "PGPASSWORD=$DEV_DB_PASSWORD" vfm-postgres \
    pg_isready -U "$DATABASE_USER" -d "$DATABASE_NAME" >/dev/null 2>&1; then
    break
  fi
  if (( attempt == 60 )); then
    echo "PostgreSQL se nije vratio nakon compose down/up." >&2
    exit 1
  fi
  sleep 2
done

vehicle_count="$(psql_in_container -At -c \
  "SELECT count(*) FROM \"Vehicle\" WHERE \"id\"='$vehicle_id' AND \"internalNo\"='$probe'")"
attachment_count="$(psql_in_container -At -c \
  "SELECT count(*) FROM \"Attachment\" WHERE \"id\"='$attachment_id' AND \"sha256\"='$before_sha'")"
after_sha="$(sha256sum "$file_path" | cut -d ' ' -f1)"
[[ "$vehicle_count" == "1" ]] || { echo "Vehicle zapis nije preživio restart." >&2; exit 1; }
[[ "$attachment_count" == "1" ]] || { echo "Attachment metapodaci nisu preživjeli restart." >&2; exit 1; }
[[ "$after_sha" == "$before_sha" ]] || { echo "Checksum priloga se promijenio nakon restart-a." >&2; exit 1; }

printf 'PASS: pg_isready; Vehicle=%s; Attachment=%s; SHA-256=%s\n' \
  "$vehicle_id" "$attachment_id" "$after_sha"
echo "P15 lokalni Compose test je prošao. Coolify redeploy provjeriti zasebno na izolovanom stagingu; produkcija se ne dira."
