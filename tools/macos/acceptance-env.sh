#!/usr/bin/env bash
# Collects the facts a macOS acceptance result must record: OS build, hardware,
# artifact checksum, slices, signing/notarisation state and Gatekeeper verdict.
#
# Usage: tools/macos/acceptance-env.sh path/to/Inkfin.app|Inkfin_*.dmg [out.md]
#
# Output is a Markdown table ready to paste into docs/MACOS-ACCEPTANCE-RUN.md
# section 3. Every probe is optional: a missing tool prints "unavailable"
# instead of aborting, so a partial run still produces a usable record.
# This script only reads; it never signs, installs or modifies the artifact.

set -uo pipefail

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

ARTIFACT="${1:-}"
OUT="${2:-}"
MOUNT=""
APP=""

cleanup() {
  if [ -n "$MOUNT" ] && [ -d "$MOUNT" ]; then
    hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
    rmdir "$MOUNT" 2>/dev/null || true
  fi
}
trap cleanup EXIT

row() { printf '| %s | %s |\n' "$1" "${2:-}"; }

# Prints a command's first useful lines on one line, or a stated fallback.
probe() {
  local fallback="$1"
  shift
  local out
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s' "$fallback"
    return
  fi
  out=$("$@" 2>/dev/null | head -n 4 | paste -sd ' ' -)
  if [ -z "$out" ]; then
    printf '%s' "$fallback"
  else
    printf '%s' "$out"
  fi
}

if [ -z "$ARTIFACT" ]; then
  printf 'error: give the .app or .dmg to inspect\n\n' >&2
  usage >&2
  exit 2
fi

if [ ! -e "$ARTIFACT" ]; then
  printf 'error: %s does not exist\n' "$ARTIFACT" >&2
  exit 2
fi

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'warning: this is %s, not macOS. Machine fields will be placeholders.\n\n' \
    "$(uname -s)" >&2
fi

case "$ARTIFACT" in
  *.dmg)
    MOUNT=$(mktemp -d "${TMPDIR:-/tmp}/inkfin-dmg.XXXXXX")
    if command -v hdiutil >/dev/null 2>&1; then
      if hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$ARTIFACT" >/dev/null 2>&1; then
        APP=$(find "$MOUNT" -maxdepth 2 -name '*.app' -print -quit)
        [ -n "$APP" ] || printf 'warning: no .app found inside the image\n' >&2
      else
        printf 'warning: could not mount the disk image\n' >&2
      fi
    else
      printf 'warning: hdiutil is unavailable, skipping the image contents\n' >&2
    fi
    ;;
  *.app)
    APP="$ARTIFACT"
    ;;
  *)
    printf 'warning: %s is neither a .app nor a .dmg; only the checksum is recorded\n' \
      "$ARTIFACT" >&2
    ;;
esac

SIGNING="not inspected"
NOTARISATION="not inspected"
GATEKEEPER="not inspected"
ARCHS="not inspected"
EXECUTABLE=""

if [ -n "$APP" ] && [ -d "$APP" ]; then
  EXECUTABLE=$(basename "$APP" .app)
  if command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
    PLIST_EXE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
      "$APP/Contents/Info.plist" 2>/dev/null || true)
    [ -n "$PLIST_EXE" ] && EXECUTABLE="$PLIST_EXE"
  fi

  BINARY="$APP/Contents/MacOS/$EXECUTABLE"
  if [ -x "$BINARY" ] && command -v lipo >/dev/null 2>&1; then
    ARCHS=$(lipo -archs "$BINARY" 2>/dev/null | paste -sd ' ' -)
    [ -n "$ARCHS" ] || ARCHS="unavailable"
  fi

  if command -v codesign >/dev/null 2>&1; then
    if codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
      SIGNING="signature verifies ($(codesign -dv --verbose=2 "$APP" 2>&1 \
        | awk -F= '/^Authority=/{print $2; exit}'))"
      if command -v xcrun >/dev/null 2>&1 \
        && xcrun stapler validate "$APP" >/dev/null 2>&1; then
        NOTARISATION="stapled ticket validates"
      else
        NOTARISATION="no stapled ticket (or stapler unavailable)"
      fi
    else
      SIGNING="unsigned or invalid (codesign --verify failed)"
      NOTARISATION="not applicable"
    fi
  else
    SIGNING="codesign unavailable"
  fi

  GATEKEEPER=$(probe "spctl unavailable" spctl --assess --type execute --verbose=4 "$APP")
fi

# The label follows the same rule as the release workflow: notarised implies
# signed, signed without Apple credentials is a local test bundle. An artifact
# this script cannot inspect is reported as such rather than guessed to be
# unsigned.
case "$SIGNING" in
  not\ inspected*)
    DISTRIBUTION="not inspected"
    ;;
  signature\ verifies*)
    case "$NOTARISATION" in
      stapled*) DISTRIBUTION="release" ;;
      *) DISTRIBUTION="signed-unnotarized" ;;
    esac
    ;;
  *) DISTRIBUTION="unsigned" ;;
esac

CHECKSUM=""
if command -v shasum >/dev/null 2>&1; then
  CHECKSUM=$(shasum -a 256 "$ARTIFACT" 2>/dev/null | awk '{print $1}')
elif command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM=$(sha256sum "$ARTIFACT" 2>/dev/null | awk '{print $1}')
fi

QUARANTINE=$(probe "none recorded" xattr -p com.apple.quarantine "$ARTIFACT")

{
  echo "## Environment record"
  echo
  echo "| Field | Value |"
  echo "| --- | --- |"
  row "Date and tester" "$(date -u '+%Y-%m-%d %H:%M UTC') on $(id -un 2>/dev/null || echo 'unknown user')"
  row "macOS version" "$(probe 'unavailable (not macOS)' sw_vers -productVersion)"
  row "macOS build" "$(probe 'unavailable (not macOS)' sw_vers -buildVersion)"
  row "Architecture" "$(uname -m)"
  row "Hardware" "$(probe 'unavailable' sysctl -n hw.model)"
  row "Artifact filename" "$(basename "$ARTIFACT")"
  row "Artifact sha256" "${CHECKSUM:-unavailable}"
  row "Distribution label" "$DISTRIBUTION"
  row "Binary architectures" "${ARCHS:-not inspected}"
  row "Signing" "$SIGNING"
  row "Notarisation" "$NOTARISATION"
  row "Gatekeeper" "$GATEKEEPER"
  row "Quarantine attribute" "$QUARANTINE"
  echo
  case "$DISTRIBUTION" in
    unsigned|signed-unnotarized)
      echo "> This artifact is labelled \`$DISTRIBUTION\`: not a public release."
      echo "> macOS will warn on first open unless the user right-clicks and chooses Open."
      ;;
  esac
} | if [ -n "$OUT" ]; then tee "$OUT"; else cat; fi
