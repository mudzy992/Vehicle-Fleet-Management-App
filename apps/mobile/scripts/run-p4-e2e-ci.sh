#!/usr/bin/env bash
set -euo pipefail

sanitize_maestro_debug() {
  local exit_status=$?
  set +e
  local file
  local -a diagnostics=()
  while IFS= read -r -d '' file; do
    case "$file" in
      *.log|*.json|*.yaml|*.txt)
        sed -i -E \
          -e 's/admin@vfm[.]local|vozac@vfm[.]local/[MASKED EMAIL]/g' \
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
      case "$(basename "$file")" in
        android-host-watch.log)
          tail -n 20 "$file" | cut -c1-500 | while IFS= read -r line; do
            echo "::error title=Android host watch::$line"
          done
          ;;
        android-system-errors.log)
          tail -n 40 "$file" | cut -c1-500 | while IFS= read -r line; do
            echo "::error title=Android system error::$line"
          done
          ;;
      esac
    done
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
      {
        echo "host_memory: $(free -h 2>/dev/null | tail -n 1 || true)"
        ps -eo pid,stat,%cpu,%mem,rss,comm 2>/dev/null | grep -E 'emulator|qemu|adb' | head -n 12 || true
        dmesg --ctime 2>/dev/null | grep -Ei 'out of memory|oom-kill|killed process.*(emulator|qemu)' | tail -n 8 || true
      } | while IFS= read -r line; do echo "::error title=Android host diagnostic::$line"; done
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
  local monitor_pid=""
  local logcat_pid=""
  if [[ "$stage" == maestro-* ]]; then
    local debug_dir="$RUNNER_TEMP/maestro-debug-${stage#maestro-}"
    mkdir -p "$debug_dir"
    timeout 40m adb logcat -b main -b system -b crash -v threadtime \
      -s AndroidRuntime:E ActivityManager:E InputDispatcher:W \
      >"$debug_dir/android-system-errors.log" 2>&1 &
    logcat_pid=$!
    (
      while kill -0 "$command_pid" 2>/dev/null; do
        printf '\n--- %s ---\n' "$(date -Is)"
        timeout 3s adb devices -l 2>&1 || true
        ps -C qemu-system-x86_64 -o pid,stat,%cpu,%mem,rss,comm --no-headers 2>/dev/null || true
        sleep 5
      done
    ) >>"$debug_dir/android-host-watch.log" 2>&1 &
    monitor_pid=$!
  fi
  tail -n 0 -f "$log_file" &
  local tail_pid=$!
  local status=0
  wait "$command_pid" || status=$?
  kill "$tail_pid" >/dev/null 2>&1 || true
  wait "$tail_pid" 2>/dev/null || true
  for monitor_pid in "$logcat_pid" "$monitor_pid"; do
    [[ -n "$monitor_pid" ]] || continue
    kill "$monitor_pid" >/dev/null 2>&1 || true
    wait "$monitor_pid" 2>/dev/null || true
  done
  if (( status != 0 )); then
    set +e
    echo '::error title=Android diagnostics::Failure handler reached before emulator teardown.'
    adb_state="$(timeout 8s adb devices -l 2>&1)"
    echo "::error title=ADB state before teardown::${adb_state:-adb returned no output}"
    host_state="$(ps -eo pid,stat,%cpu,%mem,rss,comm 2>/dev/null | grep -E 'emulator|qemu|adb' | head -n 12)"
    echo "::error title=Android host processes::${host_state:-no emulator or adb process matched}"
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
  set -e
  return "$status"
}

run_stage android-install adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
run_stage maestro-admin maestro test --debug-output "$RUNNER_TEMP/maestro-debug-admin" --flatten-debug-output -e TEST_ADMIN_EMAIL="$TEST_ADMIN_EMAIL" -e TEST_ADMIN_PASSWORD="$TEST_ADMIN_PASSWORD" -e TEST_RUN_ID="$TEST_RUN_ID" apps/mobile/.maestro/task-create-admin.yaml
run_stage maestro-user maestro test --debug-output "$RUNNER_TEMP/maestro-debug-user" --flatten-debug-output -e TEST_USER_EMAIL="$TEST_USER_EMAIL" -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" apps/mobile/.maestro/task-create-no-permission.yaml
run_stage api-assertions env P4_E2E_API_URL=http://127.0.0.1:3000/api/v1 node apps/mobile/scripts/verify-p4-api.mjs
