#!/usr/bin/env bash
# Build a Release APK for the Android emulator, JS bundle inside, pointed at the
# private preview emulator through 10.0.2.2 (the Android emulator's name for the
# Mac). Output: $OUT_DIR/build/android/kgc-preview.apk
#
#   app/scripts/preview/build-android.sh
#   CLEAN=1 app/scripts/preview/build-android.sh    # regenerate android/ first
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
preview_android_env
preview_build_env 10.0.2.2
cd "$APP_DIR"
mkdir -p "$OUT_DIR/build/android"

if [[ "${CLEAN:-0}" == 1 || ! -d android ]]; then
  echo "==> expo prebuild (android)"
  npx expo prebuild --platform android ${CLEAN:+--clean} > "$OUT_DIR/prebuild-android.log" 2>&1 \
    || { tail -30 "$OUT_DIR/prebuild-android.log"; exit 1; }
fi
# The emulator speaks plain HTTP, which a release build refuses by default. This
# edits only the generated, uncommitted android/ project of this preview build.
MANIFEST=android/app/src/main/AndroidManifest.xml
grep -q 'usesCleartextTraffic="true"' "$MANIFEST" || \
  sed -i '' 's/<application /<application android:usesCleartextTraffic="true" /' "$MANIFEST"

echo "==> gradle assembleRelease"
start=$(date +%s)
(cd android && ./gradlew --no-daemon assembleRelease -PreactNativeArchitectures=arm64-v8a) \
  > "$OUT_DIR/gradle-android.log" 2>&1 || { grep -E "FAILURE|error:|What went wrong" -A5 "$OUT_DIR/gradle-android.log" | head -40; exit 1; }
cp android/app/build/outputs/apk/release/app-release.apk "$OUT_DIR/build/android/kgc-preview.apk"
echo "==> built $OUT_DIR/build/android/kgc-preview.apk in $(( $(date +%s) - start ))s"
