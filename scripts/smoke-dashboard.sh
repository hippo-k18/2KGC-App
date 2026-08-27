#!/usr/bin/env bash
#
# Render every implemented dashboard screen and fail if any of them breaks.
#
# ── Why this exists ─────────────────────────────────────────────────────────
#
# `tsc` and `next build` both pass on a screen that throws the moment it reads
# Firestore — a bad field name, a null that was assumed present, a `.toDate()`
# on something that is not a Timestamp. Every one of those is a green build and
# a red page, and with sixty-odd screens the only way to know is to open them.
#
# This does that: boots the emulator, seeds it, starts the dashboard, mints a
# session cookie, and requests every path in `nav.ts`'s IMPLEMENTED set. A
# screen must return 200 (or a deliberate 3xx) and must not contain Next's
# "Application error" text, which is what a server-side throw renders as.
#
# ── Usage ───────────────────────────────────────────────────────────────────
#
#   npm run smoke
#
# Needs Java for the emulator. A non-interactive shell does not inherit it from
# ~/.zprofile, so export it first if this fails with "Unable to locate a Java
# Runtime":
#
#   export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=3199
EMULATOR_PORT=8080
SECRET="smoke-test-session-secret-not-a-real-one"

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null
  [[ -n "${EMU_PID:-}" ]] && kill "$EMU_PID" 2>/dev/null
  # The emulator forks; killing the wrapper is not enough.
  pkill -f "firebase emulators:start" 2>/dev/null
  lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill -9 2>/dev/null
  return 0
}
trap cleanup EXIT

echo "→ starting the Firestore emulator"
cd "$ROOT"
npx firebase emulators:start --only firestore,auth >/tmp/smoke-emulator.log 2>&1 &
EMU_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$EMULATOR_PORT" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://localhost:$EMULATOR_PORT" >/dev/null 2>&1 || {
  echo "✗ the emulator never came up — see /tmp/smoke-emulator.log"
  exit 1
}

echo "→ seeding"
FIRESTORE_EMULATOR_HOST="localhost:$EMULATOR_PORT" npm run seed >/dev/null 2>&1 || {
  echo "✗ seeding failed"
  exit 1
}

echo "→ building and starting the dashboard on :$PORT"
cd "$ROOT/apps/organizer"
npm run build >/tmp/smoke-build.log 2>&1 || {
  echo "✗ the dashboard did not build — see /tmp/smoke-build.log"
  exit 1
}

FIRESTORE_EMULATOR_HOST="localhost:$EMULATOR_PORT" \
GCLOUD_PROJECT=kgc-conference-app-and-website \
CONSOLE_SESSION_SECRET="$SECRET" \
CONSOLE_ALLOWLIST=smoke \
  npx next start --port "$PORT" >/tmp/smoke-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/login" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://localhost:$PORT/login" >/dev/null 2>&1 || {
  echo "✗ the dashboard never came up — see /tmp/smoke-server.log"
  exit 1
}

# Mint the session cookie directly rather than driving the login form. The
# cookie format is an HMAC over a base64url payload; `auth.ts` is the spec.
COOKIE=$(CONSOLE_SESSION_SECRET="$SECRET" node -e '
  const { createHmac } = require("node:crypto");
  const s = { email: "smoke", expiresAt: Date.now() + 3600000 };
  const p = Buffer.from(JSON.stringify(s)).toString("base64url");
  process.stdout.write(p + "." + createHmac("sha256", process.env.CONSOLE_SESSION_SECRET).update(p).digest("base64url"));
')

cd "$ROOT"
npx tsx -e '
  import { IMPLEMENTED } from "./apps/organizer/src/lib/nav";
  console.log([...IMPLEMENTED].join("\n"));
' >/tmp/smoke-paths.txt 2>/dev/null

TOTAL=$(grep -c . /tmp/smoke-paths.txt)
echo "→ checking $TOTAL screens"

FAILED=0
while read -r path; do
  [[ -z "$path" ]] && continue
  code=$(curl -s -o /tmp/smoke-page.html -w "%{http_code}" \
    -H "Cookie: kgc_console_session=$COOKIE" "http://localhost:$PORT/$path")

  # A 3xx here is a deliberate redirect (pay/order-details sends you to the
  # orders table rather than duplicating it). Following it must still work.
  if [[ "$code" =~ ^3 ]]; then
    code=$(curl -s -L -o /tmp/smoke-page.html -w "%{http_code}" \
      -H "Cookie: kgc_console_session=$COOKIE" "http://localhost:$PORT/$path")
  fi

  if [[ "$code" != "200" ]]; then
    echo "  ✗ $code  $path"
    FAILED=$((FAILED + 1))
    continue
  fi

  # What a server-side throw actually renders as. `tsc` never sees these.
  if grep -q "Application error" /tmp/smoke-page.html; then
    echo "  ✗ runtime error  $path"
    FAILED=$((FAILED + 1))
  fi
done </tmp/smoke-paths.txt

echo
if [[ "$FAILED" -eq 0 ]]; then
  echo "✓ all $TOTAL screens render"
  exit 0
fi

echo "✗ $FAILED of $TOTAL screens failed — server log at /tmp/smoke-server.log"
exit 1
