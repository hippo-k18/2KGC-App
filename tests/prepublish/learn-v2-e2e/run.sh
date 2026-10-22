#!/usr/bin/env bash
# The Learn editor v2 release end to end (T323): rich text, the 14 new block
# kinds, the media library, image edits, saved sections, scheduled publish,
# preview links and the role gate, from the editor through to www /learn.
#
# Private emulators only (Firestore 8323, Storage 9323, never the shared
# 8080/9099), a dashboard on :3323 and the website on :3324. Nothing here
# reaches live Firebase. Never run two Storage suites at once.
#
#   bash tests/prepublish/learn-v2-e2e/run.sh            # dev servers
#   LEARN_E2E_BUILD=1 bash tests/prepublish/learn-v2-e2e/run.sh   # next build + start
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

export GCLOUD_PROJECT=demo-learn-v2-e2e
export E2E_PORT=3323
export WEB_PORT=3324
export E2E_URL="http://localhost:$E2E_PORT"
export WEB_URL="http://localhost:$WEB_PORT"
export FIRESTORE_REST="http://127.0.0.1:8323"

cat > "$HERE/.firebase.json" <<JSON
{ "firestore": { "rules": "$ROOT/firestore.rules" },
  "storage": { "rules": "$ROOT/storage.rules" },
  "emulators": { "firestore": { "port": 8323, "host": "127.0.0.1", "websocketPort": 9423 },
                 "storage": { "port": 9323, "host": "127.0.0.1" },
                 "hub": { "port": 4423 }, "logging": { "port": 4523 },
                 "ui": { "enabled": false }, "singleProjectMode": true } }
JSON

# The Storage emulator keeps its files under TMPDIR; its own folder keeps it apart from any other.
export TMPDIR="$HERE/.tmp"
mkdir -p "$TMPDIR"
cd "$ROOT"
exec npx firebase emulators:exec --only firestore,storage --config "$HERE/.firebase.json" --project "$GCLOUD_PROJECT" \
  "bash '$HERE/inner.sh'"
