#!/usr/bin/env bash
# The Learn page editor end to end (T320): an empty Image or Video block must
# not stop autosave, Undo after "Load their version" must not bring back what
# a colleague's save replaced, and a learn-only member can sign out.
#
# Runs against a private Firestore emulator (port 8197, never the shared 8080)
# and a dashboard dev server on 3298. Nothing here reaches live Firebase.
#
#   bash tests/prepublish/learn-editor-e2e/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

export GCLOUD_PROJECT=demo-learn-editor-e2e
export E2E_PORT=3298
export E2E_URL="http://localhost:$E2E_PORT"
export FIRESTORE_REST="http://127.0.0.1:8197"

cat > "$HERE/.firebase.json" <<JSON
{ "firestore": { "rules": "$ROOT/firestore.rules" },
  "emulators": { "firestore": { "port": 8197, "websocketPort": 9397 }, "hub": { "port": 4497 }, "logging": { "port": 4597 },
                 "ui": { "enabled": false }, "singleProjectMode": true } }
JSON

cd "$ROOT"
exec npx firebase emulators:exec --only firestore --config "$HERE/.firebase.json" --project "$GCLOUD_PROJECT" \
  "bash '$HERE/inner.sh'"
