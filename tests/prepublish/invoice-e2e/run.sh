#!/usr/bin/env bash
# Pay-by-invoice end to end, against a fake Stripe and a private Firestore
# emulator (port 8097, so it never collides with the shared one on 8080).
# Nothing here can reach live Stripe: the dev server gets an sk_test_ key, and
# STRIPE_API_BASE is only honoured with a test key. No email is sent:
# RESEND_API_KEY is unset, so sends are logged as skipped.
#
#   bash tests/prepublish/invoice-e2e/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

export GCLOUD_PROJECT=kgc-invoice-e2e
export FAKE_STRIPE_PORT=12111
export FAKE_STRIPE_URL="http://127.0.0.1:$FAKE_STRIPE_PORT"
export E2E_PORT=3297
export E2E_URL="http://127.0.0.1:$E2E_PORT"

cat > "$HERE/.firebase.json" <<JSON
{ "firestore": { "rules": "$ROOT/firestore.rules" },
  "emulators": { "firestore": { "port": 8097 }, "ui": { "enabled": false }, "singleProjectMode": true } }
JSON

cd "$ROOT"
exec npx firebase emulators:exec --only firestore --config "$HERE/.firebase.json" --project "$GCLOUD_PROJECT" \
  "bash '$HERE/inner.sh'"
