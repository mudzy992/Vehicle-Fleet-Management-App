#!/usr/bin/env bash
set -euo pipefail

sanitize_maestro_debug() {
  local exit_status=$?
  local file
  local -a diagnostics=()
  while IFS= read -r -d '' file; do
    case "$file" in
      *.log|*.json|*.yaml|*.txt)
        sed -i \
          -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" \
          -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" \
          "$file"
        diagnostics+=("$file")
        ;;
    esac
  done < <(find "$RUNNER_TEMP" -maxdepth 8 -type f -path '*/maestro-debug-*/*' -print0 2>/dev/null || true)
  if (( exit_status != 0 )); then
    printf 'Maestro diagnostic text files: %s\n' "${diagnostics[*]:-none}"
    for file in "${diagnostics[@]}"; do
      [[ -f "$file" ]] || continue
      echo "::group::Sanitized Maestro diagnostic: $(basename "$file")"
      tail -n 100 "$file" | while IFS= read -r line; do
        echo "::error title=Maestro diagnostic::$line"
      done
      echo "::endgroup::"
    done
  fi
  return "$exit_status"
}
trap sanitize_maestro_debug EXIT

run_stage() {
  local stage="$1"
  shift
  local log_file="$RUNNER_TEMP/mobile-e2e-$stage.log"
  echo "Starting E2E stage: $stage"
  "$@" >"$log_file" 2>&1 &
  local command_pid=$!
  tail -n 0 -f "$log_file" &
  local tail_pid=$!
  local status=0
  wait "$command_pid" || status=$?
  kill "$tail_pid" >/dev/null 2>&1 || true
  wait "$tail_pid" 2>/dev/null || true
  if (( status != 0 )); then
    echo "::error title=Mobile E2E::$stage failed with exit $status"
    tail -n 40 "$log_file" | while IFS= read -r line; do
      echo "::error title=$stage diagnostic::$line"
    done
  fi
  rm -f "$log_file"
  return "$status"
}

cd apps/mobile
run_stage android-build env EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api/v1 corepack pnpm exec expo run:android --variant release --no-bundler
cd ../..
run_stage maestro-admin maestro test --debug-output "$RUNNER_TEMP/maestro-debug-admin" --flatten-debug-output -e TEST_ADMIN_EMAIL="$TEST_ADMIN_EMAIL" -e TEST_ADMIN_PASSWORD="$TEST_ADMIN_PASSWORD" -e TEST_RUN_ID="$TEST_RUN_ID" apps/mobile/.maestro/task-create-admin.yaml
run_stage maestro-user maestro test --debug-output "$RUNNER_TEMP/maestro-debug-user" --flatten-debug-output -e TEST_USER_EMAIL="$TEST_USER_EMAIL" -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" apps/mobile/.maestro/task-create-no-permission.yaml
run_stage api-assertions env P4_E2E_API_URL=http://127.0.0.1:3000/api/v1 node apps/mobile/scripts/verify-p4-api.mjs
