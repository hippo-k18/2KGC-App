#!/usr/bin/env bash
# The Android counterpart of ios-shots.sh: a headless Android emulator
# (`emulator -no-window`), the Release APK from scripts/preview/build-android.sh,
# Maestro to sign in, a PNG of every main screen and a contact sheet.
#
#   app/scripts/android-shots.sh
#   REBUILD=1 app/scripts/android-shots.sh
#   KEEP_BOOTED=1 app/scripts/android-shots.sh
#   SMOKE=1 app/scripts/android-shots.sh
#
# Output: app/preview-out/android/<avd>/NN-<screen>.png and contact-sheet.{html,png}
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/preview/config.sh"
preview_android_env
AVD="${AVD:-kgc_preview_pixel}"
IMAGE="system-images;android-36;google_apis;arm64-v8a"
APK="$OUT_DIR/build/android/kgc-preview.apk"
dir="$OUT_DIR/android/$AVD"

"$APP_DIR/scripts/preview/emulator.sh"
if [[ "${REBUILD:-0}" == 1 || ! -f "$APK" ]]; then "$APP_DIR/scripts/preview/build-android.sh"; fi

if ! emulator -list-avds | grep -qx "$AVD"; then
  echo no | avdmanager create avd -n "$AVD" -k "$IMAGE" -d pixel_8 > /dev/null
fi
if ! adb devices | grep -q '^emulator-'; then
  echo "==> booting $AVD headless"
  nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect \
    -no-snapshot-save > "$OUT_DIR/android-emulator.log" 2>&1 < /dev/null &
  echo $! > "$OUT_DIR/android-emulator.pid"
fi
adb wait-for-device
until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
serial=$(adb devices | awk '/^emulator-/{print $1; exit}')
# boot_completed comes before every system service answers; settings and
# install fail for a few seconds after it (seen as exit 251).
until adb -s "$serial" shell pm list packages android > /dev/null 2>&1; do sleep 2; done
adb -s "$serial" shell settings put global window_animation_scale 0 || true
adb -s "$serial" shell settings put global transition_animation_scale 0 || true
adb -s "$serial" shell settings put global animator_duration_scale 0 || true
# Demo mode: a fixed clock and full bars in every screenshot.
adb -s "$serial" shell settings put global sysui_demo_allowed 1 || true
adb -s "$serial" shell am broadcast -a com.android.systemui.demo -e command enter > /dev/null || true
adb -s "$serial" shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 > /dev/null || true

rm -rf "$dir"; mkdir -p "$dir"
adb -s "$serial" uninstall "$BUNDLE_ID" > /dev/null 2>&1 || true
adb -s "$serial" install -r "$APK" > /dev/null
adb -s "$serial" shell am start -W -n "$BUNDLE_ID/.MainActivity" > /dev/null
sleep 10
adb -s "$serial" exec-out screencap -p > "$dir/00-login.png"

echo "    signing in with Maestro"
maestro --device "$serial" test --test-output-dir "$dir/maestro-sign-in" -e EMAIL="$PREVIEW_EMAIL" \
  -e PASSWORD="$PREVIEW_PASSWORD" "$APP_DIR/.maestro/sign-in.yaml" > "$dir/maestro-sign-in.log" 2>&1 \
  || { echo "    sign-in flow failed; see $dir/maestro-sign-in.log"; }

source "$APP_DIR/scripts/preview/routes.sh"
flow="$dir/routes.yaml"
write_route_flow "$flow"
echo "    capturing ${#ROUTES[@]} screens"
maestro --device "$serial" test --test-output-dir "$dir/maestro-out" "$flow" > "$dir/maestro-routes.log" 2>&1 \
  || { echo "    route flow failed; see $dir/maestro-routes.log"; }
find "$dir/maestro-out" -path '*takeScreenshot*' -name '*.png' -exec mv {} "$dir/" \;

if [[ "${SMOKE:-0}" == 1 ]]; then
  maestro --device "$serial" test --test-output-dir "$dir/maestro-smoke" -e EMAIL="$PREVIEW_EMAIL" \
    -e PASSWORD="$PREVIEW_PASSWORD" "$APP_DIR/.maestro/smoke.yaml" > "$dir/maestro-smoke.log" 2>&1 \
    && echo "    smoke passed" || echo "    smoke FAILED; see $dir/maestro-smoke.log"
  mkdir -p "$dir/smoke"; find "$dir/maestro-smoke" -path '*takeScreenshot*' -name '*.png' -exec mv {} "$dir/smoke/" \;
fi

adb -s "$serial" logcat -d -b crash > "$dir/crash.log" 2>/dev/null || true
python3 "$APP_DIR/scripts/preview/contact-sheet.py" "$dir" "KGC on $AVD (Android)"
if [[ "${KEEP_BOOTED:-0}" != 1 ]]; then adb -s "$serial" emu kill > /dev/null 2>&1 || true; fi
echo "==> screenshots in $dir"
