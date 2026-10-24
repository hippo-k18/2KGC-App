# Shared settings for the simulator preview scripts (sourced, not run).
#
# The preview build talks only to a PRIVATE Firebase emulator on its own ports,
# under a `demo-` project id. Firebase treats `demo-*` ids as emulator-only, so
# this build cannot reach the live project even if the emulator is down: it
# fails empty instead. The ports are not 8080/9099 because other agents on this
# Mac share that emulator and seed or wipe it (memory: shared-emulator-collisions).

PREVIEW_PROJECT="demo-kgc-preview"
PREVIEW_FIRESTORE_PORT=8208
PREVIEW_AUTH_PORT=9208

# The attendee the shots and the Maestro flow sign in as. Emulator-only.
PREVIEW_EMAIL="preview@kgc.test"
PREVIEW_PASSWORD="preview-2027"
PREVIEW_NAME="Ada Preview"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"
OUT_DIR="${OUT_DIR:-$APP_DIR/preview-out}"
BUNDLE_ID="tech.knowledgegraph.kgc"

# cmux injects a --require for a preload file that is not always there; npm and
# node then die before running anything. Keep only the heap size.
export NODE_OPTIONS="--max-old-space-size=4096"
export PATH="/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/opt/openjdk/bin:$HOME/.maestro/bin:$PATH"

# EXPO_PUBLIC_* values are compiled into the JS bundle, so they are set at build time.
preview_build_env() {
  export EXPO_PUBLIC_FIREBASE_API_KEY="demo-key"
  export EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN="$PREVIEW_PROJECT.firebaseapp.com"
  export EXPO_PUBLIC_FIREBASE_PROJECT_ID="$PREVIEW_PROJECT"
  export EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET="$PREVIEW_PROJECT.appspot.com"
  export EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="000000000000"
  export EXPO_PUBLIC_FIREBASE_APP_ID="1:000000000000:web:preview"
  export EXPO_PUBLIC_USE_EMULATOR=1
  # The iOS simulator shares the Mac's network, so localhost is the Mac. The
  # Android emulator's alias for the Mac is 10.0.2.2.
  export EXPO_PUBLIC_EMULATOR_HOST="${1:-localhost}"
  export EXPO_PUBLIC_EMULATOR_FIRESTORE_PORT="$PREVIEW_FIRESTORE_PORT"
  export EXPO_PUBLIC_EMULATOR_AUTH_PORT="$PREVIEW_AUTH_PORT"
}

# Android SDK in ~/Library/Android/sdk, installed with the sdkmanager from
# `brew install --cask android-commandlinetools`
# (see T208 report for the package list). Java 21 from Homebrew.
preview_android_env() {
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
}
