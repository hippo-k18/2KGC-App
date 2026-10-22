#!/usr/bin/env bash
# Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true; pkill -f "apps/organizer --port $E2E_PORT" 2>/dev/null || true' EXIT

unset GOOGLE_APPLICATION_CREDENTIALS FIREBASE_SERVICE_ACCOUNT RESEND_API_KEY STRIPE_SECRET_KEY
export CONSOLE_SESSION_SECRET=learn-editor-e2e-session-secret-0123456789
export CONSOLE_ALLOWLIST=owner@learn-e2e.test
export FIREBASE_STORAGE_BUCKET="$GCLOUD_PROJECT.appspot.com"
export WEB_PUBLIC_ORIGIN=http://localhost:3299
export NEXT_TELEMETRY_DISABLED=1

(cd "$ROOT" && npx tsx "$HERE/seed.mts")

# Its own build folder, so a dev server or build elsewhere in apps/organizer
# is left alone.
export ORGANIZER_DIST_DIR=.next-learn-e2e
# LEARN_E2E_BUILD=1 runs a production build (`next build` then `next start`)
# instead of the dev server: slower to start, but no on-demand compiling.
NEXT="$ROOT/apps/organizer/node_modules/.bin/next"
if [ "${LEARN_E2E_BUILD:-}" = 1 ]; then
  "$NEXT" build "$ROOT/apps/organizer" > "$HERE/.next-build.log" 2>&1
  "$NEXT" start "$ROOT/apps/organizer" --port "$E2E_PORT" > "$HERE/.next-dev.log" 2>&1 & pids+=($!)
else
  "$NEXT" dev "$ROOT/apps/organizer" --port "$E2E_PORT" > "$HERE/.next-dev.log" 2>&1 & pids+=($!)
fi

for _ in $(seq 1 180); do
  curl -s -o /dev/null "$E2E_URL/login" && break
  sleep 1
done

cd "$ROOT/tests/prepublish"
npx playwright test --config learn-editor-e2e/playwright.config.ts ${LEARN_E2E_ARGS:-}
