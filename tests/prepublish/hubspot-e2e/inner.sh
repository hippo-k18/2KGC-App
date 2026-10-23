#!/usr/bin/env bash
# Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
pids=()
# Next adds its build folder to the organizer's tsconfig.json and points
# next-env.d.ts at it; put both files back as they were.
TSCONFIG="$ROOT/apps/organizer/tsconfig.json"
NEXTENV="$ROOT/apps/organizer/next-env.d.ts"
cp "$TSCONFIG" "$TMPDIR/tsconfig.json.bak"
[ -f "$NEXTENV" ] && cp "$NEXTENV" "$TMPDIR/next-env.d.ts.bak"
# Stop only the processes this run started (and their workers).
stop() {
  for p in "${pids[@]}"; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  cp "$TMPDIR/tsconfig.json.bak" "$TSCONFIG"
  [ -f "$TMPDIR/next-env.d.ts.bak" ] && cp "$TMPDIR/next-env.d.ts.bak" "$NEXTENV"
  return 0
}
# macOS has no `timeout`; perl's alarm caps a step that hangs.
cap() { local secs="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$secs" "$@"; }
trap stop EXIT

unset GOOGLE_APPLICATION_CREDENTIALS FIREBASE_SERVICE_ACCOUNT RESEND_API_KEY STRIPE_SECRET_KEY HUBSPOT_TOKEN
export CONSOLE_SESSION_SECRET=hubspot-e2e-session-secret-0123456789abcdef
export CONSOLE_ALLOWLIST=owner@hubspot-e2e.test
# A test-only key for sealing the token at rest. Never a real value.
export WEB_ORDER_SECRET=hubspot-e2e-order-secret-0123456789abcdef
export HUBSPOT_API_BASE="$FAKE_HUBSPOT_URL"
export CRON_SECRET=hubspot-e2e-cron-secret
export NEXT_TELEMETRY_DISABLED=1

node "$ROOT/tests/hubspot/fake-hubspot.mjs" > "$HERE/.fake.log" 2>&1 & pids+=($!)

(cd "$ROOT" && npx tsx "$HERE/seed.mts")

# Its own build folder, so a dev server or build elsewhere is left alone.
export ORGANIZER_DIST_DIR=.next-t333-e2e
ORG_NEXT="$ROOT/apps/organizer/node_modules/.bin/next"
# A production build by default (T334 H-1 only showed on one); HUBSPOT_E2E_DEV=1 for next dev.
if [ "${HUBSPOT_E2E_DEV:-}" = 1 ]; then
  "$ORG_NEXT" dev "$ROOT/apps/organizer" --port "$E2E_PORT" > "$HERE/.org.log" 2>&1 & pids+=($!)
else
  if [ "${HUBSPOT_E2E_SKIP_BUILD:-}" != 1 ]; then
    echo "[build] next build into apps/organizer/$ORGANIZER_DIST_DIR (log: $HERE/.org-build.log)"
    if ! cap 900 "$ORG_NEXT" build "$ROOT/apps/organizer" > "$HERE/.org-build.log" 2>&1; then
      tail -30 "$HERE/.org-build.log" >&2
      exit 1
    fi
    cp "$TMPDIR/tsconfig.json.bak" "$TSCONFIG"
    [ -f "$TMPDIR/next-env.d.ts.bak" ] && cp "$TMPDIR/next-env.d.ts.bak" "$NEXTENV"
  fi
  if [ ! -f "$ROOT/apps/organizer/$ORGANIZER_DIST_DIR/BUILD_ID" ]; then
    echo "No production build in apps/organizer/$ORGANIZER_DIST_DIR. Run without HUBSPOT_E2E_SKIP_BUILD." >&2
    exit 1
  fi
  "$ORG_NEXT" start "$ROOT/apps/organizer" --port "$E2E_PORT" > "$HERE/.org.log" 2>&1 & pids+=($!)
fi

for _ in $(seq 1 240); do
  curl -s -o /dev/null "$E2E_URL/login" && curl -s -o /dev/null "$FAKE_HUBSPOT_URL/__state" && break
  sleep 1
done

# HUBSPOT_E2E_HOLD=1 keeps everything up for writing the spec by hand.
if [ "${HUBSPOT_E2E_HOLD:-}" = 1 ]; then echo "[hold] dashboard on $E2E_URL, fake HubSpot on $FAKE_HUBSPOT_URL"; sleep "${HUBSPOT_E2E_HOLD_SECONDS:-1800}"; exit 0; fi

cd "$ROOT/tests/prepublish"
cap 1800 npx playwright test --config hubspot-e2e/playwright.config.ts ${HUBSPOT_E2E_ARGS:-}
