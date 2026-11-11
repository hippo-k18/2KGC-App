#!/usr/bin/env bash
# Start the private Firestore + Auth emulator for the simulator preview, seed it
# with the demo event, and add one attendee account that can sign in with a
# password. Leaves the emulator running; `emulator.sh stop` ends it.
#
#   app/scripts/preview/emulator.sh          # start (or reuse) and seed
#   app/scripts/preview/emulator.sh stop
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"
mkdir -p "$OUT_DIR"
PIDFILE="$OUT_DIR/emulator.pid"

if [[ "${1:-}" == "stop" ]]; then
  # npx hands off to Java children, so the saved pid is not enough. These ports
  # belong to this preview alone (config.sh, firebase.preview.json).
  [[ -f "$PIDFILE" ]] && kill "$(cat "$PIDFILE")" 2>/dev/null || true
  for port in "$PREVIEW_FIRESTORE_PORT" "$PREVIEW_AUTH_PORT" 4408 4508 9308; do
    lsof -ti "tcp:$port" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  done
  rm -f "$PIDFILE"
  echo "emulator stopped"
  exit 0
fi

up() { nc -z 127.0.0.1 "$PREVIEW_FIRESTORE_PORT" 2>/dev/null && nc -z 127.0.0.1 "$PREVIEW_AUTH_PORT" 2>/dev/null; }

if ! up; then
  echo "==> starting emulator on $PREVIEW_FIRESTORE_PORT / $PREVIEW_AUTH_PORT ($PREVIEW_PROJECT)"
  # Detached from this shell's stdout and stdin, so a caller that pipes this
  # script's output is not held open by the emulator for as long as it runs.
  ( cd "$REPO_DIR" && nohup npx firebase emulators:start \
      --config firebase.preview.json --project "$PREVIEW_PROJECT" --only firestore,auth \
      > "$OUT_DIR/emulator.log" 2>&1 < /dev/null & echo $! > "$PIDFILE"; disown ) > /dev/null 2>&1
  for _ in $(seq 1 90); do up && break; sleep 1; done
  up || { echo "emulator did not start; see $OUT_DIR/emulator.log"; exit 1; }
fi

export FIRESTORE_EMULATOR_HOST="127.0.0.1:$PREVIEW_FIRESTORE_PORT"
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:$PREVIEW_AUTH_PORT"
export GCLOUD_PROJECT="$PREVIEW_PROJECT"
cd "$REPO_DIR"
echo "==> seeding the demo event"
npm run seed > "$OUT_DIR/seed.log" 2>&1 || { tail -20 "$OUT_DIR/seed.log"; exit 1; }
tail -3 "$OUT_DIR/seed.log"
echo "==> attendee account $PREVIEW_EMAIL"
npx tsx scripts/ops/create-demo-account.ts --email "$PREVIEW_EMAIL" --password "$PREVIEW_PASSWORD" \
  --name "$PREVIEW_NAME" > "$OUT_DIR/account.log" 2>&1 || { cat "$OUT_DIR/account.log"; exit 1; }
tail -4 "$OUT_DIR/account.log"
