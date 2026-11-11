#!/usr/bin/env bash
# Build the app for the iOS Simulator, Release configuration, with the JS bundle
# inside, pointed at the private preview emulator (config.sh). The result runs
# with no Metro server, which is what lets ios-shots.sh run unattended.
#
#   app/scripts/preview/build-ios.sh            # prebuild if needed, then build
#   CLEAN=1 app/scripts/preview/build-ios.sh    # regenerate ios/ first
#
# Output: $OUT_DIR/build/ios/KGC.app
# For live editing instead, run a Debug build with Metro:
#   (source app/scripts/preview/config.sh; preview_build_env; cd app && npx expo run:ios)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
preview_build_env localhost
cd "$APP_DIR"
mkdir -p "$OUT_DIR"

if [[ "${CLEAN:-0}" == 1 || ! -d ios ]]; then
  echo "==> expo prebuild (ios)"
  npx expo prebuild --platform ios ${CLEAN:+--clean} > "$OUT_DIR/prebuild-ios.log" 2>&1 \
    || { tail -30 "$OUT_DIR/prebuild-ios.log"; exit 1; }
fi

WORKSPACE=$(ls -d ios/*.xcworkspace | head -1)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
# Xcode 27 needs two changes to Expo SDK 54's native template (a scene
# lifecycle and pods at iOS 15.1+); plugins/with-ios-scene-lifecycle.js makes them.
echo "==> xcodebuild $SCHEME (Release, iphonesimulator)"
start=$(date +%s)
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$OUT_DIR/DerivedData" \
  CODE_SIGNING_ALLOWED=NO build > "$OUT_DIR/xcodebuild-ios.log" 2>&1 \
  || { grep -E "error:|BUILD FAILED" "$OUT_DIR/xcodebuild-ios.log" | head -30; exit 1; }
mkdir -p "$OUT_DIR/build/ios"
rm -rf "$OUT_DIR/build/ios/$SCHEME.app"
cp -R "$OUT_DIR/DerivedData/Build/Products/Release-iphonesimulator/$SCHEME.app" "$OUT_DIR/build/ios/"
echo "==> built $OUT_DIR/build/ios/$SCHEME.app in $(( $(date +%s) - start ))s"
