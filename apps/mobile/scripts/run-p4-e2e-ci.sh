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
          -e 's/admin@vfm[.]local|vozac@vfm[.]local|superadmin@vfm[.]local/[MASKED EMAIL]/g' \
          -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" \
          -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" \
          -e "s/${TEST_SUPER_ADMIN_PASSWORD:-}/[MASKED]/g" \
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
      for attempt in 1 2 3; do
        if timeout 12s adb shell uiautomator dump --compressed /sdcard/p4-window.xml >/dev/null 2>&1; then
          break
        fi
        sleep 2
      done
      timeout 8s adb shell cat /sdcard/p4-window.xml 2>/dev/null \
        | sed -E -e 's/admin@vfm[.]local|vozac@vfm[.]local|superadmin@vfm[.]local/[MASKED EMAIL]/g' \
            -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_SUPER_ADMIN_PASSWORD:-}/[MASKED]/g" \
        | grep -oE 'resource-id="[^"]*"|text="[^"]+"|content-desc="[^"]+"' \
        | head -n 40 \
        | while IFS= read -r line; do echo "::error title=Android UI node::$line"; done || true
      timeout 10s adb logcat -d -t 400 2>/dev/null \
        | grep -E 'ReactNativeJS|AndroidRuntime|ActivityTaskManager|FATAL EXCEPTION|Expo|ReactNative' \
        | tail -n 10 \
        | sed -E -e 's/admin@vfm[.]local|vozac@vfm[.]local|superadmin@vfm[.]local/[MASKED EMAIL]/g' \
            -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_SUPER_ADMIN_PASSWORD:-}/[MASKED]/g" \
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
  local debug_dir=""
  local monitor_pid=""
  local logcat_pid=""
  echo "Starting E2E stage: $stage"
  if [[ "$stage" == maestro-* ]]; then
    debug_dir="$RUNNER_TEMP/maestro-debug-${stage#maestro-}"
    mkdir -p "$debug_dir"
    {
      printf '\n--- pre-Maestro %s ---\n' "$(date -Is)"
      timeout 3s adb devices -l 2>&1 || true
      ps -C qemu-system-x86_64 -o pid,stat,%cpu,%mem,rss,comm --no-headers 2>/dev/null || true
    } >"$debug_dir/android-host-watch.log"
    timeout 40m adb logcat -b main -b system -b crash -v threadtime \
      -s AndroidRuntime:E ActivityManager:E InputDispatcher:W \
      >"$debug_dir/android-system-errors.log" 2>&1 &
    logcat_pid=$!
  fi
  "$@" >"$log_file" 2>&1 &
  local command_pid=$!
  if [[ "$stage" == maestro-* ]]; then
    (
      last_reconnect=0
      while kill -0 "$command_pid" 2>/dev/null; do
        sleep 5
        printf '\n--- %s ---\n' "$(date -Is)"
        device_state="$(timeout 3s adb devices -l 2>&1 || true)"
        printf '%s\n' "$device_state"
        now="$(date +%s)"
        if grep -Eq '^emulator-[0-9]+[[:space:]]+offline([[:space:]]|$)' <<<"$device_state" && (( now - last_reconnect >= 30 )); then
          echo "Detected offline emulator; requesting adb reconnect offline."
          timeout 5s adb reconnect offline 2>&1 || true
          last_reconnect="$now"
        fi
        ps -C qemu-system-x86_64 -o pid,stat,%cpu,%mem,rss,comm --no-headers 2>/dev/null || true
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
    echo "::error title=Mobile E2E::$stage failed with exit $status"
    if [[ "$stage" == maestro-* ]]; then
      # GitHub prikazuje samo ~10 anotacija po koraku, a logovi runa nisu
      # preuzimljivi u ovom okruženju — zato UI hijerarhija ide prva.
      for attempt in 1 2 3; do
        if timeout 12s adb shell uiautomator dump --compressed /sdcard/p4-window.xml >/dev/null 2>&1; then
          break
        fi
        sleep 2
      done
      timeout 8s adb shell cat /sdcard/p4-window.xml 2>/dev/null \
        | sed -E -e 's/admin@vfm[.]local|vozac@vfm[.]local|superadmin@vfm[.]local/[MASKED EMAIL]/g' \
            -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_SUPER_ADMIN_PASSWORD:-}/[MASKED]/g" \
        | grep -oE 'resource-id="[^"]*"|text="[^"]+"' \
        | head -n 8 \
        | while IFS= read -r line; do echo "::error title=Android UI::$line"; done || true
    fi
    echo '::error title=Android diagnostics::Failure handler reached before emulator teardown.'
    adb_state="$(timeout 8s adb devices -l 2>&1)"
    echo "::error title=ADB state before teardown::${adb_state:-adb returned no output}"
    host_state="$(ps -eo pid,stat,%cpu,%mem,rss,comm 2>/dev/null | grep -E 'emulator|qemu|adb' | head -n 12)"
    echo "::error title=Android host processes::${host_state:-no emulator or adb process matched}"
    if [[ "$stage" == maestro-* ]]; then
      maestro_tail="$(tail -n 24 "$log_file" | tr '\n' '|' | cut -c1-3500)"
      echo "::error title=Maestro final output::$maestro_tail"

      echo "::error title=Maestro diagnostics::Collecting emulator traces for $stage."
      debug_dir="$RUNNER_TEMP/maestro-debug-${stage#maestro-}"
      if [[ -f "$debug_dir/android-host-watch.log" ]]; then
        host_trace="$(tail -n 16 "$debug_dir/android-host-watch.log" | tr '\n' '|' | cut -c1-3000)"
        echo "::error title=Android timeline::$host_trace"
      fi
      host_memory="$(awk '/^MemTotal:/ {total=$2} /^MemAvailable:/ {available=$2} END {if (total) printf \"total=%dMB available=%dMB\", total/1024, available/1024}' /proc/meminfo 2>/dev/null)"
      echo "::error title=Android host memory::${host_memory:-unavailable}"
      while IFS= read -r -d '' file; do
        echo "::error title=Maestro artifact::$(basename "$file") ($(wc -c <"$file") bytes)"
        case "$file" in
          *.log|*.json|*.yaml|*.txt|*.xml|*.html|*.md)
            sed -i -E \
              -e 's/admin@vfm[.]local|vozac@vfm[.]local|superadmin@vfm[.]local/[MASKED EMAIL]/g' \
              -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" \
              -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" \
              "$file"
            tail -n 80 "$file" | cut -c1-1000 | while IFS= read -r line; do
              echo "::error title=Maestro artifact detail::$line"
            done
            ;;
        esac
      done < <(find "$debug_dir" -maxdepth 8 -type f -print0 2>/dev/null || true)
      for trace_file in "$debug_dir/android-host-watch.log" "$debug_dir/android-system-errors.log"; do
        if [[ -f "$trace_file" ]]; then
          echo "::error title=Android trace captured::$(basename "$trace_file") ($(wc -c <"$trace_file") bytes)"
          tail -n 24 "$trace_file" | cut -c1-500 | while IFS= read -r line; do
            echo "::error title=Android trace detail::$line"
          done
        else
          echo "::error title=Android trace missing::$(basename "$trace_file")"
        fi
      done
      if command -v adb >/dev/null 2>&1; then
        adb devices -l | while IFS= read -r line; do echo "::error title=Emulator device::$line"; done
        adb shell dumpsys activity activities 2>/dev/null \
          | grep -E 'mResumedActivity|topResumedActivity|mFocusedActivity' \
          | tail -n 10 \
          | while IFS= read -r line; do echo "::error title=Android activity::$line"; done || true
        adb logcat -d -t 300 2>/dev/null \
          | grep -E 'ReactNativeJS|AndroidRuntime|ActivityTaskManager|FATAL EXCEPTION|Expo|ReactNative' \
          | tail -n 60 \
          | sed -e "s/${TEST_ADMIN_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_USER_PASSWORD:-}/[MASKED]/g" -e "s/${TEST_SUPER_ADMIN_PASSWORD:-}/[MASKED]/g" \
          | while IFS= read -r line; do echo "::error title=Android app diagnostic::$line"; done || true
      else
        echo '::error title=Emulator diagnostic::adb is unavailable in the E2E script environment.'
      fi
      tail -n 20 "$log_file" | while IFS= read -r line; do
        echo "::error title=$stage diagnostic::$line"
      done
    fi
  fi
  rm -f "$log_file"
  set -e
  return "$status"
}

run_stage android-provision bash -c '
  set -euo pipefail
  adb wait-for-device
  adb shell settings put global device_provisioned 1
  adb shell settings put secure user_setup_complete 1
  if adb shell pm list packages com.google.android.googlesdksetup | grep -q com.google.android.googlesdksetup; then
    adb shell am force-stop com.google.android.googlesdksetup || true
    adb shell pm disable-user --user 0 com.google.android.googlesdksetup || true
  fi
  adb shell input keyevent 82
  provisioned="$(adb shell settings get global device_provisioned | tr -d "\\r")"
  setup_complete="$(adb shell settings get secure user_setup_complete | tr -d "\\r")"
  printf "device_provisioned=%s user_setup_complete=%s\\n" "$provisioned" "$setup_complete"
  [[ "$provisioned" == 1 && "$setup_complete" == 1 ]]
'
run_stage android-install adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
run_stage maestro-admin maestro test --debug-output "$RUNNER_TEMP/maestro-debug-admin" --flatten-debug-output -e TEST_ADMIN_EMAIL="$TEST_ADMIN_EMAIL" -e TEST_ADMIN_PASSWORD="$TEST_ADMIN_PASSWORD" -e TEST_RUN_ID="$TEST_RUN_ID" apps/mobile/.maestro/task-create-admin.yaml
run_stage maestro-user maestro test --debug-output "$RUNNER_TEMP/maestro-debug-user" --flatten-debug-output -e TEST_USER_EMAIL="$TEST_USER_EMAIL" -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" apps/mobile/.maestro/task-create-no-permission.yaml
run_stage maestro-superadmin maestro test --debug-output "$RUNNER_TEMP/maestro-debug-superadmin" --flatten-debug-output -e TEST_SUPER_ADMIN_EMAIL="$TEST_SUPER_ADMIN_EMAIL" -e TEST_SUPER_ADMIN_PASSWORD="$TEST_SUPER_ADMIN_PASSWORD" apps/mobile/.maestro/super-admin-forbidden.yaml
run_stage maestro-claim maestro test --debug-output "$RUNNER_TEMP/maestro-debug-claim" --flatten-debug-output -e TEST_USER_EMAIL="$TEST_USER_EMAIL" -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" -e CLAIM_TASK_TITLE="$CLAIM_TASK_TITLE" apps/mobile/.maestro/task-claim-complete-lite.yaml
run_stage maestro-logout maestro test --debug-output "$RUNNER_TEMP/maestro-debug-logout" --flatten-debug-output -e TEST_USER_EMAIL="$TEST_USER_EMAIL" -e TEST_USER_PASSWORD="$TEST_USER_PASSWORD" apps/mobile/.maestro/logout.yaml
run_stage api-assertions env P4_E2E_API_URL=http://127.0.0.1:3000/api/v1 node apps/mobile/scripts/verify-p4-api.mjs
