#!/usr/bin/env bash
# Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST and
# FIREBASE_STORAGE_EMULATOR_HOST.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true; pkill -f "next.*--port $E2E_PORT" 2>/dev/null || true; pkill -f "next.*--port $WEB_PORT" 2>/dev/null || true' EXIT

unset GOOGLE_APPLICATION_CREDENTIALS FIREBASE_SERVICE_ACCOUNT RESEND_API_KEY STRIPE_SECRET_KEY
export CONSOLE_SESSION_SECRET=learn-v2-e2e-session-secret-0123456789abcdef
export CONSOLE_ALLOWLIST=owner@learn-v2.test
export FIREBASE_STORAGE_BUCKET="$GCLOUD_PROJECT.appspot.com"
export WEB_PUBLIC_ORIGIN="$WEB_URL"
export CRON_SECRET=learn-v2-e2e-cron-secret
export NEXT_TELEMETRY_DISABLED=1

(cd "$ROOT" && npx tsx "$HERE/seed.mts")

# Their own build folders, so a dev server or build elsewhere is left alone.
export ORGANIZER_DIST_DIR=.next-t323-e2e
export WEB_DIST_DIR=.next-t323-e2e
ORG_NEXT="$ROOT/apps/organizer/node_modules/.bin/next"
WEB_NEXT="$ROOT/apps/web/node_modules/.bin/next"
if [ "${LEARN_E2E_BUILD:-}" = 1 ]; then
  if [ "${LEARN_E2E_SKIP_BUILD:-}" != 1 ]; then
    "$ORG_NEXT" build "$ROOT/apps/organizer" > "$HERE/.org-build.log" 2>&1
    "$WEB_NEXT" build "$ROOT/apps/web" > "$HERE/.web-build.log" 2>&1
  fi
  "$ORG_NEXT" start "$ROOT/apps/organizer" --port "$E2E_PORT" > "$HERE/.org.log" 2>&1 & pids+=($!)
  "$WEB_NEXT" start "$ROOT/apps/web" --port "$WEB_PORT" > "$HERE/.web.log" 2>&1 & pids+=($!)
else
  "$ORG_NEXT" dev "$ROOT/apps/organizer" --port "$E2E_PORT" > "$HERE/.org.log" 2>&1 & pids+=($!)
  "$WEB_NEXT" dev "$ROOT/apps/web" --port "$WEB_PORT" > "$HERE/.web.log" 2>&1 & pids+=($!)
fi

for _ in $(seq 1 240); do
  curl -s -o /dev/null "$E2E_URL/login" && curl -s -o /dev/null "$WEB_URL/learn" && break
  sleep 1
done

# LEARN_E2E_HOLD=1 keeps the emulators and servers up for writing the spec by hand.
if [ "${LEARN_E2E_HOLD:-}" = 1 ]; then echo "[hold] servers up on $E2E_URL and $WEB_URL"; sleep 7200; exit 0; fi

cd "$ROOT/tests/prepublish"
npx playwright test --config learn-v2-e2e/playwright.config.ts ${LEARN_E2E_ARGS:-}
