#!/usr/bin/env bash
# Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
pids=()
# The dev server is started without npx or a subshell, so the pid recorded is
# next's own and a TERM reaches the process that owns the server child. The
# pkill is the fallback, matched on this run's unique port.
trap 'kill "${pids[@]}" 2>/dev/null || true; pkill -f "apps/web --port $E2E_PORT" 2>/dev/null || true' EXIT

node "$HERE/fake-stripe.mjs" & pids+=($!)
(cd "$ROOT" && npx tsx "$HERE/seed.mts")

unset RESEND_API_KEY STRIPE_WEBHOOK_SECRET GOOGLE_APPLICATION_CREDENTIALS FIREBASE_SERVICE_ACCOUNT
export STRIPE_SECRET_KEY=sk_test_fake_invoice_e2e
export STRIPE_API_BASE="$FAKE_STRIPE_URL"
export WEB_ORDER_SECRET=invoice-e2e-order-secret-0123456789
export WEB_PUBLIC_ORIGIN="$E2E_URL"
"$ROOT/apps/web/node_modules/.bin/next" dev "$ROOT/apps/web" --port "$E2E_PORT" --hostname 127.0.0.1 \
  > "$HERE/.next-dev.log" 2>&1 & pids+=($!)

for _ in $(seq 1 120); do
  curl -sf -o /dev/null "$E2E_URL/tickets/invoice" && break
  sleep 1
done

cd "$ROOT/tests/prepublish"
npx playwright test --config invoice-e2e/playwright.config.ts

# And the gate's own invoice and checkout specs, against the same server, must
# not make a single Stripe call: that is what left 20 live drafts behind.
curl -sf -X POST "$FAKE_STRIPE_URL/__reset" > /dev/null
PREPUBLISH_URL="$E2E_URL" npx playwright test --project=desktop \
  specs/05-invoice-and-packages.spec.ts specs/04-checkout.spec.ts --grep "pay by invoice|server-side checks" --retries=0
calls="$(curl -sf "$FAKE_STRIPE_URL/__state" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).calls.length))')"
if [ "$calls" != "0" ]; then
  echo "❌ the prepublish specs made $calls Stripe call(s)"; exit 1
fi
echo "✔ the prepublish invoice and checkout specs made no Stripe calls"
