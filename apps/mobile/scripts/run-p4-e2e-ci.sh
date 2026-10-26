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
    if command -v adb >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
      echo '::group::Android state captured before emulator teardown'
      timeout 8s adb devices -l \
        | while IFS= read -r line; do echo "::error title=Android device (in-script)::$line"; done || true
      timeout 8s adb shell uiautomator dump /sdcard/p4-window.xml >/dev/null 2>&1 || true
      timeout 8s adb shell cat /sdcard/p4-window.xml 2>/dev/null \
        | sed -E -e 's/admin@vfm[.]local|vozac@vfm[.]local/[MASKED EMAIL]/g' \
            -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" \
        | grep -E 'login-email|login-password|E-mail|Lozinka|focused=|Prijava' \
        | head -n 15 \
        | while IFS= read -r line; do echo "::error title=Android UI node::$line"; done || true
      timeout 10s adb logcat -d -t 400 2>/dev/null \
        | grep -E 'ReactNativeJS|AndroidRuntime|ActivityTaskManager|FATAL EXCEPTION|Expo|ReactNative' \
        | tail -n 10 \
        | sed -E -e 's/admin@vfm[.]local|vozac@vfm[.]local/[MASKED EMAIL]/g' \
            -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" \
        | while IFS= read -r line; do echo "::error title=Android runtime (in-script)::$line"; done || true
      echo '::endgroup::'
    else
      echo '::error title=Android state captured before emulator teardown::adb or timeout is not available.'
    fi
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
  local file
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
    tail -n 60 "$log_file" | while IFS= read -r line; do
      echo "::error title=$stage diagnostic::$line"
    done
    if [[ "$stage" == maestro-* ]]; then
      local debug_dir="$RUNNER_TEMP/maestro-debug-${stage#maestro-}"
      while IFS= read -r -d '' file; do
        echo "::error title=Maestro artifact::$(basename "$file") ($(wc -c <"$file") bytes)"
        case "$file" in
          *.log|*.json|*.yaml|*.txt|*.xml|*.html|*.md)
            sed -i \
              -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" \
              -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" \
              "$file"
            tail -n 80 "$file" | cut -c1-1000 | while IFS= read -r line; do
              echo "::error title=Maestro artifact detail::$line"
            done
            ;;
        esac
      done < <(find "$debug_dir" -maxdepth 8 -type f -print0 2>/dev/null || true)
      if command -v adb >/dev/null 2>&1; then
        adb devices -l | while IFS= read -r line; do echo "::error title=Emulator device::$line"; done
        adb shell dumpsys activity activities 2>/dev/null \
          | grep -E 'mResumedActivity|topResumedActivity|mFocusedActivity' \
          | tail -n 10 \
          | while IFS= read -r line; do echo "::error title=Android activity::$line"; done || true
        adb logcat -d -t 300 2>/dev/null \
          | grep -E 'ReactNativeJS|AndroidRuntime|ActivityTaskManager|FATAL EXCEPTION|Expo|ReactNative' \
          | tail -n 60 \
          | sed -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" \
          | while IFS= read -r line; do echo "::error title=Android app diagnostic::$line"; done || true
      else
        echo '::error title=Emulator diagnostic::adb is unavailable in the E2E script environment.'
      fi
    fi
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
