#!/usr/bin/env bash
# See the real iOS app on this Mac without opening a window.
#
# Boots iOS Simulators headless (simctl only; Simulator.app is never opened),
# installs the Release build from scripts/preview/build-ios.sh, signs in through
# the real login screen with Maestro, deep-links to every main screen (kgc://…),
# and saves a PNG of each plus a contact sheet per device.
#
#   app/scripts/ios-shots.sh                  # emulator + build if missing + shots
#   REBUILD=1 app/scripts/ios-shots.sh        # rebuild the app first
#   DEVICES="iPhone 17 Pro" app/scripts/ios-shots.sh
#   KEEP_BOOTED=1 app/scripts/ios-shots.sh    # leave the simulators running
#   SMOKE=1 app/scripts/ios-shots.sh          # also run .maestro/smoke.yaml
#
# Output: app/preview-out/ios/<device>/NN-<screen>.png and contact-sheet.{html,png}
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/preview/config.sh"
DEVICES="${DEVICES:-iPhone 17 Pro|iPhone SE (3rd generation)}"
SHOTS="$OUT_DIR/ios"
APP="$OUT_DIR/build/ios/KGC.app"

"$APP_DIR/scripts/preview/emulator.sh"
if [[ "${REBUILD:-0}" == 1 || ! -d "$APP" ]]; then "$APP_DIR/scripts/preview/build-ios.sh"; fi
command -v maestro >/dev/null || { echo "maestro is not installed: brew install mobile-dev-inc/tap/maestro"; exit 1; }

source "$APP_DIR/scripts/preview/routes.sh"

newest_runtime=$(xcrun simctl list runtimes -j | python3 -c '
import json,sys
rs=[r for r in json.load(sys.stdin)["runtimes"] if r["platform"]=="iOS" and r["isAvailable"]]
print(sorted(rs,key=lambda r:[int(x) for x in r["version"].split(".")])[-1]["identifier"] if rs else "")')
[[ -n "$newest_runtime" ]] || { echo "no iOS Simulator runtime: xcodebuild -downloadPlatform iOS"; exit 1; }

IFS='|' read -ra DEVICE_LIST <<< "$DEVICES"
for device in "${DEVICE_LIST[@]}"; do
  name="KGC Preview - $device"
  udid=$(xcrun simctl list devices -j | python3 -c "
import json,sys
for rt,ds in json.load(sys.stdin)['devices'].items():
    for d in ds:
        if d['name']=='$name' and d['isAvailable'] and rt=='$newest_runtime': print(d['udid'])" | head -1)
  if [[ -z "$udid" ]]; then
    type_id=$(xcrun simctl list devicetypes -j | python3 -c "
import json,sys
print(next((t['identifier'] for t in json.load(sys.stdin)['devicetypes'] if t['name']=='$device'),''))")
    [[ -n "$type_id" ]] || { echo "no device type '$device'; see: xcrun simctl list devicetypes"; exit 1; }
    udid=$(xcrun simctl create "$name" "$type_id" "$newest_runtime")
  fi
  slug=$(echo "$device" | tr ' ' '-' | tr -cd '[:alnum:]-')
  dir="$SHOTS/$slug"; rm -rf "$dir"; mkdir -p "$dir"
  echo "==> $device ($udid)"

  xcrun simctl boot "$udid" 2>/dev/null || true   # already booted is fine
  xcrun simctl bootstatus "$udid" -b > /dev/null
  xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiBars 3 2>/dev/null || true
  xcrun simctl uninstall "$udid" "$BUNDLE_ID" 2>/dev/null || true
  xcrun simctl install "$udid" "$APP"

  xcrun simctl launch "$udid" "$BUNDLE_ID" > /dev/null
  sleep 8
  xcrun simctl io "$udid" screenshot "$dir/00-login.png" > /dev/null 2>&1

  echo "    signing in with Maestro"
  maestro --device "$udid" test --test-output-dir "$dir/maestro-sign-in" -e EMAIL="$PREVIEW_EMAIL" \
    -e PASSWORD="$PREVIEW_PASSWORD" "$APP_DIR/.maestro/sign-in.yaml" > "$dir/maestro-sign-in.log" 2>&1 \
    || { echo "    sign-in flow failed; see $dir/maestro-sign-in.log"; tail -5 "$dir/maestro-sign-in.log"; }

  # Deep links go through Maestro; see write_route_flow in preview/routes.sh.
  flow="$dir/routes.yaml"
  write_route_flow "$flow"
  echo "    capturing ${#ROUTES[@]} screens"
  maestro --device "$udid" test --test-output-dir "$dir/maestro-out" "$flow" > "$dir/maestro-routes.log" 2>&1 \
    || { echo "    route flow failed; see $dir/maestro-routes.log"; tail -5 "$dir/maestro-routes.log"; }
  # Maestro files takeScreenshot output under its test-output folder.
  find "$dir/maestro-out" -path '*takeScreenshot*' -name '*.png' -exec mv {} "$dir/" \;

  if [[ "${SMOKE:-0}" == 1 ]]; then
    echo "    running .maestro/smoke.yaml"
    maestro --device "$udid" test --test-output-dir "$dir/maestro-smoke" -e EMAIL="$PREVIEW_EMAIL" \
      -e PASSWORD="$PREVIEW_PASSWORD" "$APP_DIR/.maestro/smoke.yaml" > "$dir/maestro-smoke.log" 2>&1 \
      && echo "    smoke passed" || echo "    smoke FAILED; see $dir/maestro-smoke.log"
    mkdir -p "$dir/smoke"
    find "$dir/maestro-smoke" -path '*takeScreenshot*' -name '*.png' -exec mv {} "$dir/smoke/" \;
  fi

  xcrun simctl spawn "$udid" log show --last 10m --style compact \
    --predicate 'process == "KGC" AND (messageType == error OR messageType == fault)' > "$dir/app-errors.log" 2>/dev/null || true
  python3 "$APP_DIR/scripts/preview/contact-sheet.py" "$dir" "KGC on $device (iOS)"
  [[ "${KEEP_BOOTED:-0}" == 1 ]] || xcrun simctl shutdown "$udid"
done
echo "==> screenshots in $SHOTS"
