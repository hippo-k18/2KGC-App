#!/usr/bin/env bash
# Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST and
# FIREBASE_STORAGE_EMULATOR_HOST.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
pids=()
# Stop only the servers this run started (and their workers), never whatever else holds the ports later.
stop() { for p in "${pids[@]}"; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; }
trap stop EXIT

unset GOOGLE_APPLICATION_CREDENTIALS FIREBASE_SERVICE_ACCOUNT RESEND_API_KEY STRIPE_SECRET_KEY
export CONSOLE_SESSION_SECRET=learn-v2-e2e-session-secret-0123456789abcdef
export CONSOLE_ALLOWLIST=owner@learn-v2.test
export FIREBASE_STORAGE_BUCKET="$GCLOUD_PROJECT.appspot.com"
export WEB_PUBLIC_ORIGIN="$WEB_URL"
export CRON_SECRET=learn-v2-e2e-cron-secret
export NEXT_TELEMETRY_DISABLED=1

(cd "$ROOT" && npx tsx "$HERE/seed.mts")

# Their own build folders, so a dev server or build elsewhere is left alone.
TAG="${LEARN_E2E_TAG:-}"
export ORGANIZER_DIST_DIR=".next-t323-e2e$TAG"
export WEB_DIST_DIR=".next-t323-e2e$TAG"
ORG_NEXT="$ROOT/apps/organizer/node_modules/.bin/next"
WEB_NEXT="$ROOT/apps/web/node_modules/.bin/next"
if [ "${LEARN_E2E_BUILD:-}" = 1 ]; then
  if [ "${LEARN_E2E_SKIP_BUILD:-}" != 1 ]; then
    "$ORG_NEXT" build "$ROOT/apps/organizer" > "$HERE/.org-build$TAG.log" 2>&1
    "$WEB_NEXT" build "$ROOT/apps/web" > "$HERE/.web-build$TAG.log" 2>&1
  fi
  "$ORG_NEXT" start "$ROOT/apps/organizer" --port "$E2E_PORT" > "$HERE/.org$TAG.log" 2>&1 & pids+=($!)
  "$WEB_NEXT" start "$ROOT/apps/web" --port "$WEB_PORT" > "$HERE/.web$TAG.log" 2>&1 & pids+=($!)
else
  "$ORG_NEXT" dev "$ROOT/apps/organizer" --port "$E2E_PORT" > "$HERE/.org$TAG.log" 2>&1 & pids+=($!)
  "$WEB_NEXT" dev "$ROOT/apps/web" --port "$WEB_PORT" > "$HERE/.web$TAG.log" 2>&1 & pids+=($!)
fi

for _ in $(seq 1 240); do
  curl -s -o /dev/null "$E2E_URL/login" && curl -s -o /dev/null "$WEB_URL/learn" && break
  sleep 1
done

# LEARN_E2E_HOLD=1 keeps the emulators and servers up for writing the spec by hand.
if [ "${LEARN_E2E_HOLD:-}" = 1 ]; then echo "[hold] servers up on $E2E_URL and $WEB_URL"; sleep "${LEARN_E2E_HOLD_SECONDS:-1800}"; exit 0; fi

cd "$ROOT/tests/prepublish"
npx playwright test --config learn-v2-e2e/playwright.config.ts ${LEARN_E2E_ARGS:-}
