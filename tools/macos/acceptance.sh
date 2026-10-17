#!/usr/bin/env bash
#
# macOS acceptance checks for an unsigned Inkfin DMG.
#
# Runs on a real Mac (a maintainer's machine or a macOS CI runner) and records
# what the artifact actually does: mounting, code signing, architectures,
# declared document types, first launch, opening a document in the running
# instance, and how many processes that leaves. Each row is pass, fail or
# unverified with the reason, so nothing is claimed that was not observed.
#
# The pointer, keyboard and render rows need a person at the screen and are
# covered by docs/MACOS-ACCEPTANCE-RUN.md instead.
#
# Usage: tools/macos/acceptance.sh <Inkfin-*.dmg> [outJson]

set -euo pipefail

DMG="${1:?usage: acceptance.sh <Inkfin-*.dmg> [outJson]}"
OUT="${2:-artifacts/macos/acceptance.json}"
FIXTURE="$(cd "$(dirname "$0")/../.." && pwd)/docs/acceptance/fixture.md"
APP_NAME="Inkfin"
APP_PATH="/Applications/$APP_NAME.app"
WORK="$(mktemp -d)"
MOUNT="$WORK/mnt"
LOG_DIR="$HOME/Library/Logs/DiagnosticReports"

mkdir -p "$MOUNT" "$(dirname "$OUT")"

steps='[]'
failures='[]'
record() {
  # record <id> <status> <detail>
  steps=$(jq -c --arg id "$1" --arg status "$2" --arg detail "$3" \
    '. + [{id: $id, status: $status, detail: $detail}]' <<<"$steps")
}
fail() {
  failures=$(jq -c --arg detail "$1" '. + [$detail]' <<<"$failures")
  record "${2:-gate}" fail "$1"
}
note() { record "$1" unverified "$2"; }

quit_app() { osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true; }
cleanup() {
  quit_app
  hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ---- host ----------------------------------------------------------------
HOST_JSON=$(jq -nc \
  --arg macos "$(sw_vers -productVersion)" \
  --arg build "$(sw_vers -buildVersion)" \
  --arg arch "$(uname -m)" \
  --arg model "$(sysctl -n hw.model)" \
  --arg cpu "$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)" \
  '{macosVersion: $macos, macosBuild: $build, kernelArch: $arch, hardwareModel: $model, cpu: $cpu}')

echo "dmg: $DMG"
DMG_SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
DMG_BYTES=$(stat -f%z "$DMG")

# ---- mount ---------------------------------------------------------------
if hdiutil attach "$DMG" -mountpoint "$MOUNT" -nobrowse -quiet 2>"$WORK/attach.log"; then
  record mount pass "mounted at $MOUNT"
else
  fail "the DMG did not mount: $(cat "$WORK/attach.log")"
  jq -nc --argjson host "$HOST_JSON" --arg dmg "$DMG" --arg sha "$DMG_SHA" \
    --argjson bytes "$DMG_BYTES" --argjson steps "$steps" --argjson failures "$failures" \
    '{host: $host, dmg: $dmg, dmgSha256: $sha, dmgBytes: $bytes, steps: $steps, failures: $failures}' >"$OUT"
  cat "$OUT"
  exit 1
fi

VOLUME_APP=$(find "$MOUNT" -maxdepth 2 -name "$APP_NAME.app" -print -quit || true)
if [[ -n "$VOLUME_APP" ]]; then
  record bundle pass "found $(basename "$VOLUME_APP") in the mounted image"
else
  fail "no $APP_NAME.app inside the mounted image"
fi

# ---- artifact facts ------------------------------------------------------
if [[ -n "$VOLUME_APP" ]]; then
  record architectures "$([[ "$(lipo -archs "$VOLUME_APP/Contents/MacOS/$APP_NAME" 2>/dev/null)" == *"x86_64"* && "$(lipo -archs "$VOLUME_APP/Contents/MacOS/$APP_NAME")" == *"arm64"* ]] && echo pass || echo fail)" \
    "lipo -archs: $(lipo -archs "$VOLUME_APP/Contents/MacOS/$APP_NAME" 2>/dev/null || echo unknown)"

  SIGNATURE=$(codesign -dv --verbose=4 "$VOLUME_APP" 2>&1 || true)
  if grep -q "Signature=adhoc" <<<"$SIGNATURE"; then
    record signature unverified "ad-hoc signature only: $(grep -m1 'Authority=' <<<"$SIGNATURE" || echo 'no authority')"
  elif grep -q "Authority=" <<<"$SIGNATURE"; then
    record signature pass "$(grep -m1 'Authority=' <<<"$SIGNATURE")"
  else
    record signature fail "no code signature: $(head -1 <<<"$SIGNATURE")"
  fi

  if spctl -a -vvv -t execute "$VOLUME_APP" >"$WORK/spctl.log" 2>&1; then
    record gatekeeper pass "spctl accepted the app"
  else
    record gatekeeper unverified "Gatekeeper refuses the unsigned build: $(head -2 "$WORK/spctl.log" | tr '\n' ' ')"
  fi

  DOC_TYPES=$(plutil -extract CFBundleDocumentTypes json -o - "$VOLUME_APP/Contents/Info.plist" 2>/dev/null || echo '[]')
  if grep -q '"md"' <<<"$DOC_TYPES" && grep -q '"markdown"' <<<"$DOC_TYPES"; then
    record documentTypes pass "Info.plist declares md and markdown"
  else
    fail "Info.plist does not declare both md and markdown document types"
  fi

  record largestSize pass "$(du -sh "$VOLUME_APP" | awk '{print $1}') installed size"
fi

# ---- installed behaviour -------------------------------------------------
rm -rf "$APP_PATH"
cp -R "$VOLUME_APP" "$APP_PATH"
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
record installed pass "copied to $APP_PATH"

running() { pgrep -if "$APP_NAME" >/dev/null 2>&1; }

if open -a "$APP_PATH" --args --inkfin-acceptance >"$WORK/open.log" 2>&1; then
  sleep 6
  if running; then
    record firstLaunch pass "the app is running after six seconds"
  else
    # Capture why before deciding anything: a launch that exits in a headless CI
    # session and a launch that exits for a real reason look identical from here.
    diagnostics="$WORK/diagnostics"
    mkdir -p "$diagnostics"
    {
      echo "open -a exit status: 0"
      echo "--- ps (any case, any owner) ---"
      ps -axo pid,comm,args | grep -i "$APP_NAME" || echo "no matching process"
      echo "--- direct launch of the bundle executable ---"
      "$APP_PATH/Contents/MacOS/$APP_NAME" --inkfin-acceptance >"$diagnostics/direct.log" 2>&1 &
      direct_pid=$!
      sleep 5
      if kill -0 "$direct_pid" 2>/dev/null; then
        echo "still running after 5 s (pid $direct_pid)"
        kill "$direct_pid" 2>/dev/null || true
      else
        wait "$direct_pid" 2>/dev/null || true
        echo "exited; output follows"
      fi
      cat "$diagnostics/direct.log"
      echo "--- bundle ---"
      ls -la "$APP_PATH/Contents/MacOS/"
      echo "--- link/codesign details ---"
      codesign -dvvv "$APP_PATH" 2>&1 | head -20
      codesign -d --entitlements - "$APP_PATH" 2>&1 | head -20
      echo "--- xattr ---"
      xattr -l "$APP_PATH" 2>/dev/null || echo "none"
      echo "--- unified log ---"
      log show --style compact --last 3m --predicate "process == \"$APP_NAME\" OR eventMessage CONTAINS \"$APP_NAME\"" 2>/dev/null | tail -30
    } >"$diagnostics/summary.txt" 2>&1
    sed -n '1,60p' "$diagnostics/summary.txt"
    note diagnostics "a first launch that exits: see the note below"
    fail "the app exited during its first launch"
    note firstLaunchLog "$(tr '\n' ' ' <"$diagnostics/summary.txt" | cut -c1-900)"
  fi
else
  fail "open -a refused the app: $(cat "$WORK/open.log")"
fi

if running; then
  BEFORE=$(pgrep -if "$APP_NAME" | wc -l | tr -d ' ')
  open -a "$APP_PATH" "$FIXTURE" >/dev/null 2>&1 || open "$FIXTURE" >/dev/null 2>&1 || true
  sleep 6
  AFTER=$(pgrep -if "$APP_NAME" | wc -l | tr -d ' ')
  if [[ "$AFTER" == "$BEFORE" ]]; then
    record singleInstance pass "$BEFORE process before, $AFTER after opening a document"
  else
    fail "opening a document started another process ($BEFORE before, $AFTER after)"
  fi

  TITLE=$(osascript -e "tell application \"System Events\" to get title of window 1 of process \"$APP_NAME\"" 2>&1 || true)
  if grep -qi "fixture.md" <<<"$TITLE"; then
    record windowTitle pass "$TITLE"
  else
    note windowTitle "could not read the window title (needs Accessibility permission): $TITLE"
  fi
fi

# ---- Finder opening, from a cold start ----------------------------------
# `open <path>` with no application is what a double click does: LaunchServices
# decides. The app is deliberately not running, so this also exercises the cold
# start where the file URL arrives before the window exists.
quit_app
sleep 3
if running; then
  fail "the app was still running before the Finder-open check"
else
  if open "$FIXTURE" >"$WORK/finder.log" 2>&1; then
    sleep 8
    if running; then
      record finderOpen pass "open <fixture> reached the app with no application named"
      TITLE=$(osascript -e "tell application \"System Events\" to get title of window 1 of process \"$APP_NAME\"" 2>&1 || true)
      if grep -qi "fixture.md" <<<"$TITLE"; then
        record finderColdStart pass "cold start applied the document: $TITLE"
      else
        fail "a document opened through LaunchServices did not reach the window: $TITLE"
      fi
    else
      fail "open <fixture> did not bring the app up"
    fi
  else
    fail "LaunchServices refused to open the fixture: $(cat "$WORK/finder.log")"
  fi
fi

# ---- a macOS shortcut, observed rather than assumed ----------------------
if running; then
  SHORTCUT=$(osascript -e 'tell application "System Events" to keystroke "f" using command down' 2>&1 || true)
  sleep 2
  REACHED=$(osascript -e "tell application \"System Events\" to tell process \"$APP_NAME\" to return role of (value of attribute \"AXFocusedUIElement\")" 2>&1 || true)
  if grep -qiE "text field|text area" <<<"$REACHED"; then
    record shortcutFind pass "Cmd+F moved focus to $REACHED"
  else
    note shortcutFind "Cmd+F could not be confirmed from outside the app: $REACHED"
  fi
  osascript -e 'tell application "System Events" to key code 53' >/dev/null 2>&1 || true
  [[ -n "$SHORTCUT" ]] && note shortcutDelivery "osascript reported: $SHORTCUT"
else
  note shortcutFind "the app was not running, so no shortcut was sent"
fi

# ---- crash reports and teardown -----------------------------------------
CRASHES=$(ls "$LOG_DIR" 2>/dev/null | grep -c "$APP_NAME" || true)
if [[ "${CRASHES:-0}" == "0" ]]; then
  record crashReports pass "no crash reports in $LOG_DIR"
else
  fail "$CRASHES crash report(s) in $LOG_DIR"
fi

quit_app
sleep 2
if running; then
  fail "the app did not quit when asked"
else
  record quit pass "the app quit and left no process"
fi

jq -nc --argjson host "$HOST_JSON" --arg dmg "$DMG" --arg sha "$DMG_SHA" --argjson bytes "$DMG_BYTES" \
  --argjson steps "$steps" --argjson failures "$failures" \
  '{host: $host, dmg: $dmg, dmgSha256: $sha, dmgBytes: $bytes, steps: $steps, failures: $failures}' >"$OUT"
cat "$OUT"

if [[ "$(jq 'length' <<<"$failures")" != "0" ]]; then
  exit 1
fi
